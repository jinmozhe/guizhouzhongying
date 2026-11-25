from __future__ import annotations

from dataclasses import dataclass
from typing import BinaryIO, Protocol

from .images import ImageMetadata


@dataclass(frozen=True, slots=True)
class StagedThumbnail:
    """已落盘至暂存区的 480px 缩略图元数据。"""

    token: str
    file_size: int
    width: int
    height: int


@dataclass(frozen=True, slots=True)
class StagedFile:
    token: str
    file_size: int
    file_hash: str
    mime_type: str
    extension: str
    image: ImageMetadata | None = None
    thumbnail: StagedThumbnail | None = None


@dataclass(frozen=True, slots=True)
class StagedDeletion:
    token: str
    file_key: str


class StorageProvider(Protocol):
    driver: str

    async def stage(
        self,
        source: BinaryIO,
        *,
        extension: str,
        max_bytes: int,
        inspect_image: bool = False,
        image_profile: str | None = None,
    ) -> StagedFile: ...

    async def stage_bytes(
        self,
        payload: bytes,
        *,
        mime_type: str,
        extension: str,
        image: ImageMetadata | None = None,
        thumbnail_payload: bytes | None = None,
        thumbnail_dimensions: tuple[int, int] | None = None,
    ) -> StagedFile: ...

    async def read_bytes(self, file_key: str, *, max_bytes: int) -> bytes: ...

    async def inspect_image(
        self, file_key: str, *, expected_hash: str, mime_type: str, max_bytes: int
    ) -> ImageMetadata: ...

    async def commit(self, staged: StagedFile, *, file_key: str, thumb_file_key: str | None = None) -> None: ...

    async def discard(self, staged: StagedFile) -> None: ...

    async def exists(self, file_key: str) -> bool: ...

    async def stage_delete(self, file_key: str) -> StagedDeletion: ...

    async def restore(self, deletion: StagedDeletion) -> None: ...

    async def purge(self, deletion: StagedDeletion) -> None: ...

    async def pending_deletions(self) -> list[StagedDeletion]: ...


__all__ = ["StagedDeletion", "StagedFile", "StagedThumbnail", "StorageProvider"]
