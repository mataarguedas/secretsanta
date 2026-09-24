"""Redis pub/sub → local sockets. One subscriber task per API process.

It pattern-subscribes to ``conv:*`` and ``user:*`` once and hands every frame to the
process's ``ConnectionManager``, which drops those with no local socket. Every process
therefore sees all chat traffic; at this app's scale (≤ 5k users, a few processes) that's
cheap, and it avoids re-subscribing a shared connection on every socket change.

The subscriber uses its own Redis connection without a read timeout (it blocks waiting
for frames), and reconnects with backoff if Redis goes away.
"""

import asyncio
import contextlib
from typing import Final

from redis.asyncio import Redis
from redis.asyncio.client import PubSub

from app.core.logging import get_logger
from app.realtime.channels import PATTERNS
from app.realtime.manager import ConnectionManager

log = get_logger(__name__)

MAX_BACKOFF: Final = 30.0


class RedisBridge:
    def __init__(self, redis_url: str, manager: ConnectionManager) -> None:
        self._redis_url = redis_url
        self._manager = manager
        self._redis: Redis | None = None
        self._pubsub: PubSub | None = None
        self._task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        """Returns once the subscription is live, so nothing published afterwards is missed."""
        await self._connect()
        self._task = asyncio.create_task(self._run(), name="realtime-bridge")

    async def _connect(self) -> PubSub:
        self._redis = Redis.from_url(
            self._redis_url, decode_responses=True, socket_connect_timeout=2
        )
        pubsub = self._redis.pubsub(ignore_subscribe_messages=True)
        self._pubsub = pubsub
        await pubsub.psubscribe(*PATTERNS)
        return pubsub

    async def _close_connection(self) -> None:
        if self._pubsub is not None:
            with contextlib.suppress(Exception):
                await self._pubsub.aclose()  # type: ignore[no-untyped-call]
        if self._redis is not None:
            with contextlib.suppress(Exception):
                await self._redis.aclose()
        self._pubsub = None
        self._redis = None

    async def _run(self) -> None:
        backoff = 0.5
        while True:
            try:
                pubsub = self._pubsub
                if pubsub is None:
                    pubsub = await self._connect()
                    log.info("realtime_bridge_reconnected")
                async for message in pubsub.listen():
                    backoff = 0.5
                    if message.get("type") == "pmessage":
                        self._manager.deliver(str(message["channel"]), str(message["data"]))
                await self._close_connection()  # the stream ended: reconnect
            except asyncio.CancelledError:
                raise
            except Exception:
                log.warning("realtime_bridge_disconnected", retry_in=backoff)
                await self._close_connection()
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, MAX_BACKOFF)

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
        await self._close_connection()
