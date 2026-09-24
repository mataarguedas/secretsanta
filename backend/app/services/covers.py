"""Event cover photos (PRD FR-EVT-1). Objects live under ``events/{event_id}/cover/``; the
row stores the main key and the thumbnail key is derived from it."""

import asyncio
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.event import Event
from app.storage.images import ProcessedImage
from app.storage.r2 import get_storage
from app.worker.queue import enqueue_after_commit

log = get_logger(__name__)


def cover_keys(event_id: uuid.UUID) -> tuple[str, str]:
    name = uuid.uuid4().hex
    base = f"events/{event_id}/cover/{name}"
    return f"{base}.webp", f"{base}_thumb.webp"


def thumb_key(main_key: str) -> str:
    return main_key.removesuffix(".webp") + "_thumb.webp"


def event_prefix(event_id: uuid.UUID) -> str:
    """Everything an event owns in storage (cover and wishlist photos)."""
    return f"events/{event_id}/"


def cover_urls(event: Event) -> tuple[str | None, str | None]:
    """Presigned (1 h) GET URLs for the cover and its thumbnail, or ``(None, None)``."""
    key = event.cover_photo_key
    if not key:
        return None, None
    storage = get_storage()
    return storage.presign_get(key), storage.presign_get(thumb_key(key))


async def set_cover(session: AsyncSession, event: Event, image: ProcessedImage) -> Event:
    """Upload the new objects, point the row at them, and clean up the old ones after the
    commit. If the commit fails, the new objects are removed instead."""
    main, thumb = cover_keys(event.id)
    storage = get_storage()
    await asyncio.to_thread(storage.put, main, image.main.data)
    await asyncio.to_thread(storage.put, thumb, image.thumb.data)

    old = event.cover_photo_key
    event.cover_photo_key = main
    if old:
        enqueue_after_commit(session, "delete_objects", [old, thumb_key(old)])
    try:
        await session.commit()
    except BaseException:
        await session.rollback()
        await _discard(main, thumb)
        raise
    return event


async def remove_cover(session: AsyncSession, event: Event) -> Event:
    old = event.cover_photo_key
    if old:
        event.cover_photo_key = None
        enqueue_after_commit(session, "delete_objects", [old, thumb_key(old)])
        await session.commit()
    return event


async def _discard(*keys: str) -> None:
    try:
        await asyncio.to_thread(get_storage().delete_many, keys)
    except Exception:  # an orphan object is harmless; the original error matters more
        log.exception("cover_discard_failed")
