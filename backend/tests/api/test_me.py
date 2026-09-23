"""GET/PATCH /me and the current_user dependency."""

import uuid
from typing import Any

import httpx
import pytest
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import get_settings
from app.core.security import create_access_token
from app.models import User
from tests.api.auth_helpers import CSRF, login_as

ME = "/api/v1/me"
FIELDS = {
    "id",
    "name",
    "email",
    "avatar_url",
    "locale",
    "notify_message",
    "notify_wishlist",
    "notify_reminder",
}


async def test_me_requires_a_session(client: httpx.AsyncClient) -> None:
    response = await client.get(ME)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"


@pytest.mark.parametrize("token", ["garbage", "a.b.c", ""])
async def test_me_rejects_invalid_access_tokens(client: httpx.AsyncClient, token: str) -> None:
    response = await client.get(ME, headers={"Cookie": f"access_token={token}"})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"


async def test_me_rejects_a_token_for_an_unknown_user(client: httpx.AsyncClient) -> None:
    token = create_access_token(uuid.uuid4(), get_settings())
    response = await client.get(ME, headers={"Cookie": f"access_token={token}"})
    assert response.status_code == 401


async def test_me_after_the_user_is_deleted(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    await login_as(client)
    async with db() as session:
        await session.execute(delete(User))
        await session.commit()
    assert (await client.get(ME)).status_code == 401


async def test_me_returns_exactly_the_profile_schema(client: httpx.AsyncClient) -> None:
    await login_as(client, "carla@test.local", "Carla")
    response = await client.get(ME)
    assert response.status_code == 200
    body = response.json()
    assert set(body) == FIELDS  # never google_sub, tokens or timestamps
    assert body["email"] == "carla@test.local"
    assert body["name"] == "Carla"
    assert body["locale"] == "es"
    assert body["avatar_url"] is None
    assert body["notify_message"] is body["notify_wishlist"] is body["notify_reminder"] is True


async def test_patch_me_updates_locale_and_toggles(client: httpx.AsyncClient) -> None:
    await login_as(client)
    response = await client.patch(
        ME, json={"locale": "en", "notify_message": False, "notify_reminder": False}, headers=CSRF
    )
    assert response.status_code == 200
    body = response.json()
    assert body["locale"] == "en"
    assert body["notify_message"] is False
    assert body["notify_wishlist"] is True
    assert body["notify_reminder"] is False
    assert (await client.get(ME)).json() == body


async def test_patch_me_with_empty_body_is_a_no_op(client: httpx.AsyncClient) -> None:
    await login_as(client)
    before = (await client.get(ME)).json()
    response = await client.patch(ME, json={}, headers=CSRF)
    assert response.status_code == 200
    assert response.json() == before


@pytest.mark.parametrize(
    "payload",
    [
        {"locale": "fr"},
        {"locale": "EN"},
        {"locale": None},
        {"notify_message": None},
        {"notify_message": "yes"},
        {"notify_wishlist": 1},
        {"email": "new@example.com"},  # not editable (FR-ACC-1)
        {"name": "New name"},
        {"google_sub": "x"},
    ],
)
async def test_patch_me_validation(client: httpx.AsyncClient, payload: dict[str, Any]) -> None:
    await login_as(client)
    response = await client.patch(ME, json=payload, headers=CSRF)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


async def test_patch_me_requires_session_and_csrf_header(client: httpx.AsyncClient) -> None:
    assert (await client.patch(ME, json={"locale": "en"}, headers=CSRF)).status_code == 401
    await login_as(client)
    response = await client.patch(ME, json={"locale": "en"})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "CSRF_HEADER_MISSING"
