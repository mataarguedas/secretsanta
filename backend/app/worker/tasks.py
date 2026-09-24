"""arq tasks. Each takes the arq ``ctx`` first. Keep them idempotent: arq may retry."""

import asyncio
from typing import Any

from app.core.logging import get_logger
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
