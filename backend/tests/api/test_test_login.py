"""The test-only login router exists only when ENV=test."""

from typing import Any

import httpx
import pytest
from httpx import ASGITransport

from app.core.config import Settings, get_settings
from app.main import create_app
from tests.api.auth_helpers import CSRF, cookie_attrs, login_as

PROD_SECRETS: dict[str, Any] = {
    "jwt_secret": "x" * 64,
    "google_client_id": "id",
    "google_client_secret": "secret",
    "vapid_public_key": "pub",
    "vapid_private_key": "priv",
}


async def test_test_login_sets_the_same_session_cookies(client: httpx.AsyncClient) -> None:
    response = await login_as(client, "carla@test.local", "Carla")
    assert response.json()["name"] == "Carla"
    assert cookie_attrs(response, "access_token")["httponly"] is True
    assert cookie_attrs(response, "refresh_token")["path"] == "/api/v1/auth"
    assert (await client.get("/api/v1/me")).json()["email"] == "carla@test.local"


async def test_test_login_gets_the_existing_user(client: httpx.AsyncClient) -> None:
    first = (await login_as(client, "carla@test.local", "Carla")).json()
    again = (await login_as(client, "CARLA@test.local", "Other name")).json()
    assert again["id"] == first["id"]
    assert again["name"] == "Carla"


@pytest.mark.parametrize(
    "payload", [{"email": "no-at-sign", "name": "X"}, {"email": "a@b.c"}, {"name": "X"}, {}]
)
async def test_test_login_validates_input(
    client: httpx.AsyncClient, payload: dict[str, str]
) -> None:
    response = await client.post("/api/v1/test/login", json=payload, headers=CSRF)
    assert response.status_code == 422


@pytest.mark.parametrize(
    "overrides", [{"env": "development"}, {"env": "production", **PROD_SECRETS}]
)
async def test_test_login_is_404_outside_the_test_environment(overrides: dict[str, Any]) -> None:
    settings = Settings(
        _env_file=None,  # type: ignore[call-arg]
        database_url=get_settings().database_url,
        redis_url=get_settings().redis_url,
        **overrides,
    )
    assert not settings.is_test
    app = create_app(settings)
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        response = await c.post(
            "/api/v1/test/login", json={"email": "a@b.c", "name": "A"}, headers=CSRF
        )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"
