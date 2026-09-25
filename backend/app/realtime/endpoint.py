"""``/ws``: one socket per tab (PRD §8, CLAUDE.md §7 Chat and realtime).

Handshake:
- ``Origin`` must be the app's own origin (``APP_BASE_URL``), else the handshake is
  refused (HTTP 403): a cross-site page can't ride the user's cookie.
- The ``access_token`` cookie must name an existing user, else the socket is accepted and
  closed at once with code 4401, so the client can tell "sign in again" apart.

Frames are validated with Pydantic; a bad frame gets an ``error`` frame and the socket
stays open. Authorization goes through ``app/api/deps.py`` like every REST route, and
sending goes through the same service (and rate limit) as ``POST …/messages``.
"""

import asyncio
import contextlib
import json
from typing import Any, Final
from urllib.parse import urlsplit

from arq.connections import ArqRedis
from fastapi import APIRouter, WebSocket
from pydantic import ValidationError
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from starlette.websockets import WebSocketDisconnect

from app.api.cookies import ACCESS_COOKIE
from app.api.deps import followable_conversations, require_member, require_writable_member
from app.core.config import Settings
from app.core.errors import AppError
from app.core.logging import get_logger
from app.core.security import decode_access_token
from app.models.user import User
from app.realtime.channels import active_key
from app.realtime.frames import (
    MAX_FRAME_CHARS,
    PONG,
    ActiveFrame,
    PingFrame,
    SendFrame,
    SubscribeFrame,
    ack_frame,
    client_frame,
    error_frame,
)
from app.realtime.manager import Connection, ConnectionManager
from app.schemas.chat import MessageCreate
from app.services import chat as chat_service
from app.worker.queue import flush_committed_jobs

log = get_logger(__name__)

router = APIRouter()

UNAUTHENTICATED: Final = 4401
FORBIDDEN_ORIGIN: Final = 4403
ACTIVE_TTL_SECONDS: Final = 60


def _origin(url: str) -> str:
    parts = urlsplit(url.strip())
    return f"{parts.scheme}://{parts.netloc}".lower()


def origin_allowed(origin: str | None, settings: Settings) -> bool:
    return origin is not None and _origin(origin) == _origin(settings.app_base_url)


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    state = websocket.app.state
    settings: Settings = state.settings
    if not origin_allowed(websocket.headers.get("origin"), settings):
        await websocket.close(code=FORBIDDEN_ORIGIN)  # before accept: an HTTP 403
        return

    sessionmaker: async_sessionmaker[AsyncSession] = state.sessionmaker
    token = websocket.cookies.get(ACCESS_COOKIE)
    user_id = decode_access_token(token, settings) if token else None
    user: User | None = None
    if user_id is not None:
        async with sessionmaker() as session:
            user = await session.get(User, user_id)
    await websocket.accept()
    if user is None:
        await websocket.close(code=UNAUTHENTICATED)
        return

    manager: ConnectionManager = state.ws_manager
    connection = Connection(websocket, user.id)
    manager.add(connection)
    writer = asyncio.create_task(connection.run_writer())
    handler = FrameHandler(
        connection, manager, sessionmaker, state.redis, getattr(state, "arq", None)
    )
    try:
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break
            await handler.handle(message.get("text"))
    except WebSocketDisconnect:
        pass
    finally:
        manager.remove(connection)
        writer.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await writer
        await handler.clear_active()


class FrameHandler:
    def __init__(
        self,
        connection: Connection,
        manager: ConnectionManager,
        sessionmaker: async_sessionmaker[AsyncSession],
        redis: "Redis",
        jobs: "ArqRedis | None" = None,
    ) -> None:
        self.connection = connection
        self.manager = manager
        self.sessionmaker = sessionmaker
        self.redis = redis
        self.jobs = jobs  # arq, for the push task each message queues

    async def handle(self, text: str | None) -> None:
        """One frame. Nothing raised here closes the socket."""
        if text is None or len(text) > MAX_FRAME_CHARS:
            self.connection.send(error_frame("INVALID_FRAME"))
            return
        try:
            frame = client_frame.validate_json(text)
        except ValidationError:
            self.connection.send(error_frame("INVALID_FRAME", _client_id_of(text)))
            return
        client_id = frame.client_id if isinstance(frame, SendFrame) else None
        try:
            if isinstance(frame, SubscribeFrame):
                await self._subscribe(frame)
            elif isinstance(frame, ActiveFrame):
                await self._active(frame)
            elif isinstance(frame, SendFrame):
                await self._send(frame)
            elif isinstance(frame, PingFrame):
                await self._ping()
        except AppError as exc:
            self.connection.send(error_frame(exc.code, client_id))
        except ValidationError:
            self.connection.send(error_frame("VALIDATION_ERROR", client_id))
        except Exception:
            log.exception("ws_frame_failed", frame_type=frame.type)
            self.connection.send(error_frame("INTERNAL_ERROR", client_id))

    async def _user(self, session: AsyncSession) -> User:
        user = await session.get(User, self.connection.user_id)
        if user is None:  # the account was deleted while connected
            raise AppError("AUTH_REQUIRED", 401)
        return user

    async def _subscribe(self, frame: SubscribeFrame) -> None:
        """Ids the user can't follow are dropped silently."""
        async with self.sessionmaker() as session:
            allowed = await followable_conversations(
                session, self.connection.user_id, frame.conversation_ids
            )
        self.manager.subscribe(self.connection, allowed)

    async def _active(self, frame: ActiveFrame) -> None:
        key = active_key(self.connection.user_id)
        if frame.conversation_id is None:
            await self.clear_active()
            return
        async with self.sessionmaker() as session:
            await require_member(frame.conversation_id, await self._user(session), session)
        await self.redis.set(key, str(frame.conversation_id), ex=ACTIVE_TTL_SECONDS)
        self.connection.active = frame.conversation_id

    async def clear_active(self) -> None:
        """Only if this tab set it: another tab may have a conversation open since."""
        active = self.connection.active
        if active is None:
            return
        self.connection.active = None
        key = active_key(self.connection.user_id)
        with contextlib.suppress(Exception):
            if await self.redis.get(key) == str(active):
                await self.redis.delete(key)

    async def _send(self, frame: SendFrame) -> None:
        """Same rules as REST: member, not archived, 1 to 2000 chars, 30/min. Persist →
        publish → ack."""
        data = MessageCreate(body=frame.body, client_id=frame.client_id)
        async with self.sessionmaker() as session:
            user = await self._user(session)
            access = await require_writable_member(
                await require_member(frame.conversation_id, user, session)
            )
            try:
                message = await chat_service.send_message(session, self.redis, access.member, data)
            finally:
                # What REST's get_db does: send the jobs whose transaction committed.
                await flush_committed_jobs(session, self.jobs)
        self.connection.send(ack_frame(frame.client_id, message.id))

    async def _ping(self) -> None:
        if self.connection.active is not None:
            with contextlib.suppress(Exception):
                await self.redis.expire(active_key(self.connection.user_id), ACTIVE_TTL_SECONDS)
        self.connection.send(PONG)


def _client_id_of(text: str) -> str | None:
    """Echo a client_id back on a malformed frame when one can be found."""
    try:
        raw: Any = json.loads(text)
    except ValueError:
        return None
    value = raw.get("client_id") if isinstance(raw, dict) else None
    return value if isinstance(value, str) and 0 < len(value) <= 64 else None
