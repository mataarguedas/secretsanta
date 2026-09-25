"""/push: the VAPID key, subscriptions (devices) and the dev-only test push (Prompt 24)."""

import uuid
from collections.abc import AsyncIterator, Iterator
from typing import Any

import httpx
import pytest
from arq.connections import ArqRedis
from fastapi.routing import APIRoute
from httpx import ASGITransport
from redis.asyncio import Redis
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings, get_settings
from app.main import create_app
from app.models import PushSubscription, User
from tests.api.auth_helpers import CSRF, login_as

PUSH = "/api/v1/push"
CHROME_WINDOWS = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
)
SAFARI_IPHONE = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
)
P256DH = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM"
AUTH = "tBHItJI5svbpez7KI4CCXg"


def subscription(endpoint: str = "https://fcm.googleapis.com/fcm/send/abc", **extra: Any) -> dict:
    return {"endpoint": endpoint, "keys": {"p256dh": P256DH, "auth": AUTH}, **extra}


async def subscribe(client: httpx.AsyncClient, **kwargs: Any) -> httpx.Response:
    return await client.post(f"{PUSH}/subscriptions", json=subscription(**kwargs), headers=CSRF)


async def user_id(db: async_sessionmaker[AsyncSession], email: str) -> uuid.UUID:
    async with db() as session:
        found = await session.scalar(select(User.id).where(User.email == email))
    assert found is not None
    return found


async def rows(db: async_sessionmaker[AsyncSession]) -> list[PushSubscription]:
    async with db() as session:
        return list(await session.scalars(select(PushSubscription)))


# ── VAPID key ────────────────────────────────────────────────────────────────


async def test_every_push_route_needs_a_session(client: httpx.AsyncClient) -> None:
    for method, path in [
        ("GET", "/vapid-public-key"),
        ("GET", "/subscriptions"),
        ("POST", "/subscriptions"),
        ("DELETE", f"/subscriptions/{uuid.uuid4()}"),
        ("POST", "/test"),
    ]:
        response = await client.request(method, PUSH + path, headers=CSRF, json=subscription())
        assert response.status_code == 401, (method, path)
        assert response.json()["error"]["code"] == "AUTH_REQUIRED"


async def test_vapid_key_without_configuration_is_503(client: httpx.AsyncClient) -> None:
    await login_as(client)
    response = await client.get(f"{PUSH}/vapid-public-key")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "PUSH_NOT_CONFIGURED"


@pytest.fixture
async def configured_client(
    redis_client: Redis, clean_tables: None
) -> AsyncIterator[httpx.AsyncClient]:
    settings = get_settings().model_copy(
        update={"vapid_public_key": "BPublicKey", "vapid_private_key": "private"}
    )
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as ac:
            yield ac


async def test_vapid_public_key_only(configured_client: httpx.AsyncClient) -> None:
    await login_as(configured_client)
    response = await configured_client.get(f"{PUSH}/vapid-public-key")
    assert response.status_code == 200
    assert response.json() == {"public_key": "BPublicKey"}


# ── Subscribe ────────────────────────────────────────────────────────────────


async def test_subscribe_returns_the_device_never_the_endpoint_or_keys(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    await login_as(client)
    response = await subscribe(client, user_agent=CHROME_WINDOWS, expirationTime=None)
    assert response.status_code == 201, response.text
    device = response.json()
    assert set(device) == {"id", "browser", "os", "created_at", "last_success_at"}
    assert (device["browser"], device["os"], device["last_success_at"]) == (
        "Chrome",
        "Windows",
        None,
    )
    assert "fcm.googleapis.com" not in response.text
    assert AUTH not in response.text

    (row,) = await rows(db)
    assert row.user_id == await user_id(db, "ana@test.local")
    assert (row.endpoint, row.p256dh, row.auth) == (subscription()["endpoint"], P256DH, AUTH)


async def test_the_user_agent_falls_back_to_the_request_header(client: httpx.AsyncClient) -> None:
    await login_as(client)
    response = await client.post(
        f"{PUSH}/subscriptions",
        json=subscription(),
        headers={**CSRF, "User-Agent": SAFARI_IPHONE},
    )
    assert (response.json()["browser"], response.json()["os"]) == ("Safari", "iPhone")


async def test_subscribing_again_upserts_by_endpoint(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    await login_as(client)
    first = (await subscribe(client)).json()
    new_keys = {"p256dh": P256DH[::-1], "auth": AUTH[::-1]}
    again = await client.post(
        f"{PUSH}/subscriptions",
        json={"endpoint": subscription()["endpoint"], "keys": new_keys},
        headers=CSRF,
    )
    assert again.status_code == 201
    assert again.json()["id"] == first["id"]
    (row,) = await rows(db)
    assert (row.p256dh, row.auth) == (new_keys["p256dh"], new_keys["auth"])


async def test_the_same_browser_moves_to_whoever_subscribes_it_last(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    await login_as(client, "ana@test.local", "Ana")
    await subscribe(client)
    await login_as(client, "beto@test.local", "Beto")
    await subscribe(client)

    (row,) = await rows(db)
    assert row.user_id == await user_id(db, "beto@test.local")
    await login_as(client, "ana@test.local", "Ana")
    assert (await client.get(f"{PUSH}/subscriptions")).json() == []


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://fcm.googleapis.com/fcm/send/abc",  # not https
        "https://evil.example/fcm.googleapis.com",
        "https://fcm.googleapis.com.evil.example/x",
        "https://169.254.169.254/latest/meta-data",
        "https://localhost:8000/api/v1/me",
        "not a url",
        "https://fcm.googleapis.com/" + "x" * 2048,
    ],
)
async def test_only_browser_push_services_are_accepted(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession], endpoint: str
) -> None:
    await login_as(client)
    response = await subscribe(client, endpoint=endpoint)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert await rows(db) == []


@pytest.mark.parametrize(
    "endpoint",
    [
        "https://fcm.googleapis.com/fcm/send/abc",
        "https://updates.push.services.mozilla.com/wpush/v2/abc",
        "https://wns2-par02p.notify.windows.com/w/?token=abc",
        "https://web.push.apple.com/QGuQyavXutnMH",
    ],
)
async def test_the_major_push_services_are_accepted(
    client: httpx.AsyncClient, endpoint: str
) -> None:
    await login_as(client)
    assert (await subscribe(client, endpoint=endpoint)).status_code == 201


@pytest.mark.parametrize(
    "keys",
    [
        {"p256dh": P256DH},
        {"p256dh": "not base64!" * 3, "auth": AUTH},
        {"p256dh": P256DH, "auth": "x"},
        {"p256dh": P256DH, "auth": AUTH, "extra": "no"},
    ],
)
async def test_malformed_keys_are_refused(client: httpx.AsyncClient, keys: dict) -> None:
    await login_as(client)
    response = await client.post(
        f"{PUSH}/subscriptions",
        json={"endpoint": subscription()["endpoint"], "keys": keys},
        headers=CSRF,
    )
    assert response.status_code == 422


async def test_subscribe_needs_the_csrf_header(client: httpx.AsyncClient) -> None:
    await login_as(client)
    response = await client.post(f"{PUSH}/subscriptions", json=subscription())
    assert response.status_code == 403


# ── Devices ──────────────────────────────────────────────────────────────────


async def test_my_devices_are_mine_newest_first(client: httpx.AsyncClient) -> None:
    await login_as(client, "beto@test.local", "Beto")
    await subscribe(client, endpoint="https://fcm.googleapis.com/fcm/send/beto")
    await login_as(client, "ana@test.local", "Ana")
    older = (await subscribe(client, endpoint="https://fcm.googleapis.com/fcm/send/1")).json()
    newer = (
        await subscribe(client, endpoint="https://web.push.apple.com/2", user_agent=SAFARI_IPHONE)
    ).json()

    devices = (await client.get(f"{PUSH}/subscriptions")).json()
    assert [d["id"] for d in devices] == [newer["id"], older["id"]]
    assert devices[0]["os"] == "iPhone"


async def test_remove_my_device(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    await login_as(client)
    device = (await subscribe(client)).json()
    response = await client.delete(f"{PUSH}/subscriptions/{device['id']}", headers=CSRF)
    assert response.status_code == 204
    assert await rows(db) == []
    again = await client.delete(f"{PUSH}/subscriptions/{device['id']}", headers=CSRF)
    assert again.json()["error"]["code"] == "PUSH_SUBSCRIPTION_NOT_FOUND"


async def test_nobody_removes_someone_elses_device(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    await login_as(client, "ana@test.local", "Ana")
    device = (await subscribe(client)).json()
    await login_as(client, "beto@test.local", "Beto")
    response = await client.delete(f"{PUSH}/subscriptions/{device['id']}", headers=CSRF)
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "PUSH_SUBSCRIPTION_NOT_FOUND"
    assert len(await rows(db)) == 1


async def test_deleting_the_user_deletes_their_subscriptions(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    await login_as(client)
    await subscribe(client)
    async with db() as session:
        user = await session.get(User, await user_id(db, "ana@test.local"))
        await session.delete(user)
        await session.commit()
        assert await session.scalar(select(func.count(PushSubscription.id))) == 0


# ── Dev-only test push ───────────────────────────────────────────────────────


async def test_send_test_notification_queues_a_worker_job(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession], arq_pool: ArqRedis
) -> None:
    await login_as(client)
    response = await client.post(f"{PUSH}/test", headers=CSRF)
    assert response.status_code == 202
    jobs = [(job.function, job.args) for job in await arq_pool.queued_jobs()]
    assert jobs == [("send_test_notification", (str(await user_id(db, "ana@test.local")),))]


def _paths(settings: Settings) -> set[str]:
    """Every path of the app, including those of nested included routers."""

    def walk(routes: list[Any], prefix: str = "") -> Iterator[str]:
        for route in routes:
            if hasattr(route, "original_router"):  # FastAPI's included-router wrapper
                inner = getattr(route.include_context, "prefix", "") or ""
                yield from walk(route.original_router.routes, prefix + inner)
            elif isinstance(route, APIRoute):
                yield prefix + route.path

    return set(walk(create_app(settings).routes))


def test_the_test_push_route_does_not_exist_in_production() -> None:
    base = get_settings()
    production = base.model_copy(
        update={"env": "production", "vapid_public_key": "k", "vapid_private_key": "k"}
    )
    development = base.model_copy(update={"env": "development"})
    assert f"{PUSH}/test" not in _paths(production)
    assert f"{PUSH}/subscriptions" in _paths(production)
    assert f"{PUSH}/test" in _paths(development)
