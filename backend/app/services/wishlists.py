"""Wishlist rules (PRD §4.6). Routes check membership, ownership and state (OPEN or DRAWN;
archived events are read-only) through the shared dependencies."""

import uuid
from typing import cast

from redis.asyncio import Redis
from sqlalchemy import ColumnElement, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import AppError
from app.core.logging import get_logger
from app.models.event import Event, EventParticipant, EventState
from app.models.user import User
from app.models.wishlist import WishlistItem, WishlistPhoto
from app.notifications.keys import WISHLIST_DEBOUNCE_SECONDS, wishlist_debounce_key
from app.schemas.events import UserPublic
from app.schemas.wishlists import (
    ItemCreate,
    ItemOut,
    ItemUpdate,
    PhotoOut,
    Priority,
    WishlistOut,
)
from app.storage.r2 import get_storage
from app.worker.queue import enqueue_after_commit, enqueue_committed

log = get_logger(__name__)

# ── Reads ────────────────────────────────────────────────────────────────────


async def get_wishlist(
    session: AsyncSession, event: Event, owner_id: uuid.UUID, viewer_id: uuid.UUID
) -> WishlistOut:
    """FR-WSH-6: any participant sees any participant's list, in the owner's order."""
    owner = await session.scalar(
        select(User)
        .join(EventParticipant, EventParticipant.user_id == User.id)
        .where(EventParticipant.event_id == event.id, User.id == owner_id)
    )
    if owner is None:
        raise AppError("PARTICIPANT_NOT_FOUND", 404)
    return WishlistOut(
        owner=UserPublic(id=owner.id, name=owner.name, avatar_url=owner.avatar_url),
        is_self=owner.id == viewer_id,
        items=await list_items(session, event.id, owner.id),
    )


async def list_items(
    session: AsyncSession, event_id: uuid.UUID, owner_id: uuid.UUID
) -> list[ItemOut]:
    rows = await session.scalars(
        select(WishlistItem)
        .where(WishlistItem.event_id == event_id, WishlistItem.user_id == owner_id)
        .options(selectinload(WishlistItem.photos))
        .order_by(WishlistItem.position, WishlistItem.id)
    )
    return [item_out(item) for item in rows.all()]


def item_out(item: WishlistItem) -> ItemOut:
    storage = get_storage()
    return ItemOut(
        id=item.id,
        title=item.title,
        note=item.note,
        url=item.url,
        price_crc=item.price_crc,
        priority=cast(Priority, item.priority),
        position=item.position,
        photos=[
            PhotoOut(
                id=photo.id,
                url=storage.presign_get(photo.object_key),
                thumb_url=storage.presign_get(photo.thumb_key),
                width=photo.width,
                height=photo.height,
            )
            for photo in item.photos
        ],
    )


async def reload_item(session: AsyncSession, item_id: uuid.UUID) -> WishlistItem:
    item = await session.scalar(
        select(WishlistItem)
        .where(WishlistItem.id == item_id)
        .options(selectinload(WishlistItem.photos))
        .execution_options(populate_existing=True)
    )
    if item is None:  # pragma: no cover - just written in this request
        raise AppError("WISHLIST_ITEM_NOT_FOUND", 404)
    return item


# ── Writes (the route holds the event row lock) ──────────────────────────────


async def create_item(
    session: AsyncSession, redis: "Redis", event: Event, owner_id: uuid.UUID, data: ItemCreate
) -> ItemOut:
    """Appends at the end of the owner's list."""
    last = await session.scalar(
        select(func.max(WishlistItem.position)).where(
            WishlistItem.event_id == event.id, WishlistItem.user_id == owner_id
        )
    )
    item = WishlistItem(
        event_id=event.id,
        user_id=owner_id,
        position=0 if last is None else last + 1,
        **data.model_dump(),
    )
    session.add(item)
    await session.commit()
    await on_wishlist_changed_if_drawn(session, redis, event, owner_id)
    return item_out(await reload_item(session, item.id))


async def update_item(
    session: AsyncSession, redis: "Redis", event: Event, item: WishlistItem, changes: ItemUpdate
) -> ItemOut:
    for field, value in changes.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    await session.commit()
    await on_wishlist_changed_if_drawn(session, redis, event, item.user_id)
    return item_out(await reload_item(session, item.id))


async def delete_item(
    session: AsyncSession, redis: "Redis", event: Event, item: WishlistItem
) -> None:
    """The photos' storage objects are deleted by the worker after the commit."""
    keys = await _photo_keys(session, WishlistPhoto.item_id == item.id)
    if keys:
        enqueue_after_commit(session, "delete_objects", keys)
    owner_id = item.user_id
    await session.execute(delete(WishlistItem).where(WishlistItem.id == item.id))
    await session.commit()
    await on_wishlist_changed_if_drawn(session, redis, event, owner_id)


async def reorder(
    session: AsyncSession,
    redis: "Redis",
    event: Event,
    owner_id: uuid.UUID,
    item_ids: list[uuid.UUID],
) -> list[ItemOut]:
    """``item_ids`` must be exactly the owner's items (FR-WSH-4)."""
    items = {
        item.id: item
        for item in (
            await session.scalars(
                select(WishlistItem).where(
                    WishlistItem.event_id == event.id, WishlistItem.user_id == owner_id
                )
            )
        ).all()
    }
    if set(item_ids) != items.keys() or len(item_ids) != len(items):
        raise AppError("WISHLIST_ORDER_MISMATCH", 422)
    for position, item_id in enumerate(item_ids):
        items[item_id].position = position
    await session.commit()
    await on_wishlist_changed_if_drawn(session, redis, event, owner_id)
    return await list_items(session, event.id, owner_id)


async def delete_user_items(session: AsyncSession, event_id: uuid.UUID, user_id: uuid.UUID) -> None:
    """Part of removing a participant: their items go, photos after the commit. The caller
    commits."""
    owned = select(WishlistItem.id).where(
        WishlistItem.event_id == event_id, WishlistItem.user_id == user_id
    )
    keys = await _photo_keys(session, WishlistPhoto.item_id.in_(owned))
    if keys:
        enqueue_after_commit(session, "delete_objects", keys)
    await session.execute(
        delete(WishlistItem).where(
            WishlistItem.event_id == event_id, WishlistItem.user_id == user_id
        )
    )


async def _photo_keys(session: AsyncSession, condition: ColumnElement[bool]) -> list[str]:
    rows = await session.execute(
        select(WishlistPhoto.object_key, WishlistPhoto.thumb_key).where(condition)
    )
    return [key for pair in rows.all() for key in pair]


# ── Hooks ────────────────────────────────────────────────────────────────────


async def on_wishlist_changed_if_drawn(
    session: AsyncSession, redis: "Redis", event: Event, owner_id: uuid.UUID
) -> None:
    if event.state == EventState.DRAWN:
        await on_wishlist_changed(session, redis, event.id, owner_id)


async def on_wishlist_changed(
    session: AsyncSession, redis: "Redis", event_id: uuid.UUID, owner_id: uuid.UUID
) -> None:
    """After a committed change to a wishlist in a DRAWN event (FR-WSH-7): at most one push
    per owner per 10 minutes. The first change sets the debounce key and queues the push;
    later ones within the window are absorbed. The worker finds the giver; the job holds
    only the event and owner ids, and the push never names the owner (FR-NTF-4)."""
    key = wishlist_debounce_key(event_id, owner_id)
    try:
        first = await redis.set(key, "1", nx=True, ex=WISHLIST_DEBOUNCE_SECONDS)
    except Exception:  # the change is saved; a missed push is harmless, a 500 isn't
        log.warning("wishlist_debounce_failed")
        return
    if first:
        enqueue_committed(session, "send_wishlist_updated", str(event_id), str(owner_id))
