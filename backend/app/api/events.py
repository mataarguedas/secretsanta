"""Events: create, dashboard lists, detail, edit, delete (PRD §4.2, §8)."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, Query, Request, Response, UploadFile
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    EventAccess,
    current_user,
    get_db,
    get_redis,
    require_event_state,
    require_host,
    require_participant,
)
from app.api.uploads import process_upload
from app.core.rate_limit import upload_rate_limit
from app.db.mixins import utcnow
from app.models.event import EventState
from app.models.user import User
from app.schemas.events import (
    DrawResult,
    EventCreate,
    EventDetail,
    EventPage,
    EventUpdate,
    HostEventDetail,
    ParticipantPublic,
    Section,
)
from app.services import covers as cover_service
from app.services import events as service
from app.services import invites as invite_service
from app.services import reveal as reveal_service

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


@router.get("/{event_id}/participants", response_model=list[ParticipantPublic])
async def list_participants(
    access: EventAccess = Depends(require_participant),
    session: AsyncSession = Depends(get_db),
) -> list[ParticipantPublic]:
    return await service.list_participants(session, access.event, access.user.id)


@router.delete("/{event_id}/participants/{user_id}", status_code=204)
async def remove_participant(
    user_id: uuid.UUID,
    access: EventAccess = Depends(require_host),
    _state: EventAccess = Depends(require_event_state(EventState.OPEN, roster=True)),
    session: AsyncSession = Depends(get_db),
) -> Response:
    """Host, OPEN only (frozen roster after the draw, CLAUDE.md §2.3)."""
    await service.remove_participant(session, access.event, user_id)
    return Response(status_code=204)


@router.post("/{event_id}/leave", status_code=204)
async def leave_event(
    access: EventAccess = Depends(require_participant),
    _state: EventAccess = Depends(require_event_state(EventState.OPEN, roster=True)),
    session: AsyncSession = Depends(get_db),
) -> Response:
    """Participant, OPEN only. The host can't leave (HOST_CANNOT_LEAVE)."""
    await service.remove_participant(session, access.event, access.user.id)
    return Response(status_code=204)


@router.post("/{event_id}/draw", response_model=DrawResult)
async def draw_event(
    access: EventAccess = Depends(require_host),
    session: AsyncSession = Depends(get_db),
    redis: "Redis" = Depends(get_redis),
) -> DrawResult:
    """FR-DRW: the reveal. The service locks the event and checks state, count and
    feasibility itself, all in one transaction. The response never carries a pair."""
    await reveal_service.run_draw(session, redis, access.event.id)
    return DrawResult(state="drawn")


@router.post("/{event_id}/archive", response_model=HostEventDetail)
async def archive_event(
    access: EventAccess = Depends(require_host),
    _state: EventAccess = Depends(require_event_state(EventState.DRAWN)),
    session: AsyncSession = Depends(get_db),
) -> EventDetail:
    """PRD §3: host, DRAWN only (an OPEN event is deleted, not archived; 409
    ``EVENT_NOT_DRAWN``), and only once the exchange has passed (409 ``ARCHIVE_TOO_EARLY``)."""
    event = await service.archive_event(session, access.event, utcnow())
    return await service.build_event_detail(session, event, access.user)


@router.post("/{event_id}/cover", response_model=HostEventDetail)
@upload_rate_limit
async def upload_cover(
    request: Request,
    file: UploadFile = File(...),
    access: EventAccess = Depends(require_host),
    _state: EventAccess = Depends(require_event_state(EventState.OPEN)),
    session: AsyncSession = Depends(get_db),
) -> EventDetail:
    """Host, OPEN only. Replaces any existing cover; the old objects are deleted after
    the commit. Format is sniffed from the bytes, never from the name or content type."""
    image = await process_upload(file)
    event = await cover_service.set_cover(session, access.event, image)
    return await service.build_event_detail(session, event, access.user)


@router.delete("/{event_id}/cover", response_model=HostEventDetail)
async def remove_cover(
    access: EventAccess = Depends(require_host),
    _state: EventAccess = Depends(require_event_state(EventState.OPEN)),
    session: AsyncSession = Depends(get_db),
) -> EventDetail:
    event = await cover_service.remove_cover(session, access.event)
    return await service.build_event_detail(session, event, access.user)
