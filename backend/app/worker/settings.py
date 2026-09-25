"""arq worker entry point: ``uv run arq app.worker.settings.WorkerSettings``."""

import logging
from typing import Any, ClassVar

from arq.connections import RedisSettings

from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.core.redis import create_redis
from app.core.sentry import init_sentry
from app.db.engine import create_engine
from app.db.session import create_sessionmaker
from app.worker.tasks import (
    delete_objects,
    delete_prefix,
    ping,
    send_message_push,
    send_reveal,
    send_test_notification,
    send_wishlist_updated,
)

_settings = get_settings()
configure_logging(_settings.log_level)
init_sentry(_settings, component="worker")

log = get_logger(__name__)


async def startup(ctx: dict[str, Any]) -> None:
    # The arq CLI applies its own dictConfig *after* importing this module, adding a
    # plain-text handler to the "arq" logger. Drop it so job logs are JSON only.
    logging.getLogger("arq").handlers.clear()
    ctx["engine"] = create_engine(_settings)
    ctx["sessionmaker"] = create_sessionmaker(ctx["engine"])
    # The app's own client (text replies): arq's ctx["redis"] is its bytes-mode pool.
    ctx["app_redis"] = create_redis(_settings.redis_url)
    log.info("worker_startup", env=_settings.env)


async def shutdown(ctx: dict[str, Any]) -> None:
    if engine := ctx.get("engine"):
        await engine.dispose()
    if redis := ctx.get("app_redis"):
        await redis.aclose()
    log.info("worker_shutdown")


class WorkerSettings:
    functions: ClassVar[list[Any]] = [
        ping,
        delete_objects,
        delete_prefix,
        send_test_notification,
        send_reveal,
        send_message_push,
        send_wishlist_updated,
    ]
    redis_settings = RedisSettings.from_dsn(_settings.redis_url)
    on_startup = startup
    on_shutdown = shutdown
    # TODO(prompt 26): cron_jobs (reminders, auto-archive, token pruning, backups).
