"""Shared FastAPI dependencies.

Authorization dependencies (``current_user``, ``require_participant``,
``require_host``, ...) live here. Routes must use them instead of inline checks
(CLAUDE.md §2.7).
"""

import uuid
from collections.abc import AsyncIterator, Awaitable, Callable, Iterable
from dataclasses import dataclass

from fastapi import Depends, Request
from redis.asyncio import Redis
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.api.cookies import ACCESS_COOKIE
from app.core.config import Settings
from app.core.errors import AppError
from app.core.security import decode_access_token
from app.models.chat import Conversation, ConversationMember, Message
from app.models.event import Event, EventParticipant, EventState
from app.models.user import User
from app.models.wishlist import WishlistItem
from app.services.events import get_event_for_participant
from app.services.google_oauth import GoogleOAuthClient
from app.worker.queue import flush_committed_jobs


def get_engine(request: Request) -> AsyncEngine:
    engine: AsyncEngine = request.app.state.engine
    return engine


async def get_db(request: Request) -> AsyncIterator[AsyncSession]:
    sessionmaker: async_sessionmaker[AsyncSession] = request.app.state.sessionmaker
    async with sessionmaker() as session:
        try:
            yield session
        finally:
            # Jobs parked with enqueue_after_commit, only if their transaction committed.
            await flush_committed_jobs(session, getattr(request.app.state, "arq", None))


def get_redis(request: Request) -> "Redis":
    redis: Redis = request.app.state.redis
    return redis


def get_app_settings(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


def get_google_oauth_client(settings: Settings = Depends(get_app_settings)) -> GoogleOAuthClient:
    """Overridden in tests with a fake that never talks to Google."""
    return GoogleOAuthClient(settings)


async def current_user(
    request: Request,
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
) -> User:
    """The signed-in user from the ``access_token`` cookie, else 401 ``AUTH_REQUIRED``."""
    token = request.cookies.get(ACCESS_COOKIE)
    user_id = decode_access_token(token, settings) if token else None
    user = await session.get(User, user_id) if user_id else None
    if user is None:
        raise AppError("AUTH_REQUIRED", 401)
    return user


@dataclass(frozen=True, slots=True)
class EventAccess:
    """An event the current user participates in, and whether they host it."""

    event: Event
    user: User

    @property
    def is_host(self) -> bool:
        return self.event.host_id == self.user.id


async def require_participant(
    event_id: uuid.UUID,
    request: Request,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_db),
) -> EventAccess:
    """The event, if the user participates in it. Otherwise 404 ``EVENT_NOT_FOUND``, the same
    as a missing event, so outsiders can't probe which events exist.

    Mutating requests lock the event row (``FOR UPDATE``) until the service commits, so an
    edit or delete can't interleave with the draw (CLAUDE.md §2.4).
    """
    event = await get_event_for_participant(
        session, event_id, user.id, for_update=request.method not in ("GET", "HEAD")
    )
    if event is None:
        raise AppError("EVENT_NOT_FOUND", 404)
    return EventAccess(event=event, user=user)


async def require_host(access: EventAccess = Depends(require_participant)) -> EventAccess:
    """Participant check first (404), then 403 ``HOST_ONLY``."""
    if not access.is_host:
        raise AppError("HOST_ONLY", 403)
    return access


@dataclass(frozen=True, slots=True)
class WishlistItemAccess:
    """One of the current user's own items in an event they still participate in."""

    event: Event
    user: User
    item: WishlistItem


async def require_wishlist_owner(
    item_id: uuid.UUID,
    access: EventAccess = Depends(require_participant),
    session: AsyncSession = Depends(get_db),
) -> WishlistItemAccess:
    """The item, if it is the caller's own in this event. Anyone else's item, or one in
    another event, is 404 ``WISHLIST_ITEM_NOT_FOUND`` (no probing whose items exist)."""
    item = await session.scalar(
        select(WishlistItem).where(
            WishlistItem.id == item_id,
            WishlistItem.event_id == access.event.id,
            WishlistItem.user_id == access.user.id,
        )
    )
    if item is None:
        raise AppError("WISHLIST_ITEM_NOT_FOUND", 404)
    return WishlistItemAccess(event=access.event, user=access.user, item=item)


def require_own_item(*states: EventState) -> Callable[..., Awaitable[WishlistItemAccess]]:
    """For routes addressed by item id alone (``/wishlist/items/{item_id}/photos``): the
    caller's own item in an event they still participate in, else 404
    ``WISHLIST_ITEM_NOT_FOUND``; then 409 unless the event is in one of ``states``.

    Nothing is locked here: photo uploads process the image first, and the service locks
    the rows only for the short write that follows."""
    allowed = frozenset(states)

    async def dependency(
        item_id: uuid.UUID,
        user: User = Depends(current_user),
        session: AsyncSession = Depends(get_db),
    ) -> WishlistItemAccess:
        row = (
            await session.execute(
                select(WishlistItem, Event)
                .join(Event, Event.id == WishlistItem.event_id)
                .join(
                    EventParticipant,
                    and_(
                        EventParticipant.event_id == Event.id,
                        EventParticipant.user_id == user.id,
                    ),
                )
                .where(WishlistItem.id == item_id, WishlistItem.user_id == user.id)
            )
        ).one_or_none()
        if row is None:
            raise AppError("WISHLIST_ITEM_NOT_FOUND", 404)
        item, event = row
        if event.state not in allowed:
            raise AppError(_STATE_ERRORS[event.state], 409)
        return WishlistItemAccess(event=event, user=user, item=item)

    return dependency


async def require_source_event(
    other_event_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_db),
) -> Event:
    """A second event the caller participates in (any state), e.g. the source of a
    wishlist copy. Otherwise 404 ``EVENT_NOT_FOUND``, like ``require_participant``."""
    event = await get_event_for_participant(session, other_event_id, user.id)
    if event is None:
        raise AppError("EVENT_NOT_FOUND", 404)
    return event


_STATE_ERRORS: dict[str, str] = {
    EventState.OPEN: "EVENT_NOT_DRAWN",
    EventState.DRAWN: "EVENT_ALREADY_DRAWN",
    EventState.ARCHIVED: "EVENT_ARCHIVED",
}


def require_event_state(
    *states: EventState, roster: bool = False
) -> Callable[..., Awaitable[EventAccess]]:
    """409 with the code for the event's actual state when it isn't one of ``states``.

    ``roster=True`` is for join/leave/remove/exclusion edits: once the event is drawn *or*
    archived the roster is frozen, and every such refusal is ``EVENT_ALREADY_DRAWN``
    (CLAUDE.md §2.3).
    """
    allowed = frozenset(states)

    async def dependency(access: EventAccess = Depends(require_participant)) -> EventAccess:
        state = access.event.state
        if state not in allowed:
            frozen = roster and state != EventState.OPEN
            raise AppError("EVENT_ALREADY_DRAWN" if frozen else _STATE_ERRORS[state], 409)
        return access

    return dependency


# ── Chat ─────────────────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class MemberAccess:
    """The current user's own member row in a conversation of an event they still
    participate in. ``member`` may be an anonymous row: never serialize it directly."""

    conversation: Conversation
    member: ConversationMember
    event: Event
    user: User


async def require_member(
    conversation_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_db),
) -> MemberAccess:
    """404 ``CONVERSATION_NOT_FOUND`` unless the user is a member AND still a participant
    of the event (someone who left can't keep reading their threads)."""
    row = (
        await session.execute(
            select(Conversation, ConversationMember, Event)
            .join(ConversationMember, ConversationMember.conversation_id == Conversation.id)
            .join(Event, Event.id == Conversation.event_id)
            .join(
                EventParticipant,
                and_(EventParticipant.event_id == Event.id, EventParticipant.user_id == user.id),
            )
            .where(Conversation.id == conversation_id, ConversationMember.user_id == user.id)
        )
    ).one_or_none()
    if row is None:
        raise AppError("CONVERSATION_NOT_FOUND", 404)
    conversation, member, event = row
    return MemberAccess(conversation=conversation, member=member, event=event, user=user)


async def require_writable_member(
    access: MemberAccess = Depends(require_member),
) -> MemberAccess:
    """Archived events are read-only: history can be read, nothing else (CLAUDE.md §2.6)."""
    if access.event.state == EventState.ARCHIVED:
        raise AppError("CONVERSATION_READ_ONLY", 409)
    return access


@dataclass(frozen=True, slots=True)
class OwnMessage:
    message: Message
    access: MemberAccess


async def require_message_sender(
    message_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_db),
) -> OwnMessage:
    """A message the current user sent, in a conversation they may still use. Anyone
    else's message is 404 ``MESSAGE_NOT_FOUND``, the same as a missing one."""
    row = (
        await session.execute(
            select(Message, Conversation, ConversationMember, Event)
            .join(ConversationMember, ConversationMember.id == Message.sender_member_id)
            .join(Conversation, Conversation.id == Message.conversation_id)
            .join(Event, Event.id == Conversation.event_id)
            .join(
                EventParticipant,
                and_(EventParticipant.event_id == Event.id, EventParticipant.user_id == user.id),
            )
            .where(Message.id == message_id, ConversationMember.user_id == user.id)
        )
    ).one_or_none()
    if row is None:
        raise AppError("MESSAGE_NOT_FOUND", 404)
    message, conversation, member, event = row
    if event.state == EventState.ARCHIVED:
        raise AppError("CONVERSATION_READ_ONLY", 409)
    access = MemberAccess(conversation=conversation, member=member, event=event, user=user)
    return OwnMessage(message=message, access=access)


async def followable_conversations(
    session: AsyncSession, user_id: uuid.UUID, conversation_ids: Iterable[uuid.UUID]
) -> set[uuid.UUID]:
    """The subset of ``conversation_ids`` the user may follow over the WebSocket: the same
    rule as ``require_member`` (a member, and still a participant of the event), in one
    query. Not a FastAPI dependency: the WebSocket ``subscribe`` frame calls it."""
    wanted = set(conversation_ids)
    if not wanted:
        return set()
    rows = await session.scalars(
        select(Conversation.id)
        .join(ConversationMember, ConversationMember.conversation_id == Conversation.id)
        .join(
            EventParticipant,
            and_(
                EventParticipant.event_id == Conversation.event_id,
                EventParticipant.user_id == user_id,
            ),
        )
        .where(Conversation.id.in_(wanted), ConversationMember.user_id == user_id)
    )
    return set(rows.all())
