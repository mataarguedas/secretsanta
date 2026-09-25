"""Realtime (Prompt 22): /ws auth and origin, frames, Redis fan-out across processes,
active-conversation tracking."""

import asyncio
import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import get_settings
from app.main import create_app
from app.realtime.bridge import RedisBridge
from app.realtime.channels import active_key
from app.realtime.manager import QUEUE_SIZE, SLOW_CONSUMER_CODE, Connection, ConnectionManager
from tests.api.auth_helpers import CSRF, login_as
from tests.api.event_helpers import (
    ANA,
    BETO,
    CARLA,
    EVENTS,
    add_participant,
    create,
    set_state,
    user_id,
)
from tests.conftest import TEST_REDIS_URL
from tests.ws import WsClient, WsClosedError, cookie_header

API = "/api/v1"


async def setup_event(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> tuple[dict[str, Any], dict[str, str]]:
    """Ana hosts Beto and Carla. Returns the event and each person's cookie header."""
    cookies: dict[str, str] = {}
    for person in (BETO, CARLA, ANA):
        await login_as(client, *person)
        cookies[person[0]] = cookie_header(client)
    event = await create(client)
    for person in (BETO, CARLA):
        await add_participant(db, event["id"], person[0])
    return event, cookies


async def start(
    client: httpx.AsyncClient, cookies: str, event: dict[str, Any], to: uuid.UUID, kind: str
) -> dict[str, Any]:
    response = await client.post(
        f"{EVENTS}/{event['id']}/conversations",
        json={"kind": kind, "recipient_id": str(to)},
        headers={**CSRF, "cookie": cookies},
    )
    assert response.status_code in (200, 201), response.text
    body: dict[str, Any] = response.json()
    return body


async def rest_send(
    client: httpx.AsyncClient, cookies: str, conversation_id: str, body: str
) -> httpx.Response:
    return await client.post(
        f"{API}/conversations/{conversation_id}/messages",
        json={"body": body},
        headers={**CSRF, "cookie": cookies},
    )


async def subscribe(ws: WsClient, *conversation_ids: str) -> None:
    await ws.send_json({"type": "subscribe", "conversation_ids": list(conversation_ids)})
    await ws.ping()  # frames are handled in order: the subscription is live now


# ── Handshake ────────────────────────────────────────────────────────────────


async def test_unauthenticated_sockets_are_closed_with_4401(
    client: httpx.AsyncClient, app: FastAPI
) -> None:
    for cookies in ("", "access_token=not-a-jwt"):
        ws = await WsClient(app, cookies=cookies).connect()
        assert ws.accepted
        with pytest.raises(WsClosedError) as closed:
            await ws.receive_json()
        assert closed.value.code == 4401
        await ws.close()


@pytest.mark.parametrize("origin", [None, "https://evil.example", "http://localhost:5174", "null"])
async def test_foreign_origins_are_refused_at_the_handshake(
    client: httpx.AsyncClient, app: FastAPI, origin: str | None
) -> None:
    await login_as(client, *ANA)
    ws = await WsClient(app, cookies=cookie_header(client), origin=origin).connect()
    assert not ws.accepted
    assert ws.close_code == 4403
    await ws.close()


async def test_the_app_origin_is_accepted(client: httpx.AsyncClient, app: FastAPI) -> None:
    await login_as(client, *ANA)
    async with WsClient(app, cookies=cookie_header(client), origin="HTTP://LOCALHOST:5173") as ws:
        assert ws.accepted
        await ws.ping()


# ── Frames ───────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "text",
    [
        "garbage",
        "[]",
        '{"type": "shout"}',
        '{"type": "subscribe", "conversation_ids": ["not-a-uuid"]}',
        '{"type": "ping", "extra": 1}',
        '{"type": "send", "conversation_id": "x", "body": "hi"}',
        "x" * 20_000,
    ],
)
async def test_malformed_frames_get_an_error_and_the_socket_stays_open(
    client: httpx.AsyncClient, app: FastAPI, text: str
) -> None:
    await login_as(client, *ANA)
    async with WsClient(app, cookies=cookie_header(client)) as ws:
        await ws.send_text(text)
        assert await ws.receive_json() == {
            "type": "error",
            "client_id": None,
            "code": "INVALID_FRAME",
        }
        await ws.ping()


async def test_a_binary_frame_is_an_error_too(client: httpx.AsyncClient, app: FastAPI) -> None:
    await login_as(client, *ANA)
    async with WsClient(app, cookies=cookie_header(client)) as ws:
        await ws._to_app.put({"type": "websocket.receive", "bytes": b"\x00\x01"})
        assert (await ws.receive_json())["code"] == "INVALID_FRAME"
        await ws.ping()


async def test_send_acks_and_reaches_the_other_members_socket(
    client: httpx.AsyncClient, app: FastAPI, db: async_sessionmaker[AsyncSession]
) -> None:
    event, cookies = await setup_event(client, db)
    beto = await user_id(db, BETO[0])
    direct = await start(client, cookies[ANA[0]], event, beto, "direct")

    async with (
        WsClient(app, cookies=cookies[ANA[0]]) as ana,
        WsClient(app, cookies=cookies[BETO[0]]) as beto_ws,
        WsClient(app, cookies=cookies[CARLA[0]]) as carla,
    ):
        for ws in (ana, beto_ws, carla):
            await subscribe(ws, direct["id"])
        await ana.send_json(
            {"type": "send", "conversation_id": direct["id"], "body": "  hola  ", "client_id": "c1"}
        )
        ack = await ana.receive_until("ack")
        got = await beto_ws.receive_until("message")
        assert ack == {"type": "ack", "client_id": "c1", "message_id": got["message"]["id"]}
        assert got == {
            "type": "message",
            "conversation_id": direct["id"],
            "message": {
                "id": ack["message_id"],
                "conversation_id": direct["id"],
                "sender_member_id": direct["my_member"]["id"],
                "body": "hola",
                "deleted": False,
                "created_at": got["message"]["created_at"],
            },
        }
        # Carla isn't in the thread: her subscription was dropped silently.
        await carla.expect_nothing()

    history = await client.get(
        f"{API}/conversations/{direct['id']}/messages", headers={"cookie": cookies[BETO[0]]}
    )
    assert [m["body"] for m in history.json()["items"]] == ["hola"]


async def test_send_errors_carry_the_client_id(
    client: httpx.AsyncClient, app: FastAPI, db: async_sessionmaker[AsyncSession]
) -> None:
    event, cookies = await setup_event(client, db)
    carla = await user_id(db, CARLA[0])
    await login_as(client, *BETO)
    theirs = await start(client, cookies[BETO[0]], event, carla, "direct")
    ana_thread = await start(client, cookies[ANA[0]], event, carla, "direct")

    async with WsClient(app, cookies=cookies[ANA[0]]) as ws:
        cases = [
            (theirs["id"], "hola", "CONVERSATION_NOT_FOUND"),
            (str(uuid.uuid4()), "hola", "CONVERSATION_NOT_FOUND"),
            (ana_thread["id"], "   ", "VALIDATION_ERROR"),
            (ana_thread["id"], "x" * 2001, "VALIDATION_ERROR"),
        ]
        for n, (conversation_id, body, code) in enumerate(cases):
            client_id = f"c{n}"
            await ws.send_json(
                {
                    "type": "send",
                    "conversation_id": conversation_id,
                    "body": body,
                    "client_id": client_id,
                }
            )
            assert await ws.receive_until("error") == {
                "type": "error",
                "client_id": client_id,
                "code": code,
            }

        await set_state(db, event["id"], "archived")
        await ws.send_json(
            {"type": "send", "conversation_id": ana_thread["id"], "body": "hola", "client_id": "z"}
        )
        assert (await ws.receive_until("error"))["code"] == "CONVERSATION_READ_ONLY"


async def test_ws_and_rest_share_the_30_per_minute_limit(
    client: httpx.AsyncClient, app: FastAPI, db: async_sessionmaker[AsyncSession]
) -> None:
    event, cookies = await setup_event(client, db)
    direct = await start(client, cookies[ANA[0]], event, await user_id(db, BETO[0]), "direct")
    for n in range(20):
        assert (await rest_send(client, cookies[ANA[0]], direct["id"], f"r{n}")).status_code == 201
    async with WsClient(app, cookies=cookies[ANA[0]]) as ws:
        for n in range(10):
            await ws.send_json(
                {"type": "send", "conversation_id": direct["id"], "body": "w", "client_id": f"w{n}"}
            )
            assert (await ws.receive_until("ack"))["client_id"] == f"w{n}"
        await ws.send_json(
            {"type": "send", "conversation_id": direct["id"], "body": "w", "client_id": "over"}
        )
        assert await ws.receive_until("error") == {
            "type": "error",
            "client_id": "over",
            "code": "RATE_LIMITED",
        }
    limited = await rest_send(client, cookies[ANA[0]], direct["id"], "again")
    assert limited.status_code == 429


async def test_rest_delete_and_send_are_published(
    client: httpx.AsyncClient, app: FastAPI, db: async_sessionmaker[AsyncSession]
) -> None:
    event, cookies = await setup_event(client, db)
    direct = await start(client, cookies[ANA[0]], event, await user_id(db, BETO[0]), "direct")
    async with WsClient(app, cookies=cookies[BETO[0]]) as beto:
        await subscribe(beto, direct["id"])
        sent = (await rest_send(client, cookies[ANA[0]], direct["id"], "chao")).json()
        assert (await beto.receive_until("message"))["message"]["id"] == sent["id"]
        deleted = await client.delete(
            f"{API}/messages/{sent['id']}", headers={**CSRF, "cookie": cookies[ANA[0]]}
        )
        assert deleted.status_code == 204
        assert await beto.receive_until("message_deleted") == {
            "type": "message_deleted",
            "conversation_id": direct["id"],
            "message_id": sent["id"],
        }


async def test_new_threads_are_announced_to_the_recipient(
    client: httpx.AsyncClient, app: FastAPI, db: async_sessionmaker[AsyncSession]
) -> None:
    """Direct: at once. Anonymous: only with its first message (FR-CHT-3)."""
    event, cookies = await setup_event(client, db)
    beto = await user_id(db, BETO[0])
    async with WsClient(app, cookies=cookies[BETO[0]]) as beto_ws:
        direct = await start(client, cookies[ANA[0]], event, beto, "direct")
        assert await beto_ws.receive_until("conversation_created") == {
            "type": "conversation_created",
            "conversation_id": direct["id"],
        }
        await start(client, cookies[ANA[0]], event, beto, "direct")  # idempotent: no repeat
        anon = await start(client, cookies[ANA[0]], event, beto, "anonymous")
        await beto_ws.expect_nothing()

        await rest_send(client, cookies[ANA[0]], anon["id"], "¿Qué te gusta?")
        assert await beto_ws.receive_until("conversation_created") == {
            "type": "conversation_created",
            "conversation_id": anon["id"],
        }
        await rest_send(client, cookies[ANA[0]], anon["id"], "otra")
        await beto_ws.expect_nothing()  # announced once


async def test_event_drawn_carries_only_the_event_id(
    client: httpx.AsyncClient, app: FastAPI, db: async_sessionmaker[AsyncSession]
) -> None:
    event, cookies = await setup_event(client, db)
    sockets = [await WsClient(app, cookies=cookies[p[0]]).connect() for p in (ANA, BETO, CARLA)]
    try:
        drawn = await client.post(
            f"{EVENTS}/{event['id']}/draw", headers={**CSRF, "cookie": cookies[ANA[0]]}
        )
        assert drawn.status_code == 200, drawn.text
        for ws in sockets:
            assert await ws.receive_json() == {"type": "event_drawn", "event_id": event["id"]}
            await ws.expect_nothing()
    finally:
        for ws in sockets:
            await ws.close()


# ── Active conversation ──────────────────────────────────────────────────────


async def test_active_sets_refreshes_and_clears_the_redis_key(
    client: httpx.AsyncClient,
    app: FastAPI,
    db: async_sessionmaker[AsyncSession],
    redis_client: Redis,
) -> None:
    event, cookies = await setup_event(client, db)
    ana = await user_id(db, ANA[0])
    direct = await start(client, cookies[ANA[0]], event, await user_id(db, BETO[0]), "direct")
    key = active_key(ana)

    async with WsClient(app, cookies=cookies[ANA[0]]) as ws:
        await ws.send_json({"type": "active", "conversation_id": direct["id"]})
        await ws.ping()
        assert await redis_client.get(key) == direct["id"]
        assert 0 < await redis_client.ttl(key) <= 60

        await redis_client.expire(key, 5)
        await ws.ping()  # a heartbeat refreshes it
        assert await redis_client.ttl(key) > 50

        await ws.send_json({"type": "active", "conversation_id": None})
        await ws.ping()
        assert await redis_client.get(key) is None

        # Only for conversations you're in.
        await ws.send_json({"type": "active", "conversation_id": str(uuid.uuid4())})
        assert (await ws.receive_until("error"))["code"] == "CONVERSATION_NOT_FOUND"
        assert await redis_client.get(key) is None

        await ws.send_json({"type": "active", "conversation_id": direct["id"]})
        await ws.ping()
    # Closing the tab clears it.
    await asyncio.sleep(0.05)
    assert await redis_client.get(key) is None


async def test_closing_one_tab_keeps_another_tabs_active_conversation(
    client: httpx.AsyncClient,
    app: FastAPI,
    db: async_sessionmaker[AsyncSession],
    redis_client: Redis,
) -> None:
    event, cookies = await setup_event(client, db)
    ana = await user_id(db, ANA[0])
    first = await start(client, cookies[ANA[0]], event, await user_id(db, BETO[0]), "direct")
    second = await start(client, cookies[ANA[0]], event, await user_id(db, CARLA[0]), "direct")
    async with WsClient(app, cookies=cookies[ANA[0]]) as tab2:
        async with WsClient(app, cookies=cookies[ANA[0]]) as tab1:
            await tab1.send_json({"type": "active", "conversation_id": first["id"]})
            await tab1.ping()
            await tab2.send_json({"type": "active", "conversation_id": second["id"]})
            await tab2.ping()
        await asyncio.sleep(0.05)
        assert await redis_client.get(active_key(ana)) == second["id"]


# ── Several processes ────────────────────────────────────────────────────────


@pytest.fixture
async def second_process(client: httpx.AsyncClient) -> AsyncIterator[FastAPI]:
    """Another API process: its own app, ConnectionManager and Redis bridge."""
    other = create_app(get_settings())
    async with other.router.lifespan_context(other):
        yield other


async def test_a_message_reaches_a_socket_on_another_process(
    client: httpx.AsyncClient,
    app: FastAPI,
    second_process: FastAPI,
    db: async_sessionmaker[AsyncSession],
) -> None:
    event, cookies = await setup_event(client, db)
    direct = await start(client, cookies[ANA[0]], event, await user_id(db, BETO[0]), "direct")

    async with (
        WsClient(app, cookies=cookies[ANA[0]]) as ana,
        WsClient(second_process, cookies=cookies[BETO[0]]) as beto,
    ):
        await subscribe(beto, direct["id"])
        assert app.state.ws_manager is not second_process.state.ws_manager
        assert (app.state.ws_manager.count, second_process.state.ws_manager.count) == (1, 1)

        await ana.send_json(
            {"type": "send", "conversation_id": direct["id"], "body": "cruzado", "client_id": "x"}
        )
        await ana.receive_until("ack")
        got = await beto.receive_until("message")
        assert got["message"]["body"] == "cruzado"

        # user:{id} frames cross too: a new thread for Beto, started through process 1.
        carla_thread = await start(
            client, cookies[CARLA[0]], event, await user_id(db, BETO[0]), "direct"
        )
        assert (await beto.receive_until("conversation_created"))["conversation_id"] == (
            carla_thread["id"]
        )
    assert (app.state.ws_manager.count, second_process.state.ws_manager.count) == (0, 0)


# ── ConnectionManager (unit) ─────────────────────────────────────────────────


class FakeSocket:
    def __init__(self) -> None:
        self.sent: list[str] = []
        self.closed: int | None = None

    async def send_text(self, text: str) -> None:
        self.sent.append(text)

    async def close(self, code: int = 1000) -> None:
        self.closed = code


async def test_manager_routes_by_channel_and_forgets_on_remove() -> None:
    manager = ConnectionManager()
    ana, beto = uuid.uuid4(), uuid.uuid4()
    conv = uuid.uuid4()
    a = Connection(FakeSocket(), ana)  # type: ignore[arg-type]
    b = Connection(FakeSocket(), beto)  # type: ignore[arg-type]
    for connection in (a, b):
        manager.add(connection)
    manager.subscribe(a, [conv])

    assert manager.deliver(f"conv:{conv}", "m1") == 1
    assert manager.deliver(f"user:{beto}", "u1") == 1
    assert manager.deliver(f"user:{uuid.uuid4()}", "nobody") == 0
    assert manager.deliver("conv:not-a-uuid", "x") == 0
    assert manager.deliver("other:thing", "x") == 0

    manager.remove(a)
    assert manager.deliver(f"conv:{conv}", "m2") == 0
    assert manager.count == 1


async def test_a_slow_consumer_is_disconnected_instead_of_blocking() -> None:
    socket = FakeSocket()
    connection = Connection(socket, uuid.uuid4())  # type: ignore[arg-type]
    for n in range(QUEUE_SIZE + 5):
        connection.enqueue(f"f{n}")
    assert connection.overflowed
    await asyncio.wait_for(connection.run_writer(), 1)
    assert socket.closed == SLOW_CONSUMER_CODE


async def test_the_bridge_reconnects_after_losing_redis(redis_client: Redis) -> None:
    manager = ConnectionManager()
    socket = FakeSocket()
    user = uuid.uuid4()
    connection = Connection(socket, user)  # type: ignore[arg-type]
    manager.add(connection)
    bridge = RedisBridge(TEST_REDIS_URL, manager)
    await bridge.start()
    writer = asyncio.create_task(connection.run_writer())
    try:
        # Kill the subscriber's connection from the server side.
        killed = 0
        for info in await redis_client.client_list():
            if int(info.get("psub", 0)) > 0:
                killed += await redis_client.client_kill_filter(_id=info["id"])
        assert killed >= 1
        for _ in range(40):  # reconnects after its backoff
            await redis_client.publish(f"user:{user}", '{"type":"pong"}')
            await asyncio.sleep(0.1)
            if socket.sent:
                break
        assert socket.sent, "the bridge never came back"
    finally:
        writer.cancel()
        await bridge.stop()
