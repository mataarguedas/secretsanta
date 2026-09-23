"""Auth routes: 10 requests/min/IP (slowapi + Redis)."""

import httpx
import pytest

from tests.api.auth_helpers import CSRF


async def test_login_is_rate_limited_after_ten_requests(client: httpx.AsyncClient) -> None:
    statuses = [(await client.get("/api/v1/auth/google/login")).status_code for _ in range(10)]
    assert statuses == [302] * 10
    response = await client.get("/api/v1/auth/google/login")
    assert response.status_code == 429
    assert response.json()["error"]["code"] == "RATE_LIMITED"
    assert response.headers["Retry-After"] == "60"


@pytest.mark.parametrize(
    ("method", "path"), [("POST", "/api/v1/auth/refresh"), ("POST", "/api/v1/auth/logout")]
)
async def test_session_routes_are_rate_limited(
    client: httpx.AsyncClient, method: str, path: str
) -> None:
    for _ in range(10):
        assert (await client.request(method, path, headers=CSRF)).status_code != 429
    response = await client.request(method, path, headers=CSRF)
    assert response.status_code == 429
    assert response.json()["error"]["code"] == "RATE_LIMITED"


async def test_limits_are_per_route(client: httpx.AsyncClient) -> None:
    for _ in range(10):
        await client.get("/api/v1/auth/google/login")
    assert (await client.post("/api/v1/auth/logout", headers=CSRF)).status_code == 204
