"""Run one scheduled job once, now or at a pretend moment:

    uv run python -m app.scripts.run_job send_exchange_reminders
    uv run python -m app.scripts.run_job send_exchange_reminders --now 2026-12-13T09:05:00-06:00
    uv run python -m app.scripts.run_job prune_refresh_tokens
    uv run python -m app.scripts.run_job auto_archive_events
    uv run python -m app.scripts.run_job backup_database

``--now`` is refused when ``ENV=production``: faking the clock there could send real
reminders at the wrong time. A ``--now`` without an offset is read as Costa Rica time
(``DEFAULT_TIMEZONE``). Pushes go out directly from this process, like the worker would.
"""

import argparse
import asyncio
import sys
from collections.abc import Awaitable, Callable, Sequence
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.logging import configure_logging
from app.db.engine import create_engine
from app.db.mixins import utcnow
from app.db.session import create_sessionmaker
from app.services import backup, scheduled
from app.storage.r2 import get_storage

Job = Callable[[AsyncSession, datetime, Settings], Awaitable[Any]]

JOBS: dict[str, Job] = {
    "send_exchange_reminders": lambda session, now, settings: scheduled.send_exchange_reminders(
        session, now, tz=ZoneInfo(settings.default_timezone)
    ),
    "prune_refresh_tokens": lambda session, now, _settings: scheduled.prune_refresh_tokens(
        session, now
    ),
    "auto_archive_events": lambda session, now, _settings: scheduled.auto_archive_events(
        session, now
    ),
    # Needs pg_dump, so run it where the worker runs:
    #   docker compose run --rm worker python -m app.scripts.run_job backup_database
    "backup_database": lambda _session, now, settings: asyncio.to_thread(
        backup.run_backup, settings, get_storage(), now
    ),
}


def parse_now(value: str, tz: ZoneInfo) -> datetime:
    moment = datetime.fromisoformat(value)
    return moment if moment.tzinfo else moment.replace(tzinfo=tz)


def parse_args(argv: Sequence[str], settings: Settings) -> tuple[str, datetime]:
    parser = argparse.ArgumentParser(prog="run_job", description="Run one scheduled job once.")
    parser.add_argument("job", choices=sorted(JOBS))
    parser.add_argument("--now", help="ISO 8601 moment to pretend it is (not in production)")
    args = parser.parse_args(argv)
    if args.now is None:
        return args.job, utcnow()
    if settings.is_production:
        parser.error("--now is not allowed when ENV=production")
    try:
        return args.job, parse_now(args.now, ZoneInfo(settings.default_timezone))
    except ValueError:
        parser.error(f"--now must be an ISO 8601 date-time, got {args.now!r}")


async def run(job: str, now: datetime, settings: Settings) -> Any:
    engine = create_engine(settings)
    try:
        async with create_sessionmaker(engine)() as session:
            return await JOBS[job](session, now, settings)
    finally:
        await engine.dispose()


def main(argv: Sequence[str] | None = None) -> None:
    settings = get_settings()
    configure_logging(settings.log_level)
    job, now = parse_args(sys.argv[1:] if argv is None else argv, settings)
    result = asyncio.run(run(job, now, settings))
    print(f"{job} at {now.isoformat()}: {result}")


if __name__ == "__main__":
    main()
