"""Wishlists: view any participant's list; manage your own (PRD §4.6, §8).

Edits are allowed while OPEN or DRAWN; an ARCHIVED event is read-only (409
``EVENT_ARCHIVED``, CLAUDE.md §2.6). Check order: participant (404) → owner (404) → state.
"""

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    EventAccess,
    WishlistItemAccess,
    get_db,
    require_event_state,
    require_participant,
    require_wishlist_owner,
)
from app.models.event import EventState
from app.schemas.wishlists import ItemCreate, ItemOrder, ItemOut, ItemUpdate, WishlistOut
from app.services import wishlists as service

router = APIRouter(prefix="/events/{event_id}", tags=["wishlists"])

editable = require_event_state(EventState.OPEN, EventState.DRAWN)


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
) -> ItemOut:
    return await service.create_item(session, access.event, access.user.id, data)


@router.patch("/wishlist/items/{item_id}", response_model=ItemOut)
async def update_item(
    changes: ItemUpdate,
    owned: WishlistItemAccess = Depends(require_wishlist_owner),
    _state: EventAccess = Depends(editable),
    session: AsyncSession = Depends(get_db),
) -> ItemOut:
    return await service.update_item(session, owned.event, owned.item, changes)


@router.delete("/wishlist/items/{item_id}", status_code=204)
async def delete_item(
    owned: WishlistItemAccess = Depends(require_wishlist_owner),
    _state: EventAccess = Depends(editable),
    session: AsyncSession = Depends(get_db),
) -> Response:
    await service.delete_item(session, owned.event, owned.item)
    return Response(status_code=204)


@router.put("/wishlist/order", response_model=list[ItemOut])
async def reorder(
    order: ItemOrder,
    access: EventAccess = Depends(require_participant),
    _state: EventAccess = Depends(editable),
    session: AsyncSession = Depends(get_db),
) -> list[ItemOut]:
    return await service.reorder(session, access.event, access.user.id, order.item_ids)
