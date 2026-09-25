"""arq tasks. Each takes the arq ``ctx`` first. Keep them idempotent: arq may retry."""

import asyncio
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.logging import get_logger
from app.models.push import PushSubscription
from app.models.user import User
from app.notifications.templates import render
from app.notifications.webpush import send_raw
from app.storage.r2 import get_storage

log = get_logger(__name__)


async def ping(_ctx: dict[str, Any]) -> str:
    """No-op task used to check that the worker is wired up."""
    return "pong"


async def delete_objects(_ctx: dict[str, Any], keys: list[str]) -> int:
    """Delete storage objects whose rows are gone (enqueued after commit only)."""
    count = await asyncio.to_thread(get_storage().delete_many, keys)
    log.info("delete_objects", count=count)
    return count


async def delete_prefix(_ctx: dict[str, Any], prefix: str) -> int:
    """Delete everything under a folder, e.g. ``events/{id}/`` when an event is deleted."""
    count = await asyncio.to_thread(get_storage().delete_prefix, prefix)
    log.info("delete_prefix", count=count)
    return count


async def send_test_notification(ctx: dict[str, Any], user_id: str) -> int:
    """Dev-only ``POST /push/test``: a localized "Test notification" to all of the user's
    devices, opening /profile when tapped. Returns how many were delivered."""
    sessionmaker: async_sessionmaker[AsyncSession] = ctx["sessionmaker"]
    async with sessionmaker() as session:
        user = await session.get(User, uuid.UUID(user_id))
        if user is None:
            return 0
        text = render("test", user.locale)
        payload = {"title": text.title, "body": text.body, "tag": "test", "url": "/profile"}
        subscriptions = await session.scalars(
            select(PushSubscription).where(PushSubscription.user_id == user.id)
        )
        sent = 0
        for subscription in list(subscriptions):
            sent += await send_raw(session, subscription, payload)
        await session.commit()
    log.info("test_notification", delivered=sent)
    return sent
