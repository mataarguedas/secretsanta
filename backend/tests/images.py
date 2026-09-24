"""Test images built in code (no binary fixtures in the repo)."""

import io

from PIL import ExifTags, Image, ImageCms

RED = (220, 20, 20)
BLUE = (20, 20, 220)


def jpeg_with_gps(size: tuple[int, int] = (2400, 1800)) -> bytes:
    """A camera-like JPEG: GPS position, make/model, capture time, XMP and an ICC profile."""
    image = Image.new("RGB", size, RED)
    exif = Image.Exif()
    exif[ExifTags.Base.Make] = "Apple"
    exif[ExifTags.Base.Model] = "iPhone 15"
    exif[ExifTags.Base.DateTime] = "2026:09:24 10:00:00"
    gps = exif.get_ifd(ExifTags.IFD.GPSInfo)
    gps[ExifTags.GPS.GPSLatitudeRef] = "N"
    gps[ExifTags.GPS.GPSLatitude] = (9.0, 56.0, 12.5)
    gps[ExifTags.GPS.GPSLongitudeRef] = "W"
    gps[ExifTags.GPS.GPSLongitude] = (84.0, 5.0, 3.2)
    icc = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    xmp = b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><secret>here</secret></x:xmpmeta>'
    out = io.BytesIO()
    image.save(out, format="JPEG", exif=exif, icc_profile=icc, xmp=xmp, quality=90)
    return out.getvalue()


def rotated_jpeg() -> bytes:
    """Stored 200x100, red left half and blue right half, with EXIF Orientation 6 (the
    camera was turned): it must display 100x200 with red on top."""
    image = Image.new("RGB", (200, 100), BLUE)
    image.paste(RED, (0, 0, 100, 100))
    exif = Image.Exif()
    exif[ExifTags.Base.Orientation] = 6
    out = io.BytesIO()
    image.save(out, format="JPEG", exif=exif, quality=95)
    return out.getvalue()


def png_with_alpha() -> bytes:
    image = Image.new("RGBA", (300, 200), (*RED, 255))
    image.paste((0, 0, 0, 0), (0, 0, 150, 200))  # left half fully transparent
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


def heic(size: tuple[int, int] = (640, 480)) -> bytes:
    import pillow_heif

    pillow_heif.register_heif_opener()
    out = io.BytesIO()
    Image.new("RGB", size, BLUE).save(out, format="HEIF", quality=80)
    return out.getvalue()


def small_png(size: tuple[int, int] = (64, 48), color: tuple[int, int, int] = RED) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", size, color).save(out, format="PNG")
    return out.getvalue()


def huge_dimensions_png() -> bytes:
    """Few bytes, many pixels (a decompression bomb): 10000 x 6000 of one colour."""
    out = io.BytesIO()
    Image.new("L", (10_000, 6_000), 0).save(out, format="PNG", optimize=True)
    return out.getvalue()
