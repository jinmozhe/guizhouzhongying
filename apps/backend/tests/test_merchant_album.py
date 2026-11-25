"""商家相册校验与契约单元测试资产（按项目策略需明确授权后执行 pytest）。"""

from uuid import UUID

import pytest
from pydantic import ValidationError

from app.core.exceptions import AppException
from app.core.identifiers import new_uuid7
from app.db.models import Asset
from app.services.local_actors import validate_merchant_album_assets
from app.services.local_commerce_schemas import (
    MERCHANT_ALBUM_MAX_COUNT,
    MERCHANT_ALBUM_MAX_FILE_BYTES,
    MerchantInput,
    MerchantUpdate,
)


def _fake_asset(
    *,
    asset_id: UUID | None = None,
    uploader_type: str = "admin",
    scene: str = "product",
    mime_type: str = "image/jpeg",
    file_size: int = 1024 * 512,
    width: int | None = 1200,
    height: int | None = 900,
    frame_count: int | None = 1,
) -> Asset:
    uid = asset_id or new_uuid7()
    return Asset(
        id=uid,
        uploader_type=uploader_type,
        uploader_id=new_uuid7(),
        storage_driver="local",
        file_key=f"{scene}/{uid.hex}.jpg",
        original_name="store.jpg",
        mime_type=mime_type,
        file_size=file_size,
        width=width,
        height=height,
        frame_count=frame_count,
        file_hash="a" * 64,
        url=f"/static/uploads/{scene}/{uid.hex}.jpg",
        scene=scene,
    )


def test_merchant_album_schema_rejects_duplicate_and_explicit_null() -> None:
    repeated = new_uuid7()
    with pytest.raises(ValidationError):
        MerchantInput(name="测试商家", phone_e164="13800138000", album_image_asset_ids=[repeated, repeated])

    with pytest.raises(ValidationError):
        MerchantUpdate(
            name="测试商家",
            phone_e164="13800138000",
            revision=1,
            album_image_asset_ids=None,
        )

    omitted = MerchantUpdate(name="测试商家", phone_e164="13800138000", revision=1)
    assert "album_image_asset_ids" not in omitted.model_fields_set

    cleared = MerchantUpdate(name="测试商家", phone_e164="13800138000", revision=1, album_image_asset_ids=[])
    assert "album_image_asset_ids" in cleared.model_fields_set
    assert cleared.album_image_asset_ids == []


def test_validate_merchant_album_assets_enforces_budget_and_metadata() -> None:
    ok_assets = [_fake_asset(file_size=2 * 1024 * 1024) for _ in range(3)]
    validate_merchant_album_assets([item.id for item in ok_assets], {item.id: item for item in ok_assets})

    too_many = [_fake_asset() for _ in range(MERCHANT_ALBUM_MAX_COUNT + 1)]
    with pytest.raises(AppException, match="最多支持"):
        validate_merchant_album_assets([item.id for item in too_many], {item.id: item for item in too_many})

    oversize_single = _fake_asset(file_size=MERCHANT_ALBUM_MAX_FILE_BYTES + 1)
    with pytest.raises(AppException, match="5 MiB"):
        validate_merchant_album_assets([oversize_single.id], {oversize_single.id: oversize_single})

    # 11 张每张 5 MiB = 55 MiB，超过整组 50 MiB 上限
    oversize_group = [_fake_asset(file_size=MERCHANT_ALBUM_MAX_FILE_BYTES) for _ in range(11)]
    with pytest.raises(AppException, match="50 MiB"):
        validate_merchant_album_assets([item.id for item in oversize_group], {item.id: item for item in oversize_group})

    animated = _fake_asset(mime_type="image/webp", frame_count=3)
    with pytest.raises(AppException, match="静态图片"):
        validate_merchant_album_assets([animated.id], {animated.id: animated})

    missing_dimensions = _fake_asset(width=None, height=None, frame_count=None)
    with pytest.raises(AppException, match="未核验尺寸"):
        validate_merchant_album_assets([missing_dimensions.id], {missing_dimensions.id: missing_dimensions})

    wrong_scene = _fake_asset(scene="avatar")
    with pytest.raises(AppException, match="商品/商家图片资产"):
        validate_merchant_album_assets([wrong_scene.id], {wrong_scene.id: wrong_scene})

    wrong_mime = _fake_asset(mime_type="image/gif")
    with pytest.raises(AppException, match="JPG、PNG 或 WebP"):
        validate_merchant_album_assets([wrong_mime.id], {wrong_mime.id: wrong_mime})
