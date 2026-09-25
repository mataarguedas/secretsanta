"""Nightly database backup (PRD §12 ``backup_database``, CLAUDE.md §10 Backups).

``pg_dump`` (plain SQL, no owners or privileges, so it restores into any database) is
gzipped into a temporary file, uploaded to R2 as ``backups/santa-YYYYMMDD-HHMM.sql.gz``
(UTC), and only **then** backups older than 14 days are deleted, so a failed dump never
costs an old backup. The restore steps are in the README.

The connection settings go to ``pg_dump`` through ``PG*`` environment variables, never
the command line, so the password doesn't show up in ``ps``. Everything here is blocking:
call it through ``asyncio.to_thread`` from async code.
"""

import gzip
import os
import re
import shutil
import subprocess
import tempfile
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Final

from sqlalchemy import make_url

from app.core.config import Settings
from app.storage.r2 import ObjectStorage

BACKUP_PREFIX: Final = "backups/"
RETENTION: Final = timedelta(days=14)
CONTENT_TYPE: Final = "application/gzip"
_KEY_FORMAT: Final = "%Y%m%d-%H%M"
_KEY_RE: Final = re.compile(r"^backups/santa-(\d{8}-\d{4})\.sql\.gz$")
_CHUNK: Final = 1 << 20


class BackupError(RuntimeError):
    pass


@dataclass(frozen=True)
class BackupResult:
    key: str
    size: int
    deleted: list[str]


def backup_key(now: datetime) -> str:
    return f"{BACKUP_PREFIX}santa-{now.astimezone(UTC).strftime(_KEY_FORMAT)}.sql.gz"


def backup_time(key: str) -> datetime | None:
    """When a backup was taken, from its key; ``None`` for anything that isn't one."""
    match = _KEY_RE.match(key)
    if match is None:
        return None
    return datetime.strptime(match.group(1), _KEY_FORMAT).replace(tzinfo=UTC)


def expired_backups(
    keys: Iterable[str], now: datetime, retention: timedelta = RETENTION
) -> list[str]:
    cutoff = now - retention
    return sorted(k for k in keys if (taken := backup_time(k)) is not None and taken < cutoff)


def pg_dump_command(database_url: str) -> tuple[list[str], dict[str, str]]:
    """``pg_dump`` arguments plus the ``PG*`` variables for ``DATABASE_URL``."""
    url = make_url(database_url)
    env = {
        "PGHOST": url.host or "localhost",
        "PGPORT": str(url.port or 5432),
        "PGUSER": url.username or "",
        "PGDATABASE": url.database or "",
    }
    if url.password:
        env["PGPASSWORD"] = str(url.password)
    return ["pg_dump", "--no-owner", "--no-privileges", "--format=plain"], env


def dump_to_gzip(command: Sequence[str], env: dict[str, str], dest: Path) -> None:
    """Run the dump command and gzip its output into ``dest``; raise if it fails."""
    with tempfile.TemporaryFile() as stderr:
        with (
            subprocess.Popen(  # noqa: S603  (fixed argv, no shell)
                list(command), stdout=subprocess.PIPE, stderr=stderr, env={**os.environ, **env}
            ) as proc,
            gzip.open(dest, "wb") as out,
        ):
            assert proc.stdout is not None  # noqa: S101  (stdout=PIPE)
            shutil.copyfileobj(proc.stdout, out, _CHUNK)
        if proc.returncode != 0:
            stderr.seek(0)
            detail = stderr.read().decode(errors="replace").strip()[-500:]
            raise BackupError(f"{command[0]} exited with {proc.returncode}: {detail}")


def run_backup(
    settings: Settings,
    storage: ObjectStorage,
    now: datetime,
    *,
    command: Sequence[str] | None = None,
) -> BackupResult:
    """Dump, upload, then prune. ``command`` replaces ``pg_dump`` in tests."""
    args, env = pg_dump_command(settings.database_url)
    key = backup_key(now)
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "backup.sql.gz"
        dump_to_gzip(command or args, env, path)
        size = path.stat().st_size
        storage.upload_file(str(path), key, CONTENT_TYPE)
    deleted = [k for k in expired_backups(storage.list_keys(BACKUP_PREFIX), now) if k != key]
    if deleted:
        storage.delete_many(deleted)
    return BackupResult(key=key, size=size, deleted=deleted)
