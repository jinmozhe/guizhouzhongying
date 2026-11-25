from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.core.identifiers import new_uuid7
from app.db.models import Admin, Asset, Brand, Category, Merchant, MerchantAlbumImage, ProductDetailImage, User
from app.db.repositories.asset import AssetRepository
from app.db.transaction import transaction_scope
from app.services.storage import IMAGE_PROFILES, ImageMetadata, StorageProvider, process_image_bytes

_SUPPORTED_MIMES = frozenset({"image/jpeg", "image/png", "image/webp"})
_MAX_LEGACY_READ_BYTES = 50 * 1024 * 1024


@dataclass(frozen=True, slots=True)
class LegacyOptimizationResult:
    """单条历史图片资产离线优化结果。"""

    asset_id: UUID
    status: str
    profile: str | None = None
    old_bytes: int = 0
    new_bytes: int = 0
    thumb_bytes: int = 0


class AssetImageOptimizer:
    """将历史静态图片资产批量压缩为 WebP 并按档位补齐 480px 缩略图。"""

    def __init__(
        self,
        factory: async_sessionmaker[AsyncSession],
        storage: StorageProvider,
        settings: Settings,
    ) -> None:
        self._factory = factory
        self._storage = storage
        self._settings = settings

    async def infer_profile(self, session: AsyncSession, asset: Asset) -> str:
        """结合场景与当前数据库引用关系推断最匹配的图片处理档位。"""
        if asset.scene == "avatar":
            return "avatar"
        if asset.scene == "article":
            return "product_detail"
        is_detail = await session.scalar(
            select(ProductDetailImage.asset_id).where(ProductDetailImage.asset_id == asset.id).limit(1)
        )
        if is_detail is not None:
            return "product_detail"
        is_album = await session.scalar(
            select(MerchantAlbumImage.asset_id).where(MerchantAlbumImage.asset_id == asset.id).limit(1)
        )
        if is_album is not None:
            return "merchant_album"
        is_category_icon = await session.scalar(select(Category.id).where(Category.icon_asset_id == asset.id).limit(1))
        is_brand_logo = await session.scalar(select(Brand.id).where(Brand.logo_asset_id == asset.id).limit(1))
        is_merchant_logo = await session.scalar(select(Merchant.id).where(Merchant.logo_asset_id == asset.id).limit(1))
        if is_category_icon is not None or is_brand_logo is not None or is_merchant_logo is not None:
            return "logo_icon"
        return "product_gallery"

    async def _is_already_optimized(self, asset: Asset, profile: str) -> bool:
        spec = IMAGE_PROFILES[profile]
        if (
            asset.mime_type != "image/webp"
            or asset.width is None
            or asset.height is None
            or asset.frame_count != 1
            or asset.width > spec.max_width
            or asset.height > spec.max_height
            or asset.file_size > spec.max_bytes
        ):
            return False
        if spec.thumb_max_width is not None and asset.width > spec.thumb_max_width:
            if asset.thumb_file_key is None:
                return False
            return await self._storage.exists(asset.thumb_file_key)
        return True

    async def run_one(
        self,
        asset_id: UUID,
        *,
        apply: bool,
        profile_override: str | None = None,
    ) -> LegacyOptimizationResult:
        async with self._factory() as session:
            asset = await AssetRepository(session).get(asset_id)
            if asset is None:
                return LegacyOptimizationResult(asset_id, "missing")
            if asset.storage_driver != self._storage.driver or asset.mime_type not in _SUPPORTED_MIMES:
                return LegacyOptimizationResult(asset_id, "unsupported", old_bytes=asset.file_size)
            profile = profile_override or await self.infer_profile(session, asset)
            if profile not in IMAGE_PROFILES:
                return LegacyOptimizationResult(asset_id, "unsupported_profile", profile=profile)
            if await self._is_already_optimized(asset, profile):
                return LegacyOptimizationResult(
                    asset_id,
                    "already_optimized",
                    profile=profile,
                    old_bytes=asset.file_size,
                    new_bytes=asset.file_size,
                    thumb_bytes=asset.thumb_file_size or 0,
                )
            snapshot = (
                asset.file_key,
                asset.file_hash,
                asset.file_size,
                asset.mime_type,
                asset.url,
                asset.thumb_file_key,
                asset.scene,
                asset.uploader_type,
                asset.uploader_id,
            )

        old_key, old_hash, old_size, old_mime, old_url, old_thumb_key, scene, uploader_type, uploader_id = snapshot
        try:
            raw_bytes = await self._storage.read_bytes(old_key, max_bytes=_MAX_LEGACY_READ_BYTES)
        except FileNotFoundError:
            return LegacyOptimizationResult(asset_id, "file_missing", profile=profile, old_bytes=old_size)
        except OSError, ValueError:
            return LegacyOptimizationResult(asset_id, "read_failed", profile=profile, old_bytes=old_size)

        if hashlib.sha256(raw_bytes).hexdigest() != old_hash:
            return LegacyOptimizationResult(asset_id, "hash_mismatch", profile=profile, old_bytes=old_size)

        try:
            processed = process_image_bytes(raw_bytes, old_mime, profile)
        except ValueError as exc:
            return LegacyOptimizationResult(asset_id, f"process_failed:{exc}", profile=profile, old_bytes=old_size)

        new_size = len(processed.primary.payload)
        new_thumb_size = len(processed.thumbnail.payload) if processed.thumbnail is not None else 0
        if not apply:
            return LegacyOptimizationResult(
                asset_id,
                "ready",
                profile=profile,
                old_bytes=old_size,
                new_bytes=new_size,
                thumb_bytes=new_thumb_size,
            )

        staged = await self._storage.stage_bytes(
            processed.primary.payload,
            mime_type=processed.primary.mime_type,
            extension=processed.primary.extension,
            image=ImageMetadata(
                width=processed.primary.width,
                height=processed.primary.height,
                frame_count=processed.frame_count,
            ),
            thumbnail_payload=processed.thumbnail.payload if processed.thumbnail is not None else None,
            thumbnail_dimensions=(processed.thumbnail.width, processed.thumbnail.height)
            if processed.thumbnail is not None
            else None,
        )
        date_bucket = datetime.now(UTC).strftime("%Y%m%d")
        suffix_id = new_uuid7().hex
        base_prefix = f"{scene}/{date_bucket}/{staged.file_hash[:16]}_{suffix_id}"
        new_key = f"{base_prefix}.{staged.extension}"
        new_url = f"{self._settings.upload_base_url}/{new_key}"
        new_thumb_key = f"{base_prefix}_thumb.webp" if staged.thumbnail is not None else None
        new_thumb_url = f"{self._settings.upload_base_url}/{new_thumb_key}" if new_thumb_key is not None else None

        await self._storage.commit(staged, file_key=new_key, thumb_file_key=new_thumb_key)

        try:
            async with self._factory() as session, transaction_scope(session):
                repo = AssetRepository(session)
                current = await repo.get(asset_id, for_update=True)
                if (
                    current is None
                    or current.file_key != old_key
                    or current.file_hash != old_hash
                    or current.file_size != old_size
                ):
                    await self._cleanup_keys(new_key, new_thumb_key)
                    return LegacyOptimizationResult(asset_id, "conflict", profile=profile, old_bytes=old_size)

                if uploader_id is not None:
                    duplicate = await repo.find_duplicate(
                        uploader_type=uploader_type,
                        uploader_id=uploader_id,
                        scene=scene,
                        file_hash=staged.file_hash,
                    )
                    if duplicate is not None and duplicate.id != current.id:
                        await self._cleanup_keys(new_key, new_thumb_key)
                        return LegacyOptimizationResult(
                            asset_id, "duplicate_hash_conflict", profile=profile, old_bytes=old_size
                        )

                current.file_key = new_key
                current.mime_type = staged.mime_type
                current.file_size = staged.file_size
                current.width = processed.primary.width
                current.height = processed.primary.height
                current.frame_count = processed.frame_count
                current.file_hash = staged.file_hash
                current.url = new_url
                current.thumb_file_key = new_thumb_key
                current.thumb_url = new_thumb_url
                current.thumb_file_size = staged.thumbnail.file_size if staged.thumbnail is not None else None
                current.thumb_width = staged.thumbnail.width if staged.thumbnail is not None else None
                current.thumb_height = staged.thumbnail.height if staged.thumbnail is not None else None

                if old_url != new_url:
                    await session.execute(update(User).where(User.avatar == old_url).values(avatar=new_url))
                    await session.execute(update(Admin).where(Admin.avatar == old_url).values(avatar=new_url))
                await session.flush()
        except IntegrityError:
            await self._cleanup_keys(new_key, new_thumb_key)
            return LegacyOptimizationResult(asset_id, "duplicate_hash_conflict", profile=profile, old_bytes=old_size)
        except BaseException:
            await self._cleanup_keys(new_key, new_thumb_key)
            raise

        # 数据库提交完成后再移除旧文件，避免影响读取。
        for stale_key in (old_key, old_thumb_key):
            if stale_key is not None and stale_key not in {new_key, new_thumb_key}:
                await self._cleanup_keys(stale_key)

        return LegacyOptimizationResult(
            asset_id,
            "updated",
            profile=profile,
            old_bytes=old_size,
            new_bytes=new_size,
            thumb_bytes=new_thumb_size,
        )

    async def _cleanup_keys(self, *keys: str | None) -> None:
        for key in keys:
            if key is None:
                continue
            try:
                deletion = await self._storage.stage_delete(key)
                await self._storage.purge(deletion)
            except FileNotFoundError, OSError, ValueError:
                continue


__all__ = ["AssetImageOptimizer", "LegacyOptimizationResult"]
