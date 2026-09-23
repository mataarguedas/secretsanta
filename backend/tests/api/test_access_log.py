from typing import Any

import pytest
from fastapi import FastAPI
from httpx import AsyncClient

from app.core import middleware


@pytest.fixture
def logged_paths(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []

    class _Recorder:
        def info(self, event: str, **kw: Any) -> None:
            calls.append({"event": event, **kw})

        def exception(self, event: str, **kw: Any) -> None:
            calls.append({"event": event, **kw})

    monkeypatch.setattr(middleware, "log", _Recorder())
    return calls


async def test_path_params_are_logged_as_templates(
    app: FastAPI, client: AsyncClient, logged_paths: list[dict[str, Any]]
) -> None:
    @app.get("/api/v1/_test/invites/{token}")
    async def preview(token: str) -> dict[str, bool]:
        return {"ok": True}

    response = await client.get("/api/v1/_test/invites/sEcReT-InViTe?next=/x")
    assert response.status_code == 200

    (entry,) = [c for c in logged_paths if c["event"] == "request"]
    assert entry["path"] == "/api/v1/_test/invites/{token}"
    assert entry["method"] == "GET"
    assert entry["status"] == 200
    assert "sEcReT" not in repr(logged_paths)


async def test_unrouted_requests_do_not_log_raw_path(
    client: AsyncClient, logged_paths: list[dict[str, Any]]
) -> None:
    # Rejected by the CSRF middleware before routing.
    await client.post("/api/v1/invites/sEcReT/join")
    (entry,) = [c for c in logged_paths if c["event"] == "request"]
    assert entry["path"] == "<unrouted>"
    assert entry["status"] == 403
    assert "sEcReT" not in repr(logged_paths)
