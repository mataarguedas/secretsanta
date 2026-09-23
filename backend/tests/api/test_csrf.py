import pytest
from fastapi import FastAPI
from httpx import AsyncClient

PATH = "/api/v1/_test/mutate"


@pytest.fixture(autouse=True)
def _mutating_route(app: FastAPI) -> None:
    @app.api_route(PATH, methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    async def mutate() -> dict[str, bool]:
        return {"ok": True}


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
async def test_mutating_request_without_header_is_rejected(
    client: AsyncClient, method: str
) -> None:
    response = await client.request(method, PATH)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "CSRF_HEADER_MISSING"


@pytest.mark.parametrize("value", ["XMLHttpRequest", "", "fetchx"])
async def test_wrong_header_value_is_rejected(client: AsyncClient, value: str) -> None:
    response = await client.post(PATH, headers={"X-Requested-With": value})
    assert response.status_code == 403


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
async def test_mutating_request_with_header_passes(client: AsyncClient, method: str) -> None:
    response = await client.request(method, PATH, headers={"X-Requested-With": "fetch"})
    assert response.status_code == 200
    assert response.json() == {"ok": True}


async def test_header_value_is_case_insensitive(client: AsyncClient) -> None:
    response = await client.post(PATH, headers={"x-requested-with": "Fetch"})
    assert response.status_code == 200


async def test_safe_methods_need_no_header(client: AsyncClient) -> None:
    assert (await client.get(PATH)).status_code == 200
