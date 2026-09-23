import re

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.core.errors import ERROR_REGISTRY, AppError

CSRF = {"X-Requested-With": "fetch"}


@pytest.fixture
def app_with_test_routes(app: FastAPI) -> FastAPI:
    @app.get("/api/v1/_test/validate")
    async def validate(count: int, secret_note: str) -> dict[str, int]:
        return {"count": count}

    @app.get("/api/v1/_test/app-error")
    async def app_error() -> None:
        raise AppError("NOT_FOUND", 404, event_id="abc")

    @app.get("/api/v1/_test/boom")
    async def boom() -> None:
        raise RuntimeError("kaboom with sensitive details")

    return app


@pytest.fixture
async def test_client(app_with_test_routes: FastAPI) -> AsyncClient:
    transport = ASGITransport(app=app_with_test_routes, raise_app_exceptions=False)
    return AsyncClient(transport=transport, base_url="http://testserver")


def assert_envelope(body: object, code: str) -> None:
    assert isinstance(body, dict)
    assert set(body) == {"error"}
    error = body["error"]
    assert error["code"] == code
    assert isinstance(error["message"], str)
    assert error["message"]
    assert set(error) <= {"code", "message", "params"}


async def test_unknown_route_is_not_found_envelope(client: AsyncClient) -> None:
    response = await client.get("/api/v1/does-not-exist")
    assert response.status_code == 404
    assert_envelope(response.json(), "NOT_FOUND")


async def test_validation_error_envelope_does_not_echo_input(test_client: AsyncClient) -> None:
    async with test_client as c:
        response = await c.get("/api/v1/_test/validate", params={"count": "not-a-number"})
    assert response.status_code == 422
    body = response.json()
    assert_envelope(body, "VALIDATION_ERROR")
    fields = body["error"]["params"]["fields"]
    assert {"loc": ["query", "count"], "type": "int_parsing"} in fields
    assert {"loc": ["query", "secret_note"], "type": "missing"} in fields
    assert "not-a-number" not in response.text


async def test_app_error_envelope_includes_params(test_client: AsyncClient) -> None:
    async with test_client as c:
        response = await c.get("/api/v1/_test/app-error")
    assert response.status_code == 404
    body = response.json()
    assert_envelope(body, "NOT_FOUND")
    assert body["error"]["params"] == {"event_id": "abc"}


async def test_unhandled_exception_is_internal_error_without_details(
    test_client: AsyncClient,
) -> None:
    async with test_client as c:
        response = await c.get("/api/v1/_test/boom")
    assert response.status_code == 500
    assert_envelope(response.json(), "INTERNAL_ERROR")
    assert "kaboom" not in response.text


def test_app_error_rejects_unregistered_code() -> None:
    with pytest.raises(ValueError, match="Unregistered"):
        AppError("NOT_A_REAL_CODE", 400)


def test_registry_codes_are_screaming_snake() -> None:
    for code, message in ERROR_REGISTRY.items():
        assert re.fullmatch(r"[A-Z][A-Z0-9]*(_[A-Z0-9]+)*", code), code
        assert message
