from __future__ import annotations

import builtins
import posixpath
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import PurePosixPath
from typing import BinaryIO
from urllib.parse import unquote, urlsplit

from loguru import logger
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.core.error_codes import ErrorCode
from app.core.exceptions import AppException
from app.core.identifiers import new_uuid7
from app.core.request_metadata import RequestMetadata
from app.db.models import Asset
from app.db.repositories import AssetRepository
from app.db.repositories.commerce_access import CommerceAccessRepository
from app.db.transaction import transaction_scope
from app.domains.assets.schemas import (
    AssetBulkDeleteResult,
    AssetPage,
    AssetRead,
    ImageProfile,
    UploaderType,
    UploadScene,
)
from app.services.admin_audit import AdminAuditCoordinator
from app.services.security_events import AuditCoordinator
from app.services.storage import StagedDeletion, StagedFile, StorageProvider, create_storage_provider


async def recover_asset_deletions(*, session_factory: async_sessionmaker[AsyncSession], settings: Settings) -> None:
    storage = create_storage_provider(settings)
    for deletion in await storage.pending_deletions():
        async with session_factory() as session, transaction_scope(session):
            # 等待活跃删除事务释放锁，并按主图或缩略图键统一判定数据库最终结果。
            asset = await AssetRepository(session).get_by_any_file_key(deletion.file_key, for_update=True)
            if asset is not None:
                await storage.restore(deletion)
            else:
                await storage.purge(deletion)


@dataclass(frozen=True, slots=True)
class AssetUploader:
    type: UploaderType
    id: uuid.UUID


@dataclass(frozen=True, slots=True)
class ScenePolicy:
    max_bytes: int
    extensions: frozenset[str]
    mime_types: frozenset[str]


_IMAGE_MIMES = frozenset({"image/jpeg", "image/png", "image/webp"})
_SCENE_POLICIES = {
    UploadScene.AVATAR: ScenePolicy(10 * 1024 * 1024, frozenset({"jpg", "jpeg", "png", "webp"}), _IMAGE_MIMES),
    UploadScene.ARTICLE: ScenePolicy(
        20 * 1024 * 1024,
        frozenset({"jpg", "jpeg", "png", "webp", "gif"}),
        _IMAGE_MIMES | {"image/gif"},
    ),
    UploadScene.PRODUCT: ScenePolicy(20 * 1024 * 1024, frozenset({"jpg", "jpeg", "png", "webp"}), _IMAGE_MIMES),
    UploadScene.DOCUMENT: ScenePolicy(
        30 * 1024 * 1024,
        frozenset({"pdf", "doc", "docx", "xls", "xlsx"}),
        frozenset(
            {
                "application/pdf",
                "application/msword",
                "application/vnd.ms-excel",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            }
        ),
    ),
}
_USER_SCENES = frozenset({UploadScene.AVATAR, UploadScene.ATTACHMENT, UploadScene.TEMP})
_SCENE_DEFAULT_IMAGE_PROFILE: dict[UploadScene, ImageProfile] = {
    UploadScene.AVATAR: ImageProfile.AVATAR,
    UploadScene.PRODUCT: ImageProfile.PRODUCT_GALLERY,
    UploadScene.ARTICLE: ImageProfile.PRODUCT_DETAIL,
}
_SCENE_ALLOWED_IMAGE_PROFILES: dict[UploadScene, frozenset[ImageProfile]] = {
    UploadScene.AVATAR: frozenset({ImageProfile.AVATAR}),
    UploadScene.PRODUCT: frozenset(
        {
            ImageProfile.PRODUCT_GALLERY,
            ImageProfile.PRODUCT_DETAIL,
            ImageProfile.MERCHANT_ALBUM,
            ImageProfile.LOGO_ICON,
        }
    ),
    UploadScene.ARTICLE: frozenset(
        {
            ImageProfile.PRODUCT_DETAIL,
            ImageProfile.PRODUCT_GALLERY,
            ImageProfile.LOGO_ICON,
        }
    ),
}

_IMAGE_STAGE_ERROR_MESSAGES: dict[str, tuple[int, ErrorCode, str]] = {
    "file_too_large": (413, ErrorCode.ASSET_FILE_TOO_LARGE, "文件大小超过场景限制"),
    "image_decode_busy": (503, ErrorCode.ASSET_STORAGE_FAILED, "图片处理繁忙，请稍后重试"),
    "image_too_tall_for_detail": (
        422,
        ErrorCode.ASSET_TYPE_NOT_ALLOWED,
        "商品详情单图压缩至 1200px 宽后高度超过 2400px，请切分为高度不超过 2400px 的多张图片后上传",
    ),
    "animated_image_not_allowed": (422, ErrorCode.ASSET_TYPE_NOT_ALLOWED, "当前场景仅支持静态图片，不支持动图"),
    "image_budget_exceeded": (
        422,
        ErrorCode.ASSET_TYPE_NOT_ALLOWED,
        "图片细节过于复杂，压缩后仍超过体积预算，请适当裁剪后重试",
    ),
    "image_resource_limit": (422, ErrorCode.ASSET_TYPE_NOT_ALLOWED, "图片像素尺寸超过安全处理上限"),
}


class AssetService:
    def __init__(
        self,
        *,
        session: AsyncSession,
        session_factory: async_sessionmaker[AsyncSession],
        settings: Settings,
        storage: StorageProvider,
        metadata: RequestMetadata,
    ) -> None:
        self._session = session
        self._session_factory = session_factory
        self._settings = settings
        self._storage = storage
        self._metadata = metadata
        self._assets = AssetRepository(session)

    def _resolve_image_profile(
        self,
        *,
        scene: UploadScene,
        uploader: AssetUploader,
        image_profile: ImageProfile | None,
    ) -> ImageProfile | None:
        allowed = _SCENE_ALLOWED_IMAGE_PROFILES.get(scene)
        if image_profile is None:
            return _SCENE_DEFAULT_IMAGE_PROFILE.get(scene)
        if allowed is None or image_profile not in allowed:
            raise AppException(
                status_code=422,
                code=ErrorCode.ASSET_TYPE_NOT_ALLOWED,
                message="当前上传场景不支持指定的图片处理档位",
            )
        if uploader.type == UploaderType.USER and image_profile != ImageProfile.AVATAR:
            raise AppException(
                status_code=403,
                code=ErrorCode.PERMISSION_DENIED,
                message="当前用户无权使用该图片处理档位",
            )
        return image_profile

    async def upload(
        self,
        *,
        source: BinaryIO,
        original_name: str,
        scene: UploadScene,
        uploader: AssetUploader,
        image_profile: ImageProfile | None = None,
    ) -> AssetRead:
        if uploader.type == UploaderType.USER and scene not in _USER_SCENES:
            raise AppException(status_code=403, code=ErrorCode.PERMISSION_DENIED, message="当前用户无权使用该上传场景")
        safe_name, extension = self._safe_filename(original_name)
        policy = self._policy(scene)
        if extension not in policy.extensions or extension not in self._settings.allowed_upload_extensions:
            raise AppException(
                status_code=422,
                code=ErrorCode.ASSET_TYPE_NOT_ALLOWED,
                message="文件扩展名不在允许范围内",
            )
        resolved_profile = self._resolve_image_profile(scene=scene, uploader=uploader, image_profile=image_profile)
        max_bytes = min(policy.max_bytes, self._settings.upload_max_file_size_mb * 1024 * 1024)
        try:
            staged = await self._storage.stage(
                source,
                extension=extension,
                max_bytes=max_bytes,
                inspect_image=scene == UploadScene.PRODUCT,
                image_profile=resolved_profile.value if resolved_profile is not None else None,
            )
        except ValueError as exc:
            status_code, code, message = _IMAGE_STAGE_ERROR_MESSAGES.get(
                str(exc),
                (422, ErrorCode.ASSET_TYPE_NOT_ALLOWED, "文件内容与声明类型不匹配"),
            )
            raise AppException(status_code=status_code, code=code, message=message) from exc
        except OSError as exc:
            raise AppException(
                status_code=503, code=ErrorCode.ASSET_STORAGE_FAILED, message="文件存储暂时不可用"
            ) from exc

        if staged.mime_type not in policy.mime_types:
            await self._storage.discard(staged)
            raise AppException(
                status_code=422, code=ErrorCode.ASSET_TYPE_NOT_ALLOWED, message="文件类型不适用于当前场景"
            )

        try:
            duplicate = await self._assets.find_duplicate(
                uploader_type=uploader.type.value,
                uploader_id=uploader.id,
                scene=scene.value,
                file_hash=staged.file_hash,
            )
        except SQLAlchemyError as exc:
            await self._storage.discard(staged)
            raise AppException(
                status_code=503, code=ErrorCode.SERVICE_UNAVAILABLE, message="资产服务暂时不可用"
            ) from exc
        if duplicate is not None:
            primary_exists = await self._storage.exists(duplicate.file_key)
            thumb_needed = duplicate.thumb_file_key is not None and not await self._storage.exists(
                duplicate.thumb_file_key
            )
            if primary_exists and not thumb_needed:
                await self._storage.discard(staged)
            else:
                await self._commit_staged(
                    staged,
                    duplicate.file_key,
                    thumb_file_key=duplicate.thumb_file_key if thumb_needed else None,
                )
            return AssetRead.model_validate(duplicate)

        asset_id = new_uuid7()
        date_bucket = datetime.now(UTC).strftime("%Y%m%d")
        base_prefix = f"{scene.value}/{date_bucket}/{staged.file_hash[:16]}_{asset_id.hex}"
        file_key = f"{base_prefix}.{staged.extension}"
        url = f"{self._settings.upload_base_url}/{file_key}"
        thumb_file_key: str | None = None
        thumb_url: str | None = None
        if staged.thumbnail is not None:
            thumb_file_key = f"{base_prefix}_thumb.webp"
            thumb_url = f"{self._settings.upload_base_url}/{thumb_file_key}"

        asset = Asset(
            id=asset_id,
            uploader_type=uploader.type.value,
            uploader_id=uploader.id,
            storage_driver=self._storage.driver,
            file_key=file_key,
            original_name=safe_name,
            mime_type=staged.mime_type,
            file_size=staged.file_size,
            width=staged.image.width if staged.image else None,
            height=staged.image.height if staged.image else None,
            frame_count=staged.image.frame_count if staged.image else None,
            file_hash=staged.file_hash,
            url=url,
            thumb_file_key=thumb_file_key,
            thumb_url=thumb_url,
            thumb_file_size=staged.thumbnail.file_size if staged.thumbnail else None,
            thumb_width=staged.thumbnail.width if staged.thumbnail else None,
            thumb_height=staged.thumbnail.height if staged.thumbnail else None,
            scene=scene.value,
        )
        await self._commit_staged(staged, file_key, thumb_file_key=thumb_file_key)
        try:
            async with transaction_scope(self._session):
                self._assets.add(asset)
                await self._session.flush()
        except IntegrityError as exc:
            await self._delete_committed_files(file_key, thumb_file_key)
            duplicate = await self._assets.find_duplicate(
                uploader_type=uploader.type.value,
                uploader_id=uploader.id,
                scene=scene.value,
                file_hash=staged.file_hash,
            )
            if duplicate is not None:
                return AssetRead.model_validate(duplicate)
            raise AppException(status_code=409, code=ErrorCode.STATE_CONFLICT, message="相同资产已存在") from exc
        except SQLAlchemyError as exc:
            await self._delete_committed_files(file_key, thumb_file_key)
            raise AppException(
                status_code=503, code=ErrorCode.SERVICE_UNAVAILABLE, message="资产服务暂时不可用"
            ) from exc
        return AssetRead.model_validate(asset)

    async def list(
        self,
        *,
        page: int,
        page_size: int,
        search: str | None = None,
        scene: UploadScene | None = None,
        uploader_type: UploaderType | None = None,
    ) -> AssetPage:
        try:
            items, total = await self._assets.list(
                page=page,
                page_size=page_size,
                search=search.strip() if search and search.strip() else None,
                scene=scene.value if scene else None,
                uploader_type=uploader_type.value if uploader_type else None,
            )
        except SQLAlchemyError as exc:
            raise AppException(
                status_code=503, code=ErrorCode.SERVICE_UNAVAILABLE, message="资产服务暂时不可用"
            ) from exc
        return AssetPage.create(
            items=[AssetRead.model_validate(item) for item in items],
            page=page,
            page_size=page_size,
            total=total,
        )

    async def delete(
        self, *, asset_id: uuid.UUID, actor_id: uuid.UUID, actor_session_id: uuid.UUID | None = None
    ) -> None:
        await self._delete_many(
            asset_ids=[asset_id],
            actor_id=actor_id,
            actor_session_id=actor_session_id,
            action="asset.delete",
            target_type="asset",
            target_id=asset_id,
            missing_message="文件资产不存在",
        )

    async def delete_bulk(
        self, *, asset_ids: builtins.list[uuid.UUID], actor_id: uuid.UUID, actor_session_id: uuid.UUID | None = None
    ) -> AssetBulkDeleteResult:
        return await self._delete_many(
            asset_ids=asset_ids,
            actor_id=actor_id,
            actor_session_id=actor_session_id,
            action="assets:delete-bulk",
            target_type="asset_batch",
            target_id=None,
            missing_message="一个或多个文件资产不存在",
        )

    async def _delete_many(
        self,
        *,
        asset_ids: builtins.list[uuid.UUID],
        actor_id: uuid.UUID,
        actor_session_id: uuid.UUID | None,
        action: str,
        target_type: str,
        target_id: uuid.UUID | None,
        missing_message: str,
    ) -> AssetBulkDeleteResult:
        deletions: builtins.list[tuple[uuid.UUID, StagedDeletion]] = []
        operation_completed = False
        audit = AdminAuditCoordinator(
            audit=AuditCoordinator(
                session=self._session,
                session_factory=self._session_factory,
                actor_id=actor_id,
                metadata=self._metadata,
            ),
            session=self._session,
            actor_id=actor_id,
            session_id=actor_session_id,
        )

        async def operation() -> AssetBulkDeleteResult:
            nonlocal operation_completed
            assets = await self._assets.get_many(asset_ids, for_update=True)
            if len(assets) != len(asset_ids):
                raise AppException(status_code=404, code=ErrorCode.ASSET_NOT_FOUND, message=missing_message)
            commerce_access = CommerceAccessRepository(self._session)
            for asset in assets:
                if await commerce_access.asset_is_category_icon(asset.id):
                    raise AppException(
                        status_code=409, code=ErrorCode.STATE_CONFLICT, message="分类图标正在被使用，无法删除"
                    )
                if await commerce_access.asset_is_product_image(asset.id) or await commerce_access.asset_is_brand_logo(
                    asset.id
                ):
                    raise AppException(
                        status_code=409, code=ErrorCode.STATE_CONFLICT, message="商品或品牌图片正在被使用，无法删除"
                    )
                if await commerce_access.asset_is_merchant_album_image(asset.id):
                    raise AppException(
                        status_code=409, code=ErrorCode.STATE_CONFLICT, message="商家相册图片正在被使用，无法删除"
                    )
                if await self._assets.is_referenced_by_avatar(asset.url):
                    raise AppException(
                        status_code=409, code=ErrorCode.STATE_CONFLICT, message="头像资产正在被使用，无法删除"
                    )
            for asset in assets:
                keys_to_delete = [asset.file_key]
                if asset.thumb_file_key is not None:
                    keys_to_delete.append(asset.thumb_file_key)
                for key in keys_to_delete:
                    try:
                        deletion = await self._storage.stage_delete(key)
                    except (OSError, ValueError) as exc:
                        raise AppException(
                            status_code=503,
                            code=ErrorCode.ASSET_STORAGE_FAILED,
                            message="文件存储暂时不可用",
                        ) from exc
                    deletions.append((asset.id, deletion))
            for asset in assets:
                await self._assets.delete(asset)
            operation_completed = True
            return AssetBulkDeleteResult(
                completed_count=len(assets),
                target_ids=[asset.id for asset in assets],
            )

        try:
            result = await audit.execute(
                action=action,
                target_type=target_type,
                target_id=target_id,
                changed_fields={
                    "asset_ids": [str(current_id) for current_id in asset_ids],
                    "deleted": True,
                },
                operation=operation,
            )
        except BaseException as original_exc:
            try:
                if operation_completed:
                    for _, deletion in reversed(deletions):
                        async with self._session_factory() as session, transaction_scope(session):
                            asset = await AssetRepository(session).get_by_any_file_key(
                                deletion.file_key, for_update=True
                            )
                            if asset is None:
                                await self._storage.purge(deletion)
                            else:
                                await self._storage.restore(deletion)
                else:
                    await self._restore_deletions(deletions)
            except AppException as restore_exc:
                raise restore_exc from original_exc
            except (OSError, ValueError, SQLAlchemyError) as recovery_exc:
                logger.opt(exception=recovery_exc).critical("asset deletion outcome recovery failed; journal retained")
                raise AppException(
                    status_code=503,
                    code=ErrorCode.ASSET_STORAGE_FAILED,
                    message="文件删除结果需要人工核查",
                ) from original_exc
            raise
        await self._purge_deletions(deletions)
        return result

    async def _restore_deletions(self, deletions: builtins.list[tuple[uuid.UUID, StagedDeletion]]) -> None:
        first_error: OSError | ValueError | None = None
        for asset_id, deletion in reversed(deletions):
            try:
                await self._storage.restore(deletion)
            except (OSError, ValueError) as exc:
                first_error = first_error or exc
                logger.bind(asset_id=str(asset_id)).opt(exception=exc).critical(
                    "failed to restore asset after database rollback"
                )
        if first_error is not None:
            raise AppException(
                status_code=503,
                code=ErrorCode.ASSET_STORAGE_FAILED,
                message="文件删除结果需要人工核查",
            ) from first_error

    async def _purge_deletions(self, deletions: builtins.list[tuple[uuid.UUID, StagedDeletion]]) -> None:
        for asset_id, deletion in deletions:
            try:
                await self._storage.purge(deletion)
            except (OSError, ValueError) as exc:
                logger.bind(asset_id=str(asset_id)).opt(exception=exc).critical("failed to purge deleted asset trash")

    def _policy(self, scene: UploadScene) -> ScenePolicy:
        if scene in _SCENE_POLICIES:
            return _SCENE_POLICIES[scene]
        allowed = self._settings.allowed_upload_extensions
        mime_types = frozenset(
            {
                "image/jpeg",
                "image/png",
                "image/webp",
                "image/gif",
                "application/pdf",
                "application/msword",
                "application/vnd.ms-excel",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "application/zip",
            }
        )
        return ScenePolicy(self._settings.upload_max_file_size_mb * 1024 * 1024, allowed, mime_types)

    @staticmethod
    def _safe_filename(original_name: str) -> tuple[str, str]:
        name = PurePosixPath(original_name.replace("\\", "/")).name.strip()
        if not name or len(name) > 255 or "\x00" in name:
            raise AppException(status_code=422, code=ErrorCode.ASSET_TYPE_NOT_ALLOWED, message="文件名无效")
        suffix = PurePosixPath(name).suffix.lower().removeprefix(".")
        if not suffix or not suffix.isascii() or not suffix.isalnum():
            raise AppException(status_code=422, code=ErrorCode.ASSET_TYPE_NOT_ALLOWED, message="文件扩展名无效")
        return name, suffix

    async def _commit_staged(self, staged: StagedFile, file_key: str, *, thumb_file_key: str | None = None) -> None:
        try:
            await self._storage.commit(staged, file_key=file_key, thumb_file_key=thumb_file_key)
        except OSError as exc:
            await self._storage.discard(staged)
            raise AppException(
                status_code=503, code=ErrorCode.ASSET_STORAGE_FAILED, message="文件存储暂时不可用"
            ) from exc

    async def _delete_committed_files(self, file_key: str, thumb_file_key: str | None = None) -> None:
        for key in (file_key, thumb_file_key):
            if key is None:
                continue
            try:
                deletion = await self._storage.stage_delete(key)
                await self._storage.purge(deletion)
            except OSError as exc:
                logger.bind(file_key=key).opt(exception=exc).critical("failed to compensate committed asset file")


async def resolve_admin_avatar(*, session: AsyncSession, settings: Settings, avatar: str | None) -> str | None:
    value = avatar.strip() if avatar else None
    if not value:
        return None
    try:
        parsed = urlsplit(value)
    except ValueError as exc:
        raise AppException(status_code=422, code=ErrorCode.VALIDATION_ERROR, message="头像地址无效") from exc
    if parsed.netloc or parsed.scheme:
        origins = [urlsplit(origin) for origin in settings.cors_origins]
        if not any(
            parsed.netloc.lower() == origin.netloc.lower() and (not parsed.scheme or parsed.scheme == origin.scheme)
            for origin in origins
        ):
            return value
    path = posixpath.normpath(unquote(parsed.path))
    prefix = settings.upload_base_url.rstrip("/") + "/"
    if not path.startswith(prefix):
        return value
    asset = await AssetRepository(session).get_by_file_key(path[len(prefix) :], for_update=True)
    if asset is None or asset.url != path:
        raise AppException(status_code=404, code=ErrorCode.ASSET_NOT_FOUND, message="头像资产不存在或已删除")
    return asset.url


__all__ = ["AssetService", "AssetUploader", "recover_asset_deletions", "resolve_admin_avatar"]
