"""Invite links and joining (PRD §4.3, FR-AUTH-5).

The token is a bearer secret: anyone holding it may preview and join, nobody else can.
It is never logged (the access log records the route template, not the path).
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.models.event import Event, EventParticipant, EventState
from app.models.user import User
from app.schemas.events import UserPublic
from app.schemas.invites import InvitePreview, JoinBlockReason, JoinResult
from app.services.events import count_participants, new_invite_token

# Tokens are 43 URL-safe characters; anything far longer is not worth a query.
MAX_TOKEN_LENGTH = 128


async def regenerate_invite(session: AsyncSession, event: Event) -> Event:
    """A new token; the old one stops working at once. Also re-enables a disabled link."""
    event.invite_token = new_invite_token()
    await session.commit()
    return event


async def disable_invite(session: AsyncSession, event: Event) -> Event:
    event.invite_token = None
    await session.commit()
    return event


async def _event_by_token(session: AsyncSession, token: str, *, for_update: bool = False) -> Event:
    if not token or len(token) > MAX_TOKEN_LENGTH:
        raise AppError("INVITE_INVALID", 404)
    stmt = select(Event).where(Event.invite_token == token)
    if for_update:
        stmt = stmt.with_for_update()
    event = (await session.execute(stmt)).scalar_one_or_none()
    if event is None:
        raise AppError("INVITE_INVALID", 404)
    return event


async def is_participant(session: AsyncSession, event_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    found = await session.scalar(
        select(EventParticipant.id).where(
            EventParticipant.event_id == event_id, EventParticipant.user_id == user_id
        )
    )
    return found is not None


def _block_reason(event: Event, already_participant: bool) -> JoinBlockReason | None:
    """FR-INV-4, in the order the join screen should explain them."""
    if already_participant:
        return "ALREADY_PARTICIPANT"
    if event.state != EventState.OPEN:
        return "EVENT_ALREADY_DRAWN"  # drawn or archived: joining is closed for good
    if event.join_deadline is not None and event.join_deadline <= datetime.now(UTC):
        return "JOIN_DEADLINE_PASSED"
    return None


async def preview_invite(session: AsyncSession, token: str, user: User) -> InvitePreview:
    event = await _event_by_token(session, token)
    host = await session.get(User, event.host_id)
    if host is None:  # pragma: no cover - host_id is a NOT NULL FK
        raise AppError("INVITE_INVALID", 404)
    already = await is_participant(session, event.id, user.id)
    reason = _block_reason(event, already)
    return InvitePreview(
        event_name=event.name,
        host=UserPublic(id=host.id, name=host.name, avatar_url=host.avatar_url),
        budget_crc=event.budget_crc,
        exchange_at=event.exchange_at,
        participant_count=await count_participants(session, event.id),
        already_participant=already,
        event_id=event.id if already else None,
        joinable=reason is None,
        reason=reason,
    )


async def join_event(session: AsyncSession, token: str, user: User) -> JoinResult:
    """Join through the link. The event row is locked (``FOR UPDATE``) for the whole check
    and insert, so a join can't slip in while the draw runs (CLAUDE.md §2.3, §2.4)."""
    event = await _event_by_token(session, token, for_update=True)
    reason = _block_reason(event, await is_participant(session, event.id, user.id))
    if reason == "ALREADY_PARTICIPANT":
        raise AppError("ALREADY_PARTICIPANT", 409, event_id=str(event.id))
    if reason is not None:
        raise AppError(reason, 409)

    event_id = event.id
    session.add(EventParticipant(event_id=event_id, user_id=user.id))
    try:
        await session.commit()
    except IntegrityError as exc:
        # A concurrent join by the same user won the unique (event_id, user_id) constraint.
        await session.rollback()
        raise AppError("ALREADY_PARTICIPANT", 409, event_id=str(event_id)) from exc
    return JoinResult(event_id=event_id)
