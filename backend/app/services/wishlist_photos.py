"""Wishlist photos and copy-from-event (PRD FR-WSH-3, FR-WSH-5, CLAUDE.md §7 Uploads).

Storage objects are written before the short DB transaction that references them, and
removed again if that transaction doesn't commit. Objects whose rows are deleted go
through the worker after the commit. So a committed row always has its objects, and a
failure leaves at worst an orphan object, never a broken row.
"""

import asyncio
import uuid
from collections.abc import Iterable

from redis.asyncio import Redis
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import AppError
from app.core.logging import get_logger
from app.db.uuid7 import uuid7
from app.models.event import Event, EventParticipant, EventState
from app.models.wishlist import MAX_PHOTOS_PER_ITEM, WishlistItem, WishlistPhoto
from app.schemas.wishlists import CopySourceOut, ItemOut
from app.services.wishlists import item_out, on_wishlist_changed_if_drawn, reload_item
from app.storage.images import ProcessedImage
from app.storage.r2 import ObjectStorage, get_storage
from app.worker.queue import enqueue_after_commit

log = get_logger(__name__)

EDITABLE = (EventState.OPEN, EventState.DRAWN)


def photo_keys(event_id: uuid.UUID, item_id: uuid.UUID) -> tuple[str, str]:
    base = f"events/{event_id}/items/{item_id}/{uuid.uuid4().hex}"
    return f"{base}.webp", f"{base}_thumb.webp"


# ── Upload ───────────────────────────────────────────────────────────────────


async def _photo_count(session: AsyncSession, item_id: uuid.UUID) -> int:
    count = await session.scalar(
        select(func.count()).select_from(WishlistPhoto).where(WishlistPhoto.item_id == item_id)
    )
    return count or 0


async def ensure_photo_slot(session: AsyncSession, item: WishlistItem) -> None:
    """Cheap early check, so a full item is refused before the image is processed. The
    authoritative check is repeated under the lock in ``add_photo``."""
    if await _photo_count(session, item.id) >= MAX_PHOTOS_PER_ITEM:
        raise AppError("PHOTO_LIMIT_REACHED", 409)


async def add_photo(
    session: AsyncSession,
    redis: "Redis",
    event: Event,
    item: WishlistItem,
    image: ProcessedImage,
) -> ItemOut:
    """Store the objects, then, under a lock on the item row, re-check the limit and take
    the lowest free position. The DB trigger is the backstop for anything that slips by."""
    main, thumb = photo_keys(event.id, item.id)
    storage = get_storage()
    await asyncio.to_thread(storage.put, main, image.main.data)
    await asyncio.to_thread(storage.put, thumb, image.thumb.data)

    try:
        await _lock_editable(session, event.id)
        locked = await session.scalar(
            select(WishlistItem).where(WishlistItem.id == item.id).with_for_update()
        )
        if locked is None:  # deleted while the image was being processed
            raise AppError("WISHLIST_ITEM_NOT_FOUND", 404)
        taken = set(
            (
                await session.scalars(
                    select(WishlistPhoto.position).where(WishlistPhoto.item_id == item.id)
                )
            ).all()
        )
        if len(taken) >= MAX_PHOTOS_PER_ITEM:
            raise AppError("PHOTO_LIMIT_REACHED", 409)
        position = min(set(range(MAX_PHOTOS_PER_ITEM)) - taken)
        session.add(
            WishlistPhoto(
                item_id=item.id,
                object_key=main,
                thumb_key=thumb,
                width=image.main.width,
                height=image.main.height,
                position=position,
            )
        )
        await session.commit()
    except IntegrityError:
        await session.rollback()
        await _discard([main, thumb])
        raise AppError("PHOTO_LIMIT_REACHED", 409) from None
    except BaseException:
        await session.rollback()
        await _discard([main, thumb])
        raise
    await on_wishlist_changed_if_drawn(session, redis, event, item.user_id)
    return item_out(await reload_item(session, item.id))


async def _lock_editable(session: AsyncSession, event_id: uuid.UUID) -> None:
    """Share-lock the event and re-check that it's still editable: archiving (an UPDATE)
    waits for us, and we don't write into an event archived since the route's check."""
    state = await session.scalar(
        select(Event.state).where(Event.id == event_id).with_for_update(read=True)
    )
    if state not in EDITABLE:
        raise AppError("EVENT_ARCHIVED", 409)


async def delete_photo(
    session: AsyncSession,
    redis: "Redis",
    event: Event,
    item: WishlistItem,
    photo_id: uuid.UUID,
) -> None:
    """The freed position is reused by the next upload; the objects go after the commit."""
    photo = await session.scalar(
        select(WishlistPhoto).where(WishlistPhoto.id == photo_id, WishlistPhoto.item_id == item.id)
    )
    if photo is None:
        raise AppError("PHOTO_NOT_FOUND", 404)
    enqueue_after_commit(session, "delete_objects", [photo.object_key, photo.thumb_key])
    await session.delete(photo)
    await session.commit()
    await on_wishlist_changed_if_drawn(session, redis, event, item.user_id)


# ── Copy from another event ──────────────────────────────────────────────────


async def copy_sources(
    session: AsyncSession, event: Event, user_id: uuid.UUID
) -> list[CopySourceOut]:
    """The caller's other events (any state) where their own wishlist has items."""
    count = func.count(WishlistItem.id)
    rows = await session.execute(
        select(Event.id, Event.name, count)
        .join(
            EventParticipant,
            (EventParticipant.event_id == Event.id) & (EventParticipant.user_id == user_id),
        )
        .join(
            WishlistItem,
            (WishlistItem.event_id == Event.id) & (WishlistItem.user_id == user_id),
        )
        .where(Event.id != event.id)
        .group_by(Event.id)
        .order_by(Event.exchange_at.desc(), Event.id)
    )
    return [
        CopySourceOut(event_id=event_id, name=name, item_count=items)
        for event_id, name, items in rows.tuples()
    ]


async def copy_from(
    session: AsyncSession,
    redis: "Redis",
    event: Event,
    owner_id: uuid.UUID,
    source: Event,
) -> list[ItemOut]:
    """FR-WSH-5: append a copy of every item of the owner's list in ``source``, same order,
    with each photo copied server-side to new keys under this event and the new item. The
    new items are independent: deleting one never touches the original's objects.

    The route holds the target event's row lock. If anything fails, the DB is rolled back
    and every object already copied is deleted."""
    if source.id == event.id:
        raise AppError("WISHLIST_COPY_SAME_EVENT", 422)
    originals = (
        await session.scalars(
            select(WishlistItem)
            .where(WishlistItem.event_id == source.id, WishlistItem.user_id == owner_id)
            .options(selectinload(WishlistItem.photos))
            .order_by(WishlistItem.position, WishlistItem.id)
        )
    ).all()
    if not originals:
        return []

    last = await session.scalar(
        select(func.max(WishlistItem.position)).where(
            WishlistItem.event_id == event.id, WishlistItem.user_id == owner_id
        )
    )
    start = 0 if last is None else last + 1
    pending: list[tuple[str, str]] = []  # (source key, new key)
    new_ids: list[uuid.UUID] = []
    for offset, original in enumerate(originals):
        new_id = uuid7()
        photos: list[WishlistPhoto] = []
        for photo in original.photos:
            main, thumb = photo_keys(event.id, new_id)
            pending += [(photo.object_key, main), (photo.thumb_key, thumb)]
            photos.append(
                WishlistPhoto(
                    item_id=new_id,
                    object_key=main,
                    thumb_key=thumb,
                    width=photo.width,
                    height=photo.height,
                    position=photo.position,
                )
            )
        session.add(
            WishlistItem(
                id=new_id,
                event_id=event.id,
                user_id=owner_id,
                title=original.title,
                note=original.note,
                url=original.url,
                price_crc=original.price_crc,
                priority=original.priority,
                position=start + offset,
                photos=photos,
            )
        )
        new_ids.append(new_id)

    copied: list[str] = []
    try:
        await asyncio.to_thread(_copy_objects, get_storage(), pending, copied)
        await session.commit()
    except BaseException:
        await session.rollback()
        await _discard(copied)
        raise
    log.info("wishlist_copied", items=len(new_ids), photos=len(pending) // 2)
    await on_wishlist_changed_if_drawn(session, redis, event, owner_id)

    rows = await session.scalars(
        select(WishlistItem)
        .where(WishlistItem.id.in_(new_ids))
        .options(selectinload(WishlistItem.photos))
        .order_by(WishlistItem.position)
        .execution_options(populate_existing=True)
    )
    return [item_out(item) for item in rows.all()]


def _copy_objects(
    storage: ObjectStorage, pairs: Iterable[tuple[str, str]], copied: list[str]
) -> None:
    """Server-side copies. ``copied`` records each finished destination as it goes, so the
    caller can clean up after a failure half-way."""
    for source_key, dest_key in pairs:
        storage.copy(source_key, dest_key)
        copied.append(dest_key)


async def _discard(keys: list[str]) -> None:
    if not keys:
        return
    try:
        await asyncio.to_thread(get_storage().delete_many, keys)
    except Exception:  # an orphan object is harmless; the original error matters more
        log.exception("photo_discard_failed")
