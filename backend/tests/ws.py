"""A WebSocket client for tests that drives the ASGI app directly, in the test's own event
loop (httpx has no WebSocket support, and Starlette's TestClient runs the app in another
thread and loop). The app's lifespan must already be running (the ``client`` fixture)."""

import asyncio
import contextlib
import json
from types import TracebackType
from typing import Any, Final

import httpx
from fastapi import FastAPI

DEFAULT_ORIGIN: Final = "http://localhost:5173"  # APP_BASE_URL in the test settings
TIMEOUT: Final = 3.0


class WsClosedError(Exception):
    def __init__(self, code: int) -> None:
        super().__init__(f"closed with {code}")
        self.code = code


def cookie_header(client: httpx.AsyncClient) -> str:
    """The current cookies of an httpx client (e.g. right after ``login_as``)."""
    return "; ".join(f"{cookie.name}={cookie.value}" for cookie in client.cookies.jar)


class WsClient:
    def __init__(
        self,
        app: FastAPI,
        *,
        cookies: str = "",
        origin: str | None = DEFAULT_ORIGIN,
        path: str = "/ws",
    ) -> None:
        self.app = app
        headers = [(b"host", b"testserver")]
        if cookies:
            headers.append((b"cookie", cookies.encode()))
        if origin is not None:
            headers.append((b"origin", origin.encode()))
        self.scope: dict[str, Any] = {
            "type": "websocket",
            "asgi": {"version": "3.0"},
            "scheme": "ws",
            "http_version": "1.1",
            "path": path,
            "raw_path": path.encode(),
            "root_path": "",
            "query_string": b"",
            "headers": headers,
            "client": ("127.0.0.1", 50000),
            "server": ("testserver", 80),
            "subprotocols": [],
            "state": {},
        }
        self._to_app: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._from_app: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._task: asyncio.Task[None] | None = None
        self.accepted = False
        self.close_code: int | None = None
        self.frames: list[dict[str, Any]] = []  # every frame received, in order

    async def _receive(self) -> dict[str, Any]:
        return await self._to_app.get()

    async def _send(self, message: dict[str, Any]) -> None:
        await self._from_app.put(message)

    async def connect(self) -> "WsClient":
        await self._to_app.put({"type": "websocket.connect"})
        self._task = asyncio.create_task(self.app(self.scope, self._receive, self._send))  # type: ignore[arg-type]
        first = await asyncio.wait_for(self._from_app.get(), TIMEOUT)
        if first["type"] == "websocket.accept":
            self.accepted = True
        elif first["type"] == "websocket.close":
            self.close_code = first.get("code", 1000)
        else:  # pragma: no cover
            raise AssertionError(f"unexpected first message {first}")
        return self

    async def __aenter__(self) -> "WsClient":
        return await self.connect()

    async def __aexit__(
        self,
        _exc_type: type[BaseException] | None,
        _exc: BaseException | None,
        _tb: TracebackType | None,
    ) -> None:
        await self.close()

    async def send_text(self, text: str) -> None:
        await self._to_app.put({"type": "websocket.receive", "text": text})

    async def send_json(self, frame: dict[str, Any]) -> None:
        await self.send_text(json.dumps(frame))

    async def receive_json(self, wait: float = TIMEOUT) -> dict[str, Any]:
        message = await asyncio.wait_for(self._from_app.get(), wait)
        if message["type"] == "websocket.close":
            self.close_code = message.get("code", 1000)
            raise WsClosedError(self.close_code or 1000)
        frame: dict[str, Any] = json.loads(message["text"])
        self.frames.append(frame)
        return frame

    async def receive_until(self, frame_type: str, wait: float = TIMEOUT) -> dict[str, Any]:
        """Skip other frames until one of ``frame_type`` arrives."""
        loop = asyncio.get_running_loop()
        deadline = loop.time() + wait
        while True:
            frame = await self.receive_json(max(deadline - loop.time(), 0.01))
            if frame["type"] == frame_type:
                return frame

    async def expect_nothing(self, wait: float = 0.3) -> None:
        with contextlib.suppress(TimeoutError):
            frame = await self.receive_json(wait)
            raise AssertionError(f"unexpected frame {frame}")

    async def drain(self, wait: float = 0.3) -> list[dict[str, Any]]:
        got: list[dict[str, Any]] = []
        with contextlib.suppress(TimeoutError):
            while True:
                got.append(await self.receive_json(wait))
        return got

    async def ping(self) -> None:
        """Round-trip: every frame sent before it has been handled when the pong arrives."""
        await self.send_json({"type": "ping"})
        await self.receive_until("pong")

    async def close(self) -> None:
        if self._task is None:
            return
        await self._to_app.put({"type": "websocket.disconnect", "code": 1000})
        with contextlib.suppress(Exception):
            await asyncio.wait_for(self._task, TIMEOUT)
        self._task = None
