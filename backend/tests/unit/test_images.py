"""The photo pipeline (CLAUDE.md §7 Uploads, PRD FR-WSH-3)."""

import io

import pytest
from PIL import ExifTags, Image

from app.storage.images import (
    LONG_EDGE,
    MAX_BYTES,
    THUMB_EDGE,
    ImageRejectedError,
    Rendition,
    process_image,
)
from tests import images

SIGNATURES = (b"Exif", b"GPS", b"Apple", b"iPhone", b"xmpmeta", b"secret", b"ICCP")


def open_webp(rendition: Rendition) -> Image.Image:
    image = Image.open(io.BytesIO(rendition.data))
    assert image.format == "WEBP"
    assert image.size == (rendition.width, rendition.height)
    return image


def assert_no_metadata(rendition: Rendition) -> None:
    image = open_webp(rendition)
    assert dict(image.getexif()) == {}
    for key in ("exif", "xmp", "XML:com.adobe.xmp", "icc_profile", "comment"):
        assert key not in image.info, key
    for signature in SIGNATURES:
        assert signature not in rendition.data, signature


def test_fixture_really_has_gps() -> None:
    """Guard the guard: the input carries what we claim to strip."""
    source = Image.open(io.BytesIO(images.jpeg_with_gps()))
    exif = source.getexif()
    assert exif[ExifTags.Base.Make] == "Apple"
    assert exif.get_ifd(ExifTags.IFD.GPSInfo)[ExifTags.GPS.GPSLatitudeRef] == "N"
    assert "icc_profile" in source.info


def test_jpeg_with_gps_loses_all_metadata_and_is_resized() -> None:
    result = process_image(images.jpeg_with_gps((2400, 1800)))
    assert_no_metadata(result.main)
    assert_no_metadata(result.thumb)
    assert (result.main.width, result.main.height) == (LONG_EDGE, 1200)
    assert (result.thumb.width, result.thumb.height) == (THUMB_EDGE, 300)
    assert (result.width, result.height) == (LONG_EDGE, 1200)


def test_exif_orientation_is_applied() -> None:
    result = process_image(images.rotated_jpeg())
    image = open_webp(result.main).convert("RGB")
    assert image.size == (100, 200)
    top, bottom = image.getpixel((50, 20)), image.getpixel((50, 180))
    assert isinstance(top, tuple)
    assert isinstance(bottom, tuple)
    assert top[0] > 150 > top[2], top  # red on top
    assert bottom[2] > 150 > bottom[0], bottom
    assert_no_metadata(result.main)  # the Orientation tag is gone too


def test_png_keeps_its_transparency() -> None:
    result = process_image(images.png_with_alpha())
    image = open_webp(result.main)
    assert image.mode == "RGBA"
    transparent, opaque = image.getpixel((10, 100)), image.getpixel((290, 100))
    assert isinstance(transparent, tuple)
    assert isinstance(opaque, tuple)
    assert transparent[3] == 0
    assert opaque[3] == 255


def test_heic_is_accepted() -> None:
    result = process_image(images.heic((640, 480)))
    assert (result.main.width, result.main.height) == (640, 480)  # never upscaled
    assert (result.thumb.width, result.thumb.height) == (THUMB_EDGE, 300)
    assert_no_metadata(result.main)


def test_small_images_are_never_upscaled() -> None:
    result = process_image(images.small_png((64, 48)))
    assert (result.main.width, result.main.height) == (64, 48)
    assert (result.thumb.width, result.thumb.height) == (64, 48)


def test_portrait_long_edge_is_the_height() -> None:
    result = process_image(images.jpeg_with_gps((1000, 3000)))
    assert max(result.main.width, result.main.height) <= LONG_EDGE
    assert result.main.height == LONG_EDGE
    assert max(result.thumb.width, result.thumb.height) <= THUMB_EDGE


@pytest.mark.parametrize(
    "data",
    [
        pytest.param(b"just some notes, renamed to notes.jpg\n", id="txt renamed to jpg"),
        pytest.param(b"", id="empty"),
        pytest.param(b"%PDF-1.7\n%...", id="pdf"),
        pytest.param(images.jpeg_with_gps((200, 100))[:300], id="truncated jpeg"),
    ],
)
def test_non_images_are_unsupported(data: bytes) -> None:
    with pytest.raises(ImageRejectedError) as caught:
        process_image(data)
    assert caught.value.code == "UNSUPPORTED_IMAGE"


def test_other_real_formats_are_unsupported() -> None:
    """A valid GIF (or BMP, TIFF…) is still refused: only the four formats pass."""
    for fmt in ("GIF", "BMP", "TIFF"):
        out = io.BytesIO()
        Image.new("RGB", (20, 20), images.RED).save(out, format=fmt)
        with pytest.raises(ImageRejectedError) as caught:
            process_image(out.getvalue())
        assert caught.value.code == "UNSUPPORTED_IMAGE", fmt


def test_files_over_10_mb_are_refused_before_decoding() -> None:
    with pytest.raises(ImageRejectedError) as caught:
        process_image(b"\xff\xd8" + b"\0" * MAX_BYTES)
    assert caught.value.code == "FILE_TOO_LARGE"


def test_decompression_bombs_are_refused() -> None:
    data = images.huge_dimensions_png()
    assert len(data) < MAX_BYTES  # small file, 60 MP of pixels
    with pytest.raises(ImageRejectedError) as caught:
        process_image(data)
    assert caught.value.code == "IMAGE_TOO_LARGE"
