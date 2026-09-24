"""Exclusion rules: host only, edits while OPEN (PRD §4.4, §8)."""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import EventAccess, get_db, require_event_state, require_host
from app.models.event import EventState
from app.schemas.exclusions import ExclusionCreate, ExclusionList
from app.services import exclusions as service

router = APIRouter(prefix="/events/{event_id}/exclusions", tags=["exclusions"])

# Dependency order is the check order: participant (404) → host (403) → state (409).
# FR-EXC-5: non-hosts get 403 HOST_ONLY on every route, reads included.


@router.get("", response_model=ExclusionList)
async def list_exclusions(
    access: EventAccess = Depends(require_host),
    session: AsyncSession = Depends(get_db),
) -> ExclusionList:
    return await service.list_exclusions(session, access.event)


@router.post("", status_code=201, response_model=ExclusionList)
async def create_exclusions(
    data: ExclusionCreate,
    access: EventAccess = Depends(require_host),
    _state: EventAccess = Depends(require_event_state(EventState.OPEN, roster=True)),
    session: AsyncSession = Depends(get_db),
) -> ExclusionList:
    """2 ids: a pair. 3+: the group helper. Idempotent; returns the whole list."""
    return await service.create_exclusions(session, access.event, data.user_ids)


@router.delete("/{exclusion_id}", response_model=ExclusionList)
async def delete_exclusion(
    exclusion_id: uuid.UUID,
    access: EventAccess = Depends(require_host),
    _state: EventAccess = Depends(require_event_state(EventState.OPEN, roster=True)),
    session: AsyncSession = Depends(get_db),
) -> ExclusionList:
    """Returns the remaining list (200, not 204) so the client gets the new ``feasible``."""
    return await service.delete_exclusion(session, access.event, exclusion_id)
