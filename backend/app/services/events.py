"""Event business rules (PRD §3, §4.2). Routers only validate, call these and serialize."""

import base64
import binascii
import json
import secrets
import uuid
from datetime import UTC, datetime
from typing import Any, Final, cast

from sqlalchemy import DateTime, Select, Uuid, and_, delete, func, literal, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.models.event import Event, EventParticipant, EventState
from app.models.user import User
from app.schemas.events import (
    DrawReadiness,
    EventCreate,
    EventDetail,
    EventPage,
    EventStateName,
    EventSummary,
    EventUpdate,
    HostEventDetail,
    ParticipantPublic,
    Section,
    UserPublic,
)
from app.services import chat as chat_service
from app.services.covers import cover_urls, event_prefix
from app.services.draw import MIN_PARTICIPANTS
from app.services.exclusions import check_feasible, delete_user_exclusions
from app.services.reveal import my_assignment
from app.services.wishlists import delete_user_items
from app.worker.queue import enqueue_after_commit

PAGE_SIZE: Final = 20
# PRD §3: after the draw only these may change.
DRAWN_EDITABLE: Final = frozenset({"description", "location", "is_online", "exchange_at"})


def new_invite_token() -> str:
    """FR-INV-1: URL-safe, 32 random bytes."""
    return secrets.token_urlsafe(32)


def _field_error(field: str) -> AppError:
    """Same shape as request validation errors (``core/errors.py``)."""
    return AppError(
        "VALIDATION_ERROR", 422, fields=[{"loc": ["body", field], "type": "value_error"}]
    )


# ── Reads ────────────────────────────────────────────────────────────────────


async def get_event_for_participant(
    session: AsyncSession, event_id: uuid.UUID, user_id: uuid.UUID, *, for_update: bool = False
) -> Event | None:
    """The event only if ``user_id`` participates in it (the host always does)."""
    stmt = (
        select(Event)
        .join(
            EventParticipant,
            and_(EventParticipant.event_id == Event.id, EventParticipant.user_id == user_id),
        )
        .where(Event.id == event_id)
    )
    if for_update:
        stmt = stmt.with_for_update(of=Event)
    return (await session.execute(stmt)).scalar_one_or_none()


def _participant_count() -> Any:
    return (
        select(func.count())
        .select_from(EventParticipant)
        .where(EventParticipant.event_id == Event.id)
        .correlate(Event)
        .scalar_subquery()
    )


async def count_participants(session: AsyncSession, event_id: uuid.UUID) -> int:
    count = await session.scalar(
        select(func.count())
        .select_from(EventParticipant)
        .where(EventParticipant.event_id == event_id)
    )
    return count or 0


async def build_event_detail(session: AsyncSession, event: Event, viewer: User) -> EventDetail:
    """The detail view for a participant; the host's view adds ``invite_token``."""
    is_host = viewer.id == event.host_id
    if is_host:
        host: User | None = viewer
    elif event.host_id is None:  # a deleted host's archived event (FR-ACC-3)
        host = None
    else:
        host = await session.get(User, event.host_id)
    cover_url, cover_thumb_url = cover_urls(event)
    fields: dict[str, Any] = {
        "id": event.id,
        "name": event.name,
        "description": event.description,
        "budget_crc": event.budget_crc,
        "exchange_at": event.exchange_at,
        "join_deadline": event.join_deadline,
        "location": event.location,
        "is_online": event.is_online,
        "group_chat_enabled": event.group_chat_enabled,
        "state": event.state,
        "drawn_at": event.drawn_at,
        "archived_at": event.archived_at,
        "host": UserPublic(id=host.id, name=host.name, avatar_url=host.avatar_url)
        if host
        else None,
        "participant_count": await count_participants(session, event.id),
        "cover_url": cover_url,
        "cover_thumb_url": cover_thumb_url,
        "my_role": "host" if is_host else "participant",
        "my_assignment": await my_assignment(session, event, viewer.id),
    }
    if is_host:
        return HostEventDetail(
            **fields,
            invite_token=event.invite_token,
            draw_readiness=await draw_readiness(session, event, fields["participant_count"]),
        )
    return EventDetail(**fields)


async def draw_readiness(
    session: AsyncSession, event: Event, participant_count: int
) -> DrawReadiness:
    """Host only. ``can_draw``: OPEN, at least 3 people and a valid draw exists."""
    feasible = await check_feasible(session, event.id)
    return DrawReadiness(
        participant_count=participant_count,
        feasible=feasible,
        can_draw=event.state == EventState.OPEN
        and participant_count >= MIN_PARTICIPANTS
        and feasible,
    )


async def list_participants(
    session: AsyncSession, event: Event, viewer_id: uuid.UUID
) -> list[ParticipantPublic]:
    """The roster: host first, then in joining order. Never emails."""
    rows = (
        await session.execute(
            select(User.id, User.name, User.avatar_url, EventParticipant.joined_at)
            .join(EventParticipant, EventParticipant.user_id == User.id)
            .where(EventParticipant.event_id == event.id)
            .order_by(
                (User.id != event.host_id).asc(),
                EventParticipant.joined_at.asc(),
                EventParticipant.id.asc(),
            )
        )
    ).all()
    return [
        ParticipantPublic(
            user_id=user_id,
            name=name,
            avatar_url=avatar_url,
            is_host=user_id == event.host_id,
            is_self=user_id == viewer_id,
            joined_at=joined_at,
        )
        for user_id, name, avatar_url, joined_at in rows
    ]


# ── Dashboard (cursor pagination) ────────────────────────────────────────────


def _encode_cursor(event: Event) -> str:
    raw = json.dumps([event.exchange_at.isoformat(), str(event.id)]).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        at, event_id = json.loads(base64.urlsafe_b64decode(padded))
        parsed = datetime.fromisoformat(at)
        if parsed.tzinfo is None:
            raise ValueError("naive cursor timestamp")
        return parsed, uuid.UUID(event_id)
    except (ValueError, TypeError, binascii.Error, json.JSONDecodeError) as exc:
        raise AppError(
            "VALIDATION_ERROR", 422, fields=[{"loc": ["query", "cursor"], "type": "value_error"}]
        ) from exc


def _section_query(user_id: uuid.UUID, section: Section) -> Select[Any]:
    is_member = (
        select(EventParticipant.id)
        .where(EventParticipant.event_id == Event.id, EventParticipant.user_id == user_id)
        .exists()
    )
    stmt = select(Event, _participant_count().label("participant_count"))
    if section == "hosting":
        return stmt.where(Event.host_id == user_id, Event.state != EventState.ARCHIVED)
    if section == "participating":
        return stmt.where(is_member, Event.host_id != user_id, Event.state != EventState.ARCHIVED)
    return stmt.where(is_member, Event.state == EventState.ARCHIVED)


def _summary(event: Event, participant_count: int, user_id: uuid.UUID) -> EventSummary:
    cover_url, cover_thumb_url = cover_urls(event)
    return EventSummary(
        id=event.id,
        name=event.name,
        state=cast(EventStateName, event.state),  # the column's CHECK guarantees it
        participant_count=participant_count,
        exchange_at=event.exchange_at,
        budget_crc=event.budget_crc,
        is_host=event.host_id == user_id,
        cover_url=cover_url,
        cover_thumb_url=cover_thumb_url,
    )


async def list_events(
    session: AsyncSession, user_id: uuid.UUID, section: Section, cursor: str | None
) -> EventPage:
    """Upcoming first for hosting/participating; most recent first for past."""
    stmt = _section_query(user_id, section)
    key = tuple_(Event.exchange_at, Event.id)
    newest_first = section == "past"
    if cursor:
        at, last_id = _decode_cursor(cursor)
        after = tuple_(literal(at, DateTime(timezone=True)), literal(last_id, Uuid()))
        stmt = stmt.where(key < after if newest_first else key > after)
    if newest_first:
        order = (Event.exchange_at.desc(), Event.id.desc())
    else:
        order = (Event.exchange_at.asc(), Event.id.asc())
    rows = (await session.execute(stmt.order_by(*order).limit(PAGE_SIZE + 1))).all()

    items = [_summary(event, count, user_id) for event, count in rows[:PAGE_SIZE]]
    next_cursor = _encode_cursor(rows[PAGE_SIZE - 1][0]) if len(rows) > PAGE_SIZE else None
    return EventPage(items=items, next_cursor=next_cursor)


# ── Writes ───────────────────────────────────────────────────────────────────


async def create_event(session: AsyncSession, host: User, data: EventCreate) -> Event:
    """FR-EVT-2: the creator becomes host and participant."""
    event = Event(
        host_id=host.id,
        invite_token=new_invite_token(),
        state=EventState.OPEN,
        **data.model_dump(),
    )
    session.add(event)
    await session.flush()
    session.add(EventParticipant(event_id=event.id, user_id=host.id))
    if event.group_chat_enabled:
        await session.flush()
        await chat_service.create_group(session, event)  # FR-CHT-1
    await session.commit()
    return event


async def update_event(session: AsyncSession, event: Event, changes: EventUpdate) -> Event:
    """Apply a host's edit. The caller holds the row lock and has excluded ARCHIVED.

    Fields sent with their current value are no-ops, so a form can resend them after the
    draw; only real changes to locked fields return 409 ``EVENT_FIELD_LOCKED``.
    """
    requested = changes.model_dump(exclude_unset=True)
    changed = {f: v for f, v in requested.items() if getattr(event, f) != v}

    if event.state == EventState.DRAWN and not changed.keys() <= DRAWN_EDITABLE:
        raise AppError("EVENT_FIELD_LOCKED", 409)

    exchange_at = changed.get("exchange_at", event.exchange_at)
    join_deadline = changed.get("join_deadline", event.join_deadline)
    is_online = changed.get("is_online", event.is_online)
    location = changed.get("location", event.location)
    if "exchange_at" in changed and exchange_at <= datetime.now(UTC):
        raise _field_error("exchange_at")
    if join_deadline is not None and join_deadline >= exchange_at:
        raise _field_error("join_deadline" if "join_deadline" in changed else "exchange_at")
    if is_online and location:
        raise _field_error("location" if "location" in changed else "is_online")

    for field, value in changed.items():
        setattr(event, field, value)
    if "group_chat_enabled" in changed:  # only reachable while OPEN (field lock above)
        await chat_service.sync_group_flag(session, event)
    await session.commit()
    return event


async def archive_event(session: AsyncSession, event: Event, now: datetime) -> Event:
    """PRD §3: the host archives a DRAWN event once the exchange has passed. The caller
    holds the row lock and has checked host and state; from here on the event is read-only.
    """
    if event.exchange_at > now:
        raise AppError("ARCHIVE_TOO_EARLY", 409)
    event.state = EventState.ARCHIVED
    event.archived_at = now
    await session.commit()
    return event


async def delete_event(session: AsyncSession, event: Event) -> None:
    """OPEN only (checked by the route). Rows cascade in the database; storage objects
    (cover, wishlist photos) are removed by the worker once the delete has committed."""
    enqueue_after_commit(session, "delete_prefix", event_prefix(event.id))
    await session.execute(delete(Event).where(Event.id == event.id))
    await session.commit()


async def remove_participant(session: AsyncSession, event: Event, user_id: uuid.UUID) -> None:
    """Take ``user_id`` off an OPEN event's roster (host remove or self leave).

    The caller holds the event row lock and has checked the state; this is the one place
    that knows everything a participant owns inside an event.
    """
    if user_id == event.host_id:
        raise AppError("HOST_CANNOT_LEAVE", 409)
    await detach_participant(session, event.id, user_id)
    await session.commit()


async def detach_participant(
    session: AsyncSession, event_id: uuid.UUID, user_id: uuid.UUID
) -> None:
    """Everything a participant owns inside an OPEN event, without committing: the roster
    row, their exclusions, their wishlist (photos: R2 cleanup after the commit) and their
    group-chat membership (their messages stay). Also the account-deletion path."""
    result = await session.execute(
        delete(EventParticipant).where(
            EventParticipant.event_id == event_id, EventParticipant.user_id == user_id
        )
    )
    if getattr(result, "rowcount", 0) == 0:
        raise AppError("PARTICIPANT_NOT_FOUND", 404)
    await delete_user_exclusions(session, event_id, user_id)  # FR-EXC-3, same transaction
    await delete_user_items(session, event_id, user_id)
    await chat_service.detach_group_member(session, event_id, user_id)
