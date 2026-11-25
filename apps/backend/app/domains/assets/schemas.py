import uuid
from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.pagination import PageResult


class UploadScene(StrEnum):
    AVATAR = "avatar"
    ARTICLE = "article"
    PRODUCT = "product"
    DOCUMENT = "document"
    ATTACHMENT = "attachment"
    TEMP = "temp"


class ImageProfile(StrEnum):
    """服务端图片自动缩放、转 WebP 与 480px 缩略图派生档位。"""

    PRODUCT_GALLERY = "product_gallery"
    PRODUCT_DETAIL = "product_detail"
    MERCHANT_ALBUM = "merchant_album"
    LOGO_ICON = "logo_icon"
    AVATAR = "avatar"


class UploaderType(StrEnum):
    ADMIN = "admin"
    USER = "user"
    SYSTEM = "system"


class AssetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: uuid.UUID = Field(description="文件资产唯一标识")
    uploader_type: UploaderType = Field(description="上传主体类型")
    uploader_id: uuid.UUID | None = Field(description="上传主体唯一标识，系统任务可为空")
    storage_driver: str = Field(description="保存文件的存储驱动代码")
    file_key: str = Field(description="存储驱动中的相对文件键")
    original_name: str = Field(description="上传时经过路径剥离的原始文件名")
    mime_type: str = Field(description="服务端探测得到的真实 MIME 类型")
    file_size: int = Field(description="文件大小，单位为字节")
    width: int | None = Field(default=None, gt=0, description="服务端确认的展示宽度，历史未处理或非图片为空")
    height: int | None = Field(default=None, gt=0, description="服务端确认的展示高度，历史未处理或非图片为空")
    frame_count: int | None = Field(default=None, gt=0, description="服务端完整解码确认的帧数，未处理为空")
    file_hash: str = Field(description="文件内容的 SHA-256 哈希值")
    url: str = Field(description="文件的公开访问 URL 或站内路径")
    thumb_url: str | None = Field(default=None, description="480px 缩略图公开访问 URL，未生成时为空")
    thumb_file_size: int | None = Field(default=None, gt=0, description="480px 缩略图文件大小，单位为字节")
    thumb_width: int | None = Field(default=None, gt=0, description="480px 缩略图宽度，像素")
    thumb_height: int | None = Field(default=None, gt=0, description="480px 缩略图高度，像素")
    scene: UploadScene = Field(description="受控的文件使用场景")
    created_at: datetime = Field(description="创建时间")
    updated_at: datetime = Field(description="最近更新时间")


AssetPage = PageResult[AssetRead]


class AssetBulkDeleteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    asset_ids: list[uuid.UUID] = Field(
        min_length=1,
        max_length=100,
        description="待批量硬删除的文件资产唯一标识列表",
    )

    @field_validator("asset_ids")
    @classmethod
    def validate_unique_asset_ids(cls, value: list[uuid.UUID]) -> list[uuid.UUID]:
        if len(value) != len(set(value)):
            raise ValueError("asset_ids must be unique")
        return value


class AssetBulkDeleteResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    completed_count: int = Field(ge=0, description="本次批量硬删除完成的资产数量")
    target_ids: list[uuid.UUID] = Field(description="本次批量硬删除处理的资产唯一标识列表")


__all__ = [
    "AssetBulkDeleteIn",
    "AssetBulkDeleteResult",
    "AssetPage",
    "AssetRead",
    "ImageProfile",
    "UploaderType",
    "UploadScene",
]
