from app.core.config import Settings

from .base import StagedDeletion, StagedFile, StagedThumbnail, StorageProvider
from .images import (
    IMAGE_PROFILES,
    ImageMetadata,
    ImageProfileSpec,
    ProcessedImageResult,
    ProcessedImageVariant,
    inspect_image_bytes,
    process_image_bytes,
)
from .local import LocalStorageProvider


def create_storage_provider(settings: Settings) -> StorageProvider:
    if settings.upload_storage_driver == "local":
        return LocalStorageProvider(settings.upload_local_root, io_concurrency=settings.upload_io_concurrency)
    raise ValueError("unsupported upload storage driver")


__all__ = [
    "IMAGE_PROFILES",
    "ImageMetadata",
    "ImageProfileSpec",
    "LocalStorageProvider",
    "ProcessedImageResult",
    "ProcessedImageVariant",
    "StagedDeletion",
    "StagedFile",
    "StagedThumbnail",
    "StorageProvider",
    "create_storage_provider",
    "inspect_image_bytes",
    "process_image_bytes",
]
