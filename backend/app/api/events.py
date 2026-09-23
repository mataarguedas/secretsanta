"""Events: create, dashboard lists, detail, edit, delete (PRD §4.2, §8)."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    EventAccess,
    current_user,
    get_db,
    require_event_state,
    require_host,
    require_participant,
)
from app.models.event import EventState
from app.models.user import User
from app.schemas.events import (
    EventCreate,
    EventDetail,
    EventPage,
    EventUpdate,
    HostEventDetail,
    Section,
)
from app.services import events as service
from app.services import invites as invite_service

router = APIRouter(prefix="/events", tags=["events"])

# The host's detail carries invite_token; everyone else's has no such key at all.
DetailResponse = HostEventDetail | EventDetail


@router.post("", status_code=201, response_model=DetailResponse)
async def create_event(
    data: EventCreate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_db),
) -> EventDetail:
    event = await service.create_event(session, user, data)
    return await service.build_event_detail(session, event, user)


@router.get("", response_model=EventPage)
async def list_events(
    section: Annotated[Section, Query()],
    cursor: Annotated[str | None, Query(max_length=200)] = None,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_db),
) -> EventPage:
    return await service.list_events(session, user.id, section, cursor)


@router.get("/{event_id}", response_model=DetailResponse)
async def get_event(
    access: EventAccess = Depends(require_participant),
    session: AsyncSession = Depends(get_db),
) -> EventDetail:
    return await service.build_event_detail(session, access.event, access.user)


# Dependency order is the check order: participant (404) → host (403) → state (409).
@router.patch("/{event_id}", response_model=DetailResponse)
async def update_event(
    changes: EventUpdate,
    access: EventAccess = Depends(require_host),
    _state: EventAccess = Depends(require_event_state(EventState.OPEN, EventState.DRAWN)),
    session: AsyncSession = Depends(get_db),
) -> EventDetail:
    event = await service.update_event(session, access.event, changes)
    return await service.build_event_detail(session, event, access.user)


@router.delete("/{event_id}", status_code=204)
async def delete_event(
    access: EventAccess = Depends(require_host),
    _state: EventAccess = Depends(require_event_state(EventState.OPEN)),
    session: AsyncSession = Depends(get_db),
) -> Response:
    await service.delete_event(session, access.event)
    return Response(status_code=204)


@router.post("/{event_id}/invite/regenerate", response_model=HostEventDetail)
async def regenerate_invite(
    access: EventAccess = Depends(require_host),
    _state: EventAccess = Depends(require_event_state(EventState.OPEN)),
    session: AsyncSession = Depends(get_db),
) -> EventDetail:
    """FR-INV-2: a new link; the old one stops working. Also re-enables a disabled link."""
    event = await invite_service.regenerate_invite(session, access.event)
    return await service.build_event_detail(session, event, access.user)


@router.delete("/{event_id}/invite", response_model=HostEventDetail)
async def disable_invite(
    access: EventAccess = Depends(require_host),
    _state: EventAccess = Depends(require_event_state(EventState.OPEN, EventState.DRAWN)),
    session: AsyncSession = Depends(get_db),
) -> EventDetail:
    """FR-INV-2: turn the link off (token NULL). Archived events are read-only."""
    event = await invite_service.disable_invite(session, access.event)
    return await service.build_event_detail(session, event, access.user)
