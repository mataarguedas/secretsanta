"""Invariant 2: anonymous-initiator secrecy (CLAUDE.md §2.2, PRD FR-CHT-3, §13.7).

U1 opens an anonymous thread with U2. Every chat endpoint is then called as U2 (the
recipient) and as U3 (another participant), including the error paths, and the raw
response text is searched for anything that identifies U1: user id, email, name and
avatar URL. The event has no group chat and U1 has no named thread with U2, so U1 has no
legitimate reason to appear in any of these responses.

The route list is discovered from the chat router: a new chat endpoint fails this test
until it's exercised here.

The WebSocket half does the same for every frame U2 and U3 receive (every server frame
type a chat can produce), and for every payload published on Redis while it runs.

TODO(prompt 25): the same check on the rendered `message` push payload for U2.
"""

import asyncio
import contextlib
import json
import uuid
from typing import Any

import httpx
from fastapi import FastAPI
from redis.asyncio import Redis
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api import chat as chat_api
from app.api.paths import API_PREFIX
from app.models import User
from app.realtime.channels import PATTERNS
from app.realtime.frames import SERVER_FRAME_TYPES
from tests.api.auth_helpers import CSRF, login_as
from tests.api.event_helpers import EVENTS, add_participant, create, user_id
from tests.conftest import TEST_REDIS_URL
from tests.ws import WsClient, cookie_header

U1 = ("beto.secreto@test.local", "Beto Secreto")  # the anonymous initiator
U2 = ("ana@test.local", "Ana")  # the recipient
U3 = ("carla@test.local", "Carla")  # another participant
U1_AVATAR = "https://lh3.googleusercontent.com/a/beto-secreto-avatar"

CHAT_ROUTES = {
    (method, route.path)
    for route in chat_api.router.routes
    for method in getattr(route, "methods", ())
}


class Recorder:
    """Calls the API and keeps every raw response, tagged with its route template."""

    def __init__(self, client: httpx.AsyncClient) -> None:
        self.client = client
        self.hit: set[tuple[str, str]] = set()
        self.responses: list[tuple[str, httpx.Response]] = []

    async def call(
        self, method: str, template: str, url: str, who: str, **kwargs: Any
    ) -> httpx.Response:
        headers = CSRF if method != "GET" else {}
        response = await self.client.request(method, API_PREFIX + url, headers=headers, **kwargs)
        self.hit.add((method, template))
        self.responses.append((f"{who} {method} {url} → {response.status_code}", response))
        return response


async def test_the_anonymous_initiator_never_leaves_the_backend(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    for person in (U2, U3, U1):
        await login_as(client, *person)
    u1 = await user_id(db, U1[0])
    u2 = await user_id(db, U2[0])
    u3 = await user_id(db, U3[0])
    async with db() as session:
        await session.execute(update(User).where(User.id == u1).values(avatar_url=U1_AVATAR))
        await session.commit()

    # U2 hosts (no group chat); U1 and U3 join.
    await login_as(client, *U2)
    event = await create(client, group_chat_enabled=False)
    for person in (U1, U3):
        await add_participant(db, event["id"], person[0])

    # U1 opens the anonymous thread, writes twice, deletes one.
    await login_as(client, *U1)
    started = await client.post(
        f"{EVENTS}/{event['id']}/conversations",
        json={"kind": "anonymous", "recipient_id": str(u2)},
        headers=CSRF,
    )
    assert started.status_code == 201, started.text
    anon_id = started.json()["id"]
    kept = await client.post(
        f"/api/v1/conversations/{anon_id}/messages", json={"body": "¿Talla?"}, headers=CSRF
    )
    removed = await client.post(
        f"/api/v1/conversations/{anon_id}/messages", json={"body": "Ups"}, headers=CSRF
    )
    u1_message = kept.json()["id"]
    await client.delete(f"/api/v1/messages/{removed.json()['id']}", headers=CSRF)

    rec = Recorder(client)

    # ── As U2, the recipient ─────────────────────────────────────────────────
    await login_as(client, *U2)
    listing = await rec.call("GET", "/conversations", "/conversations", "U2")
    assert [c["id"] for c in listing.json()["items"]] == [anon_id]
    await rec.call("GET", "/conversations", f"/conversations?event_id={event['id']}", "U2")
    detail = await rec.call(
        "GET", "/conversations/{conversation_id}", f"/conversations/{anon_id}", "U2"
    )
    alias = detail.json()["title_member"]
    assert alias["is_anonymous"] is True
    assert alias["display_name"] == f"Secret Elf #{alias['anon_number']}"
    assert alias["avatar_url"] is None
    await rec.call(
        "GET",
        "/conversations/{conversation_id}/messages",
        f"/conversations/{anon_id}/messages",
        "U2",
    )
    reply = await rec.call(
        "POST",
        "/conversations/{conversation_id}/messages",
        f"/conversations/{anon_id}/messages",
        "U2",
        json={"body": "Mediana"},
    )
    assert reply.status_code == 201
    await rec.call(
        "POST", "/conversations/{conversation_id}/read", f"/conversations/{anon_id}/read", "U2"
    )
    await rec.call("DELETE", "/messages/{message_id}", f"/messages/{reply.json()['id']}", "U2")
    # Error paths: U1's message, and starting threads (a named one with U3; and with U1,
    # whose id U2 could only have guessed: the response must not confirm anything).
    refused = await rec.call("DELETE", "/messages/{message_id}", f"/messages/{u1_message}", "U2")
    assert refused.status_code == 404
    await rec.call(
        "POST",
        "/events/{event_id}/conversations",
        f"/events/{event['id']}/conversations",
        "U2",
        json={"kind": "direct", "recipient_id": str(u3)},
    )
    await rec.call(
        "POST",
        "/events/{event_id}/conversations",
        f"/events/{event['id']}/conversations",
        "U2",
        json={"kind": "anonymous", "recipient_id": str(uuid.uuid4())},
    )
    await rec.call(
        "GET",
        "/conversations/{conversation_id}/messages",
        f"/conversations/{anon_id}/messages?cursor=not-a-cursor",
        "U2",
    )

    # ── As U3, a participant outside the thread ──────────────────────────────
    await login_as(client, *U3)
    await rec.call("GET", "/conversations", "/conversations", "U3")
    for method, template, url in (
        ("GET", "/conversations/{conversation_id}", f"/conversations/{anon_id}"),
        (
            "GET",
            "/conversations/{conversation_id}/messages",
            f"/conversations/{anon_id}/messages",
        ),
        (
            "POST",
            "/conversations/{conversation_id}/messages",
            f"/conversations/{anon_id}/messages",
        ),
        ("POST", "/conversations/{conversation_id}/read", f"/conversations/{anon_id}/read"),
        ("DELETE", "/messages/{message_id}", f"/messages/{u1_message}"),
    ):
        kwargs: dict[str, Any] = (
            {"json": {"body": "hola"}} if template.endswith("messages") and method == "POST" else {}
        )
        response = await rec.call(method, template, url, "U3", **kwargs)
        assert response.status_code == 404, (template, response.text)

    missing = CHAT_ROUTES - rec.hit
    assert not missing, f"chat routes not exercised by the anonymity test: {sorted(missing)}"

    for label, response in rec.responses:
        assert_no_trace_of_u1(label, response.text, u1)


def assert_no_trace_of_u1(label: str, text: str, u1: uuid.UUID) -> None:
    secrets = {
        "user id": str(u1),
        "user id (hex)": u1.hex,
        "email": U1[0],
        "name": U1[1],
        "first name": U1[1].split()[0],
        "avatar": U1_AVATAR,
    }
    for what, value in secrets.items():
        assert value.lower() not in text.lower(), f"{label} leaks U1's {what}: {text}"


async def setup_people(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> tuple[dict[str, Any], dict[str, str], dict[str, uuid.UUID]]:
    """U2 hosts U1 and U3 (no group chat). Returns the event, cookies and ids by email."""
    cookies: dict[str, str] = {}
    for person in (U3, U1, U2):
        await login_as(client, *person)
        cookies[person[0]] = cookie_header(client)
    ids = {person[0]: await user_id(db, person[0]) for person in (U1, U2, U3)}
    async with db() as session:
        await session.execute(
            update(User).where(User.id == ids[U1[0]]).values(avatar_url=U1_AVATAR)
        )
        await session.commit()
    event = await create(client, group_chat_enabled=False)
    for person in (U1, U3):
        await add_participant(db, event["id"], person[0])
    return event, cookies, ids


async def test_no_websocket_frame_or_redis_payload_names_the_initiator(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession], app: FastAPI
) -> None:
    event, cookies, ids = await setup_people(client, db)
    u1 = ids[U1[0]]

    published: list[str] = []
    listener = Redis.from_url(TEST_REDIS_URL, decode_responses=True)
    pubsub = listener.pubsub(ignore_subscribe_messages=True)
    await pubsub.psubscribe(*PATTERNS)

    async def capture() -> None:
        async for message in pubsub.listen():
            published.append(f"{message['channel']} {message['data']}")

    capturing = asyncio.create_task(capture())
    u2 = await WsClient(app, cookies=cookies[U2[0]]).connect()
    u3 = await WsClient(app, cookies=cookies[U3[0]]).connect()
    u1_ws = await WsClient(app, cookies=cookies[U1[0]]).connect()
    try:
        # U1 opens the thread (REST) and writes over both paths; U2 hears of it only now.
        started = await client.post(
            f"{EVENTS}/{event['id']}/conversations",
            json={"kind": "anonymous", "recipient_id": str(ids[U2[0]])},
            headers={**CSRF, "cookie": cookies[U1[0]]},
        )
        anon = started.json()["id"]
        await u1_ws.send_json({"type": "subscribe", "conversation_ids": [anon]})
        await u1_ws.send_json(
            {"type": "send", "conversation_id": anon, "body": "¿Talla?", "client_id": "a"}
        )
        await u1_ws.receive_until("ack")
        announced = await u2.receive_until("conversation_created")
        assert announced == {"type": "conversation_created", "conversation_id": anon}

        # Both U2 and U3 try to follow it; only U2 may.
        for ws in (u2, u3):
            await ws.send_json({"type": "subscribe", "conversation_ids": [anon]})
            await ws.ping()
        rest = await client.post(
            f"{API_PREFIX}/conversations/{anon}/messages",
            json={"body": "Ups"},
            headers={**CSRF, "cookie": cookies[U1[0]]},
        )
        await u2.receive_until("message")
        await client.delete(
            f"{API_PREFIX}/messages/{rest.json()['id']}",
            headers={**CSRF, "cookie": cookies[U1[0]]},
        )
        await u2.receive_until("message_deleted")

        # U2 replies, marks it active, and trips an error.
        await u2.send_json(
            {"type": "send", "conversation_id": anon, "body": "Mediana", "client_id": "b"}
        )
        await u2.receive_until("ack")
        await u2.send_json({"type": "active", "conversation_id": anon})
        await u2.send_json(
            {"type": "send", "conversation_id": anon, "body": " ", "client_id": "bad"}
        )
        await u2.receive_until("error")
        await u2.ping()
        await u3.ping()
        await asyncio.sleep(0.2)  # let the capture task see the last publishes
        await u2.drain(0.1)
        await u3.drain(0.1)
    finally:
        for ws in (u1_ws, u2, u3):
            await ws.close()
        capturing.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await capturing
        await pubsub.aclose()  # type: ignore[no-untyped-call]
        await listener.aclose()

    u2_types = {frame["type"] for frame in u2.frames}
    assert u2_types >= {"conversation_created", "message", "message_deleted", "ack", "error"}
    assert u2_types <= SERVER_FRAME_TYPES
    assert {frame["type"] for frame in u3.frames} == {"pong"}  # nothing from the thread
    assert published, "expected the Redis payloads to be captured"

    for who, ws in (("U2", u2), ("U3", u3)):
        for frame in ws.frames:
            assert_no_trace_of_u1(f"{who} frame {frame['type']}", json.dumps(frame), u1)
    for payload in published:
        # U1 may receive on their own user:{id} channel, but no payload names them.
        channel, _, data = payload.partition(" ")
        assert_no_trace_of_u1(f"Redis {channel.split(':')[0]}", data, u1)
        if channel.startswith("conv:"):
            assert str(u1) not in channel
