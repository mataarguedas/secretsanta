"""The API for the Playwright suite (``frontend/playwright.config.ts`` starts it):

    ENV=test uv run python -m tests.e2e_server

Isolated from development data, like the pytest suite:

- database ``santa_e2e`` (same server as ``DATABASE_URL``), **dropped and rebuilt with
  Alembic on every start**; Redis DB 14, flushed on start
- storage: always a local S3 endpoint (MinIO, ``http://127.0.0.1:9000``) and the bucket
  ``secret-santa-e2e``, created if missing, never the R2 endpoint
- no VAPID keys, so nothing reaches a real push service

Overrides: ``E2E_API_PORT`` (8001), ``E2E_DATABASE_URL``, ``E2E_REDIS_URL``,
``E2E_S3_ENDPOINT_URL``, ``E2E_S3_PUBLIC_ENDPOINT_URL``, ``E2E_S3_BUCKET``, and
``E2E_S3_ACCESS_KEY_ID`` / ``E2E_S3_SECRET_ACCESS_KEY`` (default: ``R2_ACCESS_KEY_ID`` /
``R2_SECRET_ACCESS_KEY``, which in development are the MinIO root user and password).

Lives under ``tests/`` so it never ships in the production image.
"""

import asyncio
import os
import sys
from pathlib import Path

import uvicorn
from alembic import command
from alembic.config import Config
from redis import Redis
from sqlalchemy import make_url, text
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import Settings, get_settings

BACKEND_DIR = Path(__file__).resolve().parents[1]


def configure_environment() -> str:
    """Point the app at the e2e database, Redis DB and bucket. Returns the database URL."""
    base = Settings()
    if not base.is_test:
        sys.exit("tests.e2e_server needs ENV=test (it mounts the test-only login).")
    if explicit := os.environ.get("E2E_DATABASE_URL"):
        db_url = make_url(explicit)
    else:
        db_url = make_url(base.database_url).set(database="santa_e2e")
    database_url = db_url.render_as_string(hide_password=False)
    os.environ.update(
        DATABASE_URL=database_url,
        REDIS_URL=os.environ.get("E2E_REDIS_URL") or base.redis_url.rsplit("/", 1)[0] + "/14",
        R2_ACCOUNT_ID="",
        S3_ENDPOINT_URL=os.environ.get("E2E_S3_ENDPOINT_URL", "http://127.0.0.1:9000"),
        S3_PUBLIC_ENDPOINT_URL=os.environ.get(
            "E2E_S3_PUBLIC_ENDPOINT_URL", "http://localhost:9000"
        ),
        R2_BUCKET=os.environ.get("E2E_S3_BUCKET", "secret-santa-e2e"),
        R2_ACCESS_KEY_ID=os.environ.get("E2E_S3_ACCESS_KEY_ID", base.r2_access_key_id),
        R2_SECRET_ACCESS_KEY=os.environ.get("E2E_S3_SECRET_ACCESS_KEY", base.r2_secret_access_key),
        VAPID_PUBLIC_KEY="",
        VAPID_PRIVATE_KEY="",
        JWT_SECRET=base.jwt_secret or "e2e-jwt-secret-" + "x" * 48,
    )
    get_settings.cache_clear()
    return database_url


async def recreate_database(database_url: str) -> None:
    target = make_url(database_url)
    admin = create_async_engine(target.set(database="postgres"), isolation_level="AUTOCOMMIT")
    try:
        async with admin.connect() as conn:
            await conn.execute(text(f'DROP DATABASE IF EXISTS "{target.database}" WITH (FORCE)'))
            await conn.execute(text(f'CREATE DATABASE "{target.database}"'))
    finally:
        await admin.dispose()


def ensure_bucket() -> None:
    from botocore.exceptions import ClientError

    from app.storage.r2 import get_storage

    storage = get_storage()
    try:
        storage._client.head_bucket(Bucket=storage.bucket)
    except ClientError:
        storage._client.create_bucket(Bucket=storage.bucket)


def main() -> None:
    database_url = configure_environment()
    asyncio.run(recreate_database(database_url))
    command.upgrade(Config(str(BACKEND_DIR / "alembic.ini")), "head")
    Redis.from_url(os.environ["REDIS_URL"]).flushdb()
    ensure_bucket()
    port = int(os.environ.get("E2E_API_PORT", "8001"))
    uvicorn.run("app.main:app", host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
