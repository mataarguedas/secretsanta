"""Shared handling of image uploads (CLAUDE.md §7 Uploads). Routes call ``process_upload``."""

import asyncio
from typing import Final

from fastapi import UploadFile

from app.core.errors import AppError
from app.storage.images import MAX_BYTES, ImageRejectedError, ProcessedImage, process_image

CHUNK: Final = 64 * 1024

_STATUS: Final[dict[str, int]] = {
    "FILE_TOO_LARGE": 413,
    "IMAGE_TOO_LARGE": 413,
    "UNSUPPORTED_IMAGE": 415,
}


async def read_upload(file: UploadFile, limit: int = MAX_BYTES) -> bytes:
    """Read at most ``limit + 1`` bytes in chunks; one byte over the limit is enough to say
    no, so an oversized file is never held in memory whole."""
    buffer = bytearray()
    while chunk := await file.read(CHUNK):
        buffer += chunk
        if len(buffer) > limit:
            raise AppError("FILE_TOO_LARGE", 413)
    return bytes(buffer)


async def process_upload(file: UploadFile) -> ProcessedImage:
    """Read, sniff, clean and resize. v1 runs in the request (off the event loop), and
    ``process_image`` is pure so it can move to the worker later."""
    data = await read_upload(file)
    try:
        return await asyncio.to_thread(process_image, data)
    except ImageRejectedError as exc:
        raise AppError(exc.code, _STATUS[exc.code]) from None
