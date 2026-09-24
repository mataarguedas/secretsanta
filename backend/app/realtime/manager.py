"""Per-process WebSocket bookkeeping (CLAUDE.md §7): which sockets belong to which user and
which conversations each socket follows. Never assume one process: frames arrive through
the Redis bridge, which calls ``deliver`` in every process.

Each connection has its own bounded outbound queue and writer task, so a slow client can
never hold up delivery to the others; one that falls too far behind is disconnected (it
reconnects and catches up over REST).
"""

import asyncio
import uuid
from collections import defaultdict
from collections.abc import Iterable
from typing import Any, Final

from starlette.websockets import WebSocket

from app.realtime.channels import CONV_PREFIX, USER_PREFIX, encode

QUEUE_SIZE: Final = 256
SLOW_CONSUMER_CODE: Final = 4408


class Connection:
    """One socket (one tab) of a signed-in user."""

    def __init__(self, websocket: WebSocket, user_id: uuid.UUID) -> None:
        self.websocket = websocket
        self.user_id = user_id
        self.conversations: set[uuid.UUID] = set()
        self.active: uuid.UUID | None = None
        self._queue: asyncio.Queue[str | None] = asyncio.Queue(maxsize=QUEUE_SIZE)
        self.overflowed = False

    def enqueue(self, text: str) -> None:
        if self.overflowed:
            return
        try:
            self._queue.put_nowait(text)
        except asyncio.QueueFull:
            self.overflowed = True
            self._queue = asyncio.Queue(maxsize=1)
            self._queue.put_nowait(None)  # tells the writer to close the socket

    def send(self, frame: dict[str, Any]) -> None:
        self.enqueue(encode(frame))

    async def run_writer(self) -> None:
        """Drain the queue in order: acks, errors and broadcast frames share it."""
        while True:
            text = await self._queue.get()
            if text is None:
                await self.websocket.close(code=SLOW_CONSUMER_CODE)
                return
            await self.websocket.send_text(text)


class ConnectionManager:
    def __init__(self) -> None:
        self._by_user: dict[uuid.UUID, set[Connection]] = defaultdict(set)
        self._by_conversation: dict[uuid.UUID, set[Connection]] = defaultdict(set)

    def add(self, connection: Connection) -> None:
        self._by_user[connection.user_id].add(connection)

    def remove(self, connection: Connection) -> None:
        self._discard(self._by_user, connection.user_id, connection)
        for conversation_id in connection.conversations:
            self._discard(self._by_conversation, conversation_id, connection)
        connection.conversations.clear()

    def subscribe(self, connection: Connection, conversation_ids: Iterable[uuid.UUID]) -> None:
        """Additive. The caller has already dropped ids the user may not follow."""
        for conversation_id in conversation_ids:
            connection.conversations.add(conversation_id)
            self._by_conversation[conversation_id].add(connection)

    @property
    def count(self) -> int:
        return sum(len(conns) for conns in self._by_user.values())

    def deliver(self, channel: str, payload: str) -> int:
        """Called by the bridge for every published frame; returns how many local sockets
        got it. Unknown channels and malformed ids are ignored."""
        try:
            if channel.startswith(CONV_PREFIX):
                key = uuid.UUID(channel.removeprefix(CONV_PREFIX))
                targets = self._by_conversation.get(key, set())
            elif channel.startswith(USER_PREFIX):
                key = uuid.UUID(channel.removeprefix(USER_PREFIX))
                targets = self._by_user.get(key, set())
            else:
                return 0
        except ValueError:
            return 0
        for connection in list(targets):
            connection.enqueue(payload)
        return len(targets)

    @staticmethod
    def _discard(
        index: dict[uuid.UUID, set[Connection]], key: uuid.UUID, connection: Connection
    ) -> None:
        conns = index.get(key)
        if conns is not None:
            conns.discard(connection)
            if not conns:
                del index[key]
