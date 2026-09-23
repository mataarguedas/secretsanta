from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy.ext.asyncio import create_async_engine

from app.api.deps import get_engine

HEALTH = "/api/v1/health"


async def test_health_ok(client: AsyncClient) -> None:
    response = await client.get(HEALTH)
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "db": "ok", "redis": "ok"}
    assert response.headers["x-request-id"]


async def test_health_503_when_redis_unreachable(
    app: FastAPI, client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        app.state.redis, "ping", AsyncMock(side_effect=RedisConnectionError("down"))
    )
    response = await client.get(HEALTH)
    assert response.status_code == 503
    assert response.json() == {"status": "error", "db": "ok", "redis": "error"}


async def test_health_503_when_db_unreachable(app: FastAPI, client: AsyncClient) -> None:
    # Port 1 on localhost refuses connections immediately.
    dead = create_async_engine(
        "postgresql+asyncpg://nobody:nothing@127.0.0.1:1/nope", connect_args={"timeout": 2}
    )
    app.dependency_overrides[get_engine] = lambda: dead
    try:
        response = await client.get(HEALTH)
    finally:
        app.dependency_overrides.clear()
        await dead.dispose()
    assert response.status_code == 503
    assert response.json() == {"status": "error", "db": "error", "redis": "ok"}


async def test_health_rejects_post_without_csrf_header(client: AsyncClient) -> None:
    response = await client.post(HEALTH)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "CSRF_HEADER_MISSING"


async def test_health_post_with_header_is_method_not_allowed(client: AsyncClient) -> None:
    response = await client.post(HEALTH, headers={"X-Requested-With": "fetch"})
    assert response.status_code == 405
    assert response.json()["error"]["code"] == "METHOD_NOT_ALLOWED"
    assert "GET" in response.headers["allow"]
