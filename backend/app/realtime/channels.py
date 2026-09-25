"""Redis pub/sub channels (CLAUDE.md §7 Chat and realtime). Services publish here; each API
process's bridge delivers to its local sockets.

- ``conv:{conversation_id}``: frames for everyone subscribed to a conversation.
- ``user:{user_id}``: frames for every tab of one user.

A payload is the finished JSON frame, identical for every receiver: it is built from the
public serializers only, so nothing per-viewer or secret is ever put on Redis.
"""

import json
import uuid
from collections.abc import Iterable
from typing import Any, Final

from redis.asyncio import Redis

from app.core.logging import get_logger

log = get_logger(__name__)

CONV_PREFIX: Final = "conv:"
USER_PREFIX: Final = "user:"
PATTERNS: Final = (f"{CONV_PREFIX}*", f"{USER_PREFIX}*")


def conversation_channel(conversation_id: uuid.UUID) -> str:
    return f"{CONV_PREFIX}{conversation_id}"


def user_channel(user_id: uuid.UUID) -> str:
    return f"{USER_PREFIX}{user_id}"


def active_key(user_id: uuid.UUID) -> str:
    """``active:{user_id}`` → the conversation open on screen, to suppress its pushes.
    Not a pub/sub channel: a plain key with a TTL, written by ``/ws`` and read by the worker."""
    return f"active:{user_id}"


def encode(frame: dict[str, Any]) -> str:
    return json.dumps(frame, separators=(",", ":"))


async def publish(redis: "Redis", channel: str, frame: dict[str, Any]) -> None:
    """Best effort: the change is already committed, and a client that misses a frame
    catches up over REST. A failure is logged (by channel kind only), never raised."""
    try:
        await redis.publish(channel, encode(frame))
    except Exception:
        log.warning("realtime_publish_failed", channel_kind=channel.split(":", 1)[0])


async def publish_to_conversation(
    redis: "Redis", conversation_id: uuid.UUID, frame: dict[str, Any]
) -> None:
    await publish(redis, conversation_channel(conversation_id), frame)


async def publish_to_users(
    redis: "Redis", user_ids: Iterable[uuid.UUID], frame: dict[str, Any]
) -> None:
    for user_id in user_ids:
        await publish(redis, user_channel(user_id), frame)
