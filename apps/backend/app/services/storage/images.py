from __future__ import annotations

import io
import warnings
from dataclasses import dataclass

from PIL import Image, ImageCms, ImageOps, UnidentifiedImageError

_MAX_IMAGE_DECODE_SIDE = 12_000
_MAX_IMAGE_DECODE_FRAMES = 20
_MAX_IMAGE_DECODE_PIXELS = 50_000_000

_WEBP_OPAQUE_QUALITIES = (82, 76, 70, 62, 55)
_WEBP_ALPHA_QUALITIES = (85, 78, 72, 65, 58)
_SUPPORTED_IMAGE_FORMATS = {
    "image/jpeg": "JPEG",
    "image/png": "PNG",
    "image/webp": "WEBP",
}


@dataclass(frozen=True, slots=True)
class ImageMetadata:
    width: int
    height: int
    frame_count: int


@dataclass(frozen=True, slots=True)
class ImageProfileSpec:
    """单个业务场景的图片缩放、体积预算与缩略图派生规格。"""

    name: str
    max_width: int
    max_height: int
    max_bytes: int
    reject_tall_detail: bool = False
    thumb_max_width: int | None = None
    thumb_max_bytes: int = 80 * 1024


@dataclass(frozen=True, slots=True)
class ProcessedImageVariant:
    """单个已编码图片产物（主图或缩略图）。"""

    payload: bytes
    width: int
    height: int
    mime_type: str
    extension: str


@dataclass(frozen=True, slots=True)
class ProcessedImageResult:
    """图片处理流水线结果，包含主图及可选 480px 缩略图。"""

    primary: ProcessedImageVariant
    thumbnail: ProcessedImageVariant | None
    frame_count: int


IMAGE_PROFILES: dict[str, ImageProfileSpec] = {
    "product_gallery": ImageProfileSpec(
        name="product_gallery",
        max_width=1200,
        max_height=1200,
        max_bytes=300 * 1024,
        thumb_max_width=480,
        thumb_max_bytes=80 * 1024,
    ),
    "product_detail": ImageProfileSpec(
        name="product_detail",
        max_width=1200,
        max_height=2400,
        max_bytes=400 * 1024,
        reject_tall_detail=True,
    ),
    "merchant_album": ImageProfileSpec(
        name="merchant_album",
        max_width=1440,
        max_height=1440,
        max_bytes=400 * 1024,
        thumb_max_width=480,
        thumb_max_bytes=80 * 1024,
    ),
    "logo_icon": ImageProfileSpec(
        name="logo_icon",
        max_width=400,
        max_height=400,
        max_bytes=80 * 1024,
    ),
    "avatar": ImageProfileSpec(
        name="avatar",
        max_width=400,
        max_height=400,
        max_bytes=60 * 1024,
    ),
}


def inspect_image_bytes(payload: bytes, mime_type: str) -> ImageMetadata:
    """完整解码并核验静态或有限帧图片，不改写原始字节。"""
    expected = _SUPPORTED_IMAGE_FORMATS.get(mime_type)
    if expected is None:
        raise ValueError("unsupported_image")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(payload), formats=[expected]) as image:
                image.verify()
            with Image.open(io.BytesIO(payload), formats=[expected]) as image:
                width, height = image.size
                frames = int(getattr(image, "n_frames", 1))
                if (
                    width <= 0
                    or height <= 0
                    or max(width, height) > _MAX_IMAGE_DECODE_SIDE
                    or frames < 1
                    or frames > _MAX_IMAGE_DECODE_FRAMES
                    or width * height * frames > _MAX_IMAGE_DECODE_PIXELS
                ):
                    raise ValueError("image_resource_limit")
                orientation = image.getexif().get(274, 1)
                if orientation not in range(1, 9):
                    raise ValueError("image_orientation_invalid")
                for index in range(frames):
                    image.seek(index)
                    if image.width * image.height > _MAX_IMAGE_DECODE_PIXELS // frames:
                        raise ValueError("image_resource_limit")
                    image.load()
                if orientation in {5, 6, 7, 8}:
                    width, height = height, width
                return ImageMetadata(width=width, height=height, frame_count=frames)
    except (
        OSError,
        EOFError,
        SyntaxError,
        UnidentifiedImageError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ) as exc:
        raise ValueError("image_decode_failed") from exc


def _has_effective_alpha(image: Image.Image) -> bool:
    """判断图像是否包含真正半透明或全透明像素，避免纯不透明 32 位 PNG 浪费体积。"""
    if image.mode in {"RGBA", "LA"}:
        alpha = image.getchannel("A")
        extrema = alpha.getextrema()
        return isinstance(extrema, tuple) and isinstance(extrema[0], (int, float)) and extrema[0] < 255
    if image.mode == "P" and "transparency" in image.info:
        rgba = image.convert("RGBA")
        extrema = rgba.getchannel("A").getextrema()
        return isinstance(extrema, tuple) and isinstance(extrema[0], (int, float)) and extrema[0] < 255
    return False


def _normalize_srgb(image: Image.Image) -> tuple[Image.Image, bool]:
    """将任意源图像转换为标准 sRGB RGB/RGBA，同时兼容损坏 ICC 与 CMYK 图像。"""
    has_alpha = _has_effective_alpha(image)
    target_mode = "RGBA" if has_alpha else "RGB"
    icc_profile = image.info.get("icc_profile")
    working = image
    if working.mode == "P":
        working = working.convert(target_mode)
    elif working.mode == "LA":
        working = working.convert("RGBA" if has_alpha else "RGB")
    elif working.mode not in {"RGB", "RGBA", "CMYK", "L"}:
        working = working.convert(target_mode)

    if isinstance(icc_profile, bytes) and icc_profile:
        try:
            source_profile = ImageCms.ImageCmsProfile(io.BytesIO(icc_profile))
            srgb_profile = ImageCms.createProfile("sRGB")
            if working.mode == "RGBA":
                alpha = working.getchannel("A")
                converted = ImageCms.profileToProfile(
                    working.convert("RGB"), source_profile, srgb_profile, outputMode="RGB"
                )
                if converted is not None:
                    converted.putalpha(alpha)
                    return converted, True
            else:
                converted = ImageCms.profileToProfile(working, source_profile, srgb_profile, outputMode="RGB")
                if converted is not None:
                    return converted, False
        except OSError, ValueError, ImageCms.PyCMSError:
            pass

    if working.mode != target_mode:
        working = working.convert(target_mode)
    return working, has_alpha


def _resize_for_profile(image: Image.Image, spec: ImageProfileSpec) -> Image.Image:
    """按档位等比缩放（只缩不放）；商品详情图压宽后若仍超高则明确拦截。"""
    width, height = image.size
    if spec.reject_tall_detail:
        resized = image
        if width > spec.max_width:
            new_height = max(1, round(height * spec.max_width / width))
            resized = image.resize((spec.max_width, new_height), Image.Resampling.LANCZOS)
        if resized.height > spec.max_height:
            raise ValueError("image_too_tall_for_detail")
        return resized

    if width <= spec.max_width and height <= spec.max_height:
        return image
    scale = min(spec.max_width / width, spec.max_height / height)
    target_width = max(1, round(width * scale))
    target_height = max(1, round(height * scale))
    return image.resize((target_width, target_height), Image.Resampling.LANCZOS)


def _encode_webp(image: Image.Image, *, max_bytes: int, has_alpha: bool) -> bytes:
    """使用阶梯质量编码为无 EXIF 的 WebP；极端复杂纹理超过 1.5 倍预算时拒绝。"""
    qualities = _WEBP_ALPHA_QUALITIES if has_alpha else _WEBP_OPAQUE_QUALITIES
    best: bytes | None = None
    for quality in qualities:
        buffer = io.BytesIO()
        # 不写入 exif 与 icc_profile，彻底剥离隐私与冗余头部。
        image.save(buffer, format="WEBP", quality=quality, method=4)
        encoded = buffer.getvalue()
        if best is None or len(encoded) < len(best):
            best = encoded
        if len(encoded) <= max_bytes:
            return encoded
    assert best is not None
    if len(best) > int(max_bytes * 1.5):
        raise ValueError("image_budget_exceeded")
    return best


def process_image_bytes(payload: bytes, mime_type: str, profile: str) -> ProcessedImageResult:
    """按业务档位完整解码、矫正方向、转 sRGB、等比缩放、压缩为 WebP，并按需派生 480px 缩略图。"""
    expected = _SUPPORTED_IMAGE_FORMATS.get(mime_type)
    if expected is None:
        raise ValueError("unsupported_image")
    spec = IMAGE_PROFILES.get(profile)
    if spec is None:
        raise ValueError("unsupported_image_profile")

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(payload), formats=[expected]) as verified:
                verified.verify()
            with Image.open(io.BytesIO(payload), formats=[expected]) as opened:
                width, height = opened.size
                frames = int(getattr(opened, "n_frames", 1))
                if frames != 1:
                    raise ValueError("animated_image_not_allowed")
                if (
                    width <= 0
                    or height <= 0
                    or max(width, height) > _MAX_IMAGE_DECODE_SIDE
                    or width * height > _MAX_IMAGE_DECODE_PIXELS
                ):
                    raise ValueError("image_resource_limit")
                orientation = opened.getexif().get(274, 1)
                if orientation not in range(1, 9):
                    raise ValueError("image_orientation_invalid")
                opened.load()
                # 固化 EXIF 方向，避免部分端忽略旋转标签导致图片倒置。
                transposed = ImageOps.exif_transpose(opened)
                normalized, has_alpha = _normalize_srgb(transposed)
    except ValueError:
        raise
    except (
        OSError,
        EOFError,
        SyntaxError,
        UnidentifiedImageError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ) as exc:
        raise ValueError("image_decode_failed") from exc

    primary_image = _resize_for_profile(normalized, spec)
    primary_bytes = _encode_webp(primary_image, max_bytes=spec.max_bytes, has_alpha=has_alpha)
    primary_variant = ProcessedImageVariant(
        payload=primary_bytes,
        width=primary_image.width,
        height=primary_image.height,
        mime_type="image/webp",
        extension="webp",
    )

    thumbnail_variant: ProcessedImageVariant | None = None
    if spec.thumb_max_width is not None and primary_image.width > spec.thumb_max_width:
        thumb_width = spec.thumb_max_width
        thumb_height = max(1, round(primary_image.height * thumb_width / primary_image.width))
        thumb_image = primary_image.resize((thumb_width, thumb_height), Image.Resampling.LANCZOS)
        thumb_bytes = _encode_webp(thumb_image, max_bytes=spec.thumb_max_bytes, has_alpha=has_alpha)
        thumbnail_variant = ProcessedImageVariant(
            payload=thumb_bytes,
            width=thumb_image.width,
            height=thumb_image.height,
            mime_type="image/webp",
            extension="webp",
        )

    return ProcessedImageResult(
        primary=primary_variant,
        thumbnail=thumbnail_variant,
        frame_count=1,
    )


__all__ = [
    "IMAGE_PROFILES",
    "ImageMetadata",
    "ImageProfileSpec",
    "ProcessedImageResult",
    "ProcessedImageVariant",
    "inspect_image_bytes",
    "process_image_bytes",
]
