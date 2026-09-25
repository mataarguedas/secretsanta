"""Nightly database backups (PRD §12 backup_database, CLAUDE.md §10 Backups)."""

import gzip
import io
import sys
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.core.config import get_settings
from app.scripts import backups as backups_cli
from app.services import backup
from app.storage.r2 import ObjectStorage
from app.worker import tasks
from app.worker.settings import WorkerSettings

NOW = datetime(2026, 12, 24, 8, 0, tzinfo=UTC)
SQL = "CREATE TABLE users (id uuid);\n-- ñ ✦\n"
FAKE_DUMP = [sys.executable, "-c", f"import sys; sys.stdout.buffer.write({SQL.encode()!r})"]


def put_backup(s3: ObjectStorage, taken: datetime) -> str:
    key = backup.backup_key(taken)
    s3.put(key, b"old", backup.CONTENT_TYPE)
    return key


def test_backup_key_is_utc_and_round_trips() -> None:
    costa_rica = datetime(2026, 12, 24, 2, 0, tzinfo=ZoneInfo("America/Costa_Rica"))
    key = backup.backup_key(costa_rica)
    assert key == "backups/santa-20261224-0800.sql.gz"
    assert backup.backup_time(key) == NOW
    for other in ("backups/notes.txt", "events/e/cover/x.webp", "backups/santa-2026.sql.gz"):
        assert backup.backup_time(other) is None


def test_only_backups_older_than_14_days_expire() -> None:
    keys = [
        backup.backup_key(NOW - timedelta(days=15)),
        backup.backup_key(NOW - timedelta(days=14, minutes=1)),
        backup.backup_key(NOW - timedelta(days=13)),
        "backups/keep-me.txt",
    ]
    assert backup.expired_backups(keys, NOW) == sorted(keys[:2])


def test_pg_dump_gets_the_password_through_the_environment() -> None:
    args, env = backup.pg_dump_command("postgresql+asyncpg://santa:s3cr3t@postgres:5432/santa")
    assert args[0] == "pg_dump"
    assert "--no-owner" in args
    assert not any("s3cr3t" in arg for arg in args)
    assert env == {
        "PGHOST": "postgres",
        "PGPORT": "5432",
        "PGUSER": "santa",
        "PGDATABASE": "santa",
        "PGPASSWORD": "s3cr3t",
    }


def test_run_backup_uploads_gzipped_sql_then_prunes(s3: ObjectStorage) -> None:
    expired = put_backup(s3, NOW - timedelta(days=15))
    recent = put_backup(s3, NOW - timedelta(days=13))
    s3.put("backups/README.txt", b"not a backup")

    result = backup.run_backup(get_settings(), s3, NOW, command=FAKE_DUMP)

    assert result.key == "backups/santa-20261224-0800.sql.gz"
    assert result.deleted == [expired]
    assert set(s3.list_keys("backups/")) == {result.key, recent, "backups/README.txt"}
    out = io.BytesIO()
    s3.download_fileobj(result.key, out)
    assert gzip.decompress(out.getvalue()).decode() == SQL
    head = s3._client.head_object(Bucket=s3.bucket, Key=result.key)
    assert head["ContentType"] == "application/gzip"
    assert result.size == head["ContentLength"]


def test_a_failed_dump_uploads_and_deletes_nothing(s3: ObjectStorage) -> None:
    expired = put_backup(s3, NOW - timedelta(days=30))
    failing = [sys.executable, "-c", "import sys; sys.stderr.write('boom'); sys.exit(3)"]

    with pytest.raises(backup.BackupError, match="exited with 3: boom"):
        backup.run_backup(get_settings(), s3, NOW, command=failing)
    assert s3.list_keys("backups/") == [expired]


async def test_backup_task_and_cron(s3: ObjectStorage, monkeypatch: pytest.MonkeyPatch) -> None:
    real = backup.run_backup
    monkeypatch.setattr(backup, "run_backup", lambda *args, **_kw: real(*args, command=FAKE_DUMP))
    key = await tasks.backup_database({})
    assert s3.list_keys("backups/") == [key]

    (job,) = [c for c in WorkerSettings.cron_jobs if c.coroutine is tasks.backup_database]
    assert (job.hour, job.minute) == (2, 0)
    assert WorkerSettings.timezone == ZoneInfo("America/Costa_Rica")


def test_backups_cli_lists_and_streams(
    s3: ObjectStorage, capsys: pytest.CaptureFixture[str]
) -> None:
    older = put_backup(s3, NOW - timedelta(days=2))
    newer = put_backup(s3, NOW - timedelta(days=1))
    s3.put("backups/README.txt", b"x")
    assert backups_cli.list_backups(s3) == [newer, older]

    backups_cli.main(["list"])
    assert capsys.readouterr().out.split() == [newer, older]

    out = io.BytesIO()
    backups_cli.cat_backup(s3, newer, out)
    assert out.getvalue() == b"old"
    with pytest.raises(ValueError, match="not a backup key"):
        backups_cli.cat_backup(s3, "events/e/cover/a.webp", out)
