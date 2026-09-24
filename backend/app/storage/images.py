"""The photo pipeline (CLAUDE.md §7 Uploads, PRD FR-WSH-3). PURE and worker-safe: bytes in,
bytes out, no I/O, so it can move to the worker later unchanged.

Never trust the file name or content type: the format is sniffed from the bytes, and only
JPEG, PNG, WebP and HEIC/HEIF are accepted. Every piece of metadata is dropped (EXIF with
GPS, XMP, comments); colours are converted to sRGB so the ICC profile can go too.
"""

import io
import warnings
from dataclasses import dataclass
from typing import Final

import pillow_heif
from PIL import Image, ImageCms, ImageOps, UnidentifiedImageError

pillow_heif.register_heif_opener()

MAX_BYTES: Final = 10 * 1024 * 1024
# Decompression-bomb guard, checked before decoding: 50 MP covers any phone camera.
MAX_PIXELS: Final = 50_000_000
LONG_EDGE: Final = 1600
THUMB_EDGE: Final = 400
WEBP_QUALITY: Final = 82
ALLOWED_FORMATS: Final = ("JPEG", "PNG", "WEBP", "HEIF")

_SRGB = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB"))


class ImageRejectedError(Exception):
    """The upload can't be used. ``code`` is a stable API error code."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True, slots=True)
class Rendition:
    data: bytes
    width: int
    height: int


@dataclass(frozen=True, slots=True)
class ProcessedImage:
    """WebP bytes with no metadata: the display size (≤ 1600px) and a thumbnail (≤ 400px)."""

    main: Rendition
    thumb: Rendition

    # Convenience for callers that store width/height of the main image.
    @property
    def width(self) -> int:
        return self.main.width

    @property
    def height(self) -> int:
        return self.main.height


def process_image(data: bytes) -> ProcessedImage:
    if len(data) > MAX_BYTES:
        raise ImageRejectedError("FILE_TOO_LARGE")
    image = _open(data)
    image = ImageOps.exif_transpose(image)
    image = _to_srgb(image)
    clean = _strip(image)

    main = clean.copy()
    main.thumbnail((LONG_EDGE, LONG_EDGE), Image.Resampling.LANCZOS)  # never upscales
    thumb = clean.copy()
    thumb.thumbnail((THUMB_EDGE, THUMB_EDGE), Image.Resampling.LANCZOS)
    return ProcessedImage(main=_webp(main), thumb=_webp(thumb))


def _open(data: bytes) -> Image.Image:
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        try:
            image = Image.open(io.BytesIO(data), formats=ALLOWED_FORMATS)
            width, height = image.size
            if width * height > MAX_PIXELS:
                raise ImageRejectedError("IMAGE_TOO_LARGE")
            image.load()
        except ImageRejectedError:
            raise
        except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
            raise ImageRejectedError("IMAGE_TOO_LARGE") from exc
        except (UnidentifiedImageError, OSError, ValueError, SyntaxError) as exc:
            # Not an allowed format, or truncated/corrupt data.
            raise ImageRejectedError("UNSUPPORTED_IMAGE") from exc
    return image


def _has_alpha(image: Image.Image) -> bool:
    return image.mode in ("RGBA", "LA", "PA") or (
        image.mode == "P" and "transparency" in image.info
    )


def _to_srgb(image: Image.Image) -> Image.Image:
    """RGB or RGBA in sRGB. Embedded ICC profiles (Display P3, Adobe RGB…) are applied."""
    mode = "RGBA" if _has_alpha(image) else "RGB"
    icc = image.info.get("icc_profile")
    if icc and image.mode in ("RGB", "RGBA", "CMYK"):
        try:
            source = ImageCms.ImageCmsProfile(io.BytesIO(icc))
            converted = ImageCms.profileToProfile(image, source, _SRGB, outputMode=mode)
            if converted is not None:
                return converted
        except (ImageCms.PyCMSError, OSError):
            pass  # a broken profile: fall back to a plain conversion
    return image.convert(mode)


def _strip(image: Image.Image) -> Image.Image:
    """A new image built from the pixels only, so no info/EXIF/XMP/ICC can come along."""
    return Image.frombytes(image.mode, image.size, image.tobytes())


def _webp(image: Image.Image) -> Rendition:
    out = io.BytesIO()
    image.save(out, format="WEBP", quality=WEBP_QUALITY, method=4)
    return Rendition(data=out.getvalue(), width=image.width, height=image.height)
