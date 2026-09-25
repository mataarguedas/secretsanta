"""arq tasks. Each takes the arq ``ctx`` first. Keep them idempotent: arq may retry."""

import asyncio
import uuid
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import get_settings
from app.core.logging import get_logger
from app.db.mixins import utcnow
from app.notifications import pushes
from app.notifications.sender import notify
from app.services import backup, scheduled
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
    async with _sessionmaker(ctx)() as session:
        result = await notify(
            session, [uuid.UUID(user_id)], "test", {"url": "/profile", "tag": "test"}
        )
    return result.sent


async def send_reveal(ctx: dict[str, Any], event_id: str) -> int:
    """FR-NTF-2 ``reveal``: every participant; the payload names the event, never a pair."""
    async with _sessionmaker(ctx)() as session:
        return (await pushes.send_reveal(session, uuid.UUID(event_id))).sent


async def send_message_push(ctx: dict[str, Any], message_id: str) -> int:
    """FR-NTF-2 ``message``: the other members, except whoever has the thread open."""
    async with _sessionmaker(ctx)() as session:
        result = await pushes.send_message_push(session, ctx["app_redis"], uuid.UUID(message_id))
    return result.sent


async def send_wishlist_updated(ctx: dict[str, Any], event_id: str, owner_id: str) -> int:
    """FR-WSH-7: only the owner's giver, found here in the worker; names nobody."""
    async with _sessionmaker(ctx)() as session:
        result = await pushes.send_wishlist_updated(
            session, uuid.UUID(event_id), uuid.UUID(owner_id)
        )
    return result.sent


async def send_exchange_reminders(ctx: dict[str, Any]) -> int:
    """Cron, every 15 min: the T-7d / T-1d reminders due now (idempotent)."""
    async with _sessionmaker(ctx)() as session:
        run = await scheduled.send_exchange_reminders(session, utcnow(), tz=_timezone())
    return run.claimed


async def prune_refresh_tokens(ctx: dict[str, Any]) -> int:
    """Cron, daily: refresh tokens expired or revoked over a week ago."""
    async with _sessionmaker(ctx)() as session:
        return await scheduled.prune_refresh_tokens(session, utcnow())


async def auto_archive_events(ctx: dict[str, Any]) -> int:
    """Cron, daily 03:00 CR: DRAWN events more than 7 days past the exchange."""
    async with _sessionmaker(ctx)() as session:
        return await scheduled.auto_archive_events(session, utcnow())


async def backup_database(ctx: dict[str, Any]) -> str:
    """Cron, daily 02:00 CR: ``pg_dump | gzip`` → R2 ``backups/``, keeping 14 days."""
    result = await asyncio.to_thread(backup.run_backup, get_settings(), get_storage(), utcnow())
    log.info("backup_database", key=result.key, size=result.size, pruned=len(result.deleted))
    return result.key


def _timezone() -> ZoneInfo:
    return ZoneInfo(get_settings().default_timezone)


def _sessionmaker(ctx: dict[str, Any]) -> async_sessionmaker[AsyncSession]:
    sessionmaker: async_sessionmaker[AsyncSession] = ctx["sessionmaker"]
    return sessionmaker
