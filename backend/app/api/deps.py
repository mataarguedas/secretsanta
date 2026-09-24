"""Shared FastAPI dependencies.

Authorization dependencies (``current_user``, ``require_participant``,
``require_host``, ...) live here. Routes must use them instead of inline checks
(CLAUDE.md §2.7).
"""

import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass

from fastapi import Depends, Request
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.api.cookies import ACCESS_COOKIE
from app.core.config import Settings
from app.core.errors import AppError
from app.core.security import decode_access_token
from app.models.event import Event, EventState
from app.models.user import User
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
