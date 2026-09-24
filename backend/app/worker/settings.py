"""arq worker entry point: ``uv run arq app.worker.settings.WorkerSettings``."""

import logging
from typing import Any, ClassVar

from arq.connections import RedisSettings

from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.core.sentry import init_sentry
from app.worker.tasks import delete_objects, delete_prefix, ping

_settings = get_settings()
configure_logging(_settings.log_level)
init_sentry(_settings, component="worker")

log = get_logger(__name__)


async def startup(_ctx: dict[str, Any]) -> None:
    # The arq CLI applies its own dictConfig *after* importing this module, adding a
    # plain-text handler to the "arq" logger. Drop it so job logs are JSON only.
    logging.getLogger("arq").handlers.clear()
    log.info("worker_startup", env=_settings.env)


async def shutdown(_ctx: dict[str, Any]) -> None:
    log.info("worker_shutdown")


class WorkerSettings:
    functions: ClassVar[list[Any]] = [ping, delete_objects, delete_prefix]
    redis_settings = RedisSettings.from_dsn(_settings.redis_url)
    on_startup = startup
    on_shutdown = shutdown
    # TODO(prompt 24+): cron_jobs (reminders, auto-archive, token pruning, backups).
