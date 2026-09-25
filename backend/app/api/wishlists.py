"""Wishlists: view any participant's list; manage your own (PRD §4.6, §8).

Edits are allowed while OPEN or DRAWN; an ARCHIVED event is read-only (409
``EVENT_ARCHIVED``, CLAUDE.md §2.6). Check order: participant (404) → owner (404) → state.
"""

import uuid

from fastapi import APIRouter, Depends, File, Request, Response, UploadFile
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    EventAccess,
    WishlistItemAccess,
    get_db,
    get_redis,
    require_event_state,
    require_own_item,
    require_participant,
    require_source_event,
    require_wishlist_owner,
)
from app.api.uploads import process_upload
from app.core.rate_limit import upload_rate_limit
from app.models.event import Event, EventState
from app.schemas.wishlists import (
    CopySourceOut,
    ItemCreate,
    ItemOrder,
    ItemOut,
    ItemUpdate,
    WishlistOut,
)
from app.services import wishlist_photos as photo_service
from app.services import wishlists as service

router = APIRouter(prefix="/events/{event_id}", tags=["wishlists"])
photos_router = APIRouter(prefix="/wishlist/items/{item_id}/photos", tags=["wishlists"])

editable = require_event_state(EventState.OPEN, EventState.DRAWN)
own_editable_item = require_own_item(EventState.OPEN, EventState.DRAWN)


@router.get("/wishlists/{user_id}", response_model=WishlistOut)
async def get_wishlist(
    user_id: uuid.UUID,
    access: EventAccess = Depends(require_participant),
    session: AsyncSession = Depends(get_db),
) -> WishlistOut:
    return await service.get_wishlist(session, access.event, user_id, access.user.id)


@router.post("/wishlist/items", status_code=201, response_model=ItemOut)
async def create_item(
    data: ItemCreate,
    access: EventAccess = Depends(require_participant),
    _state: EventAccess = Depends(editable),
    session: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> ItemOut:
    return await service.create_item(session, redis, access.event, access.user.id, data)


@router.patch("/wishlist/items/{item_id}", response_model=ItemOut)
async def update_item(
    changes: ItemUpdate,
    owned: WishlistItemAccess = Depends(require_wishlist_owner),
    _state: EventAccess = Depends(editable),
    session: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> ItemOut:
    return await service.update_item(session, redis, owned.event, owned.item, changes)


@router.delete("/wishlist/items/{item_id}", status_code=204)
async def delete_item(
    owned: WishlistItemAccess = Depends(require_wishlist_owner),
    _state: EventAccess = Depends(editable),
    session: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> Response:
    await service.delete_item(session, redis, owned.event, owned.item)
    return Response(status_code=204)


@router.put("/wishlist/order", response_model=list[ItemOut])
async def reorder(
    order: ItemOrder,
    access: EventAccess = Depends(require_participant),
    _state: EventAccess = Depends(editable),
    session: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> list[ItemOut]:
    return await service.reorder(session, redis, access.event, access.user.id, order.item_ids)


@router.get("/wishlist/copy-sources", response_model=list[CopySourceOut])
async def copy_sources(
    access: EventAccess = Depends(require_participant),
    session: AsyncSession = Depends(get_db),
) -> list[CopySourceOut]:
    """The caller's other events whose wishlist (their own) has items: what "Copy from
    another event" offers."""
    return await photo_service.copy_sources(session, access.event, access.user.id)


@router.post("/wishlist/copy-from/{other_event_id}", status_code=201, response_model=list[ItemOut])
async def copy_from(
    access: EventAccess = Depends(require_participant),
    _state: EventAccess = Depends(editable),
    source: Event = Depends(require_source_event),
    session: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> list[ItemOut]:
    """FR-WSH-5: the caller must participate in both events; the source may be in any
    state, the target must be editable. Returns the new items."""
    return await photo_service.copy_from(session, redis, access.event, access.user.id, source)


# ── Photos (addressed by item id; the event comes from the item) ─────────────


@photos_router.post("", status_code=201, response_model=ItemOut)
@upload_rate_limit
async def upload_photo(
    request: Request,
    file: UploadFile = File(...),
    owned: WishlistItemAccess = Depends(own_editable_item),
    session: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> ItemOut:
    """Owner, OPEN or DRAWN. At most 3 per item (409 ``PHOTO_LIMIT_REACHED``). Returns the
    item with its photos."""
    await photo_service.ensure_photo_slot(session, owned.item)
    image = await process_upload(file)
    return await photo_service.add_photo(session, redis, owned.event, owned.item, image)


@photos_router.delete("/{photo_id}", status_code=204)
async def delete_photo(
    photo_id: uuid.UUID,
    owned: WishlistItemAccess = Depends(own_editable_item),
    session: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> Response:
    await photo_service.delete_photo(session, redis, owned.event, owned.item, photo_id)
    return Response(status_code=204)
