"""Invariant 6 — an ARCHIVED event is read-only for everything in it (CLAUDE.md §2.6,
PRD §3, FR-WSH-6, FR-CHT-7).

The mutating routes (POST/PUT/PATCH/DELETE) are **discovered from the app** (its OpenAPI
schema, FastAPI's public view of every route; nothing in ``app/`` may opt out of it), not
listed by hand: a new route fails this test until it either refuses an archived event or is added,
with a reason, to ``NOT_EVENT_SCOPED``. Each one is called, with a valid request, against
the resources of an event archived through the real endpoint, and must answer 409 and
change nothing. The WebSocket ``send`` frame is covered too, and every GET keeps working.
"""

import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Final

import httpx
from fastapi import FastAPI
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.paths import API_PREFIX
from app.models import (
    Conversation,
    ConversationMember,
    Event,
    EventParticipant,
    Exclusion,
    Message,
    WishlistItem,
    WishlistPhoto,
)
from tests import images
from tests.api.auth_helpers import CSRF, login_as
from tests.api.event_helpers import EVENTS, create
from tests.invariants.drawn import ANA, OUTSIDER, PEOPLE, DrawnEvent, drawn_event
from tests.ws import WsClient, cookie_header

BETO, CARLA = PEOPLE[1], PEOPLE[2]

# Mutating routes that don't act on an event's contents, so archiving can't apply to them.
# Each entry covers that path and everything below it.
NOT_EVENT_SCOPED: Final[dict[str, str]] = {
    f"{API_PREFIX}/auth": "sign-in, refresh and logout are about the session",
    f"{API_PREFIX}/me": "the user's own profile and account (deletion rules: Prompt 28)",
    f"{API_PREFIX}/push": "the user's devices",
    f"{API_PREFIX}/test": "test-only login, mounted only when ENV=test",
}
# Creating an event makes a new one; it can't touch an archived event.
NOT_EVENT_SCOPED_EXACT: Final = {("POST", f"{API_PREFIX}/events")}

# The refusal each route gives. Default: EVENT_ARCHIVED.
# - Roster changes (join, leave, remove, exclusions, the draw) keep the frozen-roster code
#   EVENT_ALREADY_DRAWN in both states (CLAUDE.md §2.3).
# - Chat routes addressed by conversation or message say CONVERSATION_READ_ONLY.
ROSTER: Final = "EVENT_ALREADY_DRAWN"
CHAT: Final = "CONVERSATION_READ_ONLY"
EXPECTED_CODE: Final[dict[tuple[str, str], str]] = {
    ("POST", "/invites/{token}/join"): ROSTER,
    ("POST", "/events/{event_id}/leave"): ROSTER,
    ("DELETE", "/events/{event_id}/participants/{user_id}"): ROSTER,
    ("POST", "/events/{event_id}/exclusions"): ROSTER,
    ("DELETE", "/events/{event_id}/exclusions/{exclusion_id}"): ROSTER,
    ("POST", "/events/{event_id}/draw"): ROSTER,
    ("POST", "/conversations/{conversation_id}/messages"): CHAT,
    ("POST", "/conversations/{conversation_id}/read"): CHAT,
    ("DELETE", "/messages/{message_id}"): CHAT,
}

# A valid request body per route, so a 409 can't be a validation error in disguise.
PNG: Final = {"file": ("a.png", images.small_png(), "image/png")}


@dataclass
class Archived:
    drawn: DrawnEvent
    other_event_id: str  # another event of Ana's, the source for copy-from
    item_id: uuid.UUID  # Ana's wishlist item, with one photo
    photo_id: uuid.UUID
    direct_id: str  # Ana ↔ Beto
    message_id: str  # Ana's message in the group chat

    @property
    def params(self) -> dict[str, str]:
        d = self.drawn
        return {
            "event_id": d.id,
            "token": d.invite_token,
            "user_id": str(d.ids[CARLA[0]]),
            "exclusion_id": d.exclusion_id,
            "item_id": str(self.item_id),
            "photo_id": str(self.photo_id),
            "other_event_id": self.other_event_id,
            "conversation_id": self.direct_id,
            "message_id": self.message_id,
        }


def requests_for(archived: Archived) -> dict[tuple[str, str], dict[str, Any]]:
    """httpx keyword arguments per route (method, path without the prefix)."""
    d = archived.drawn
    beto, carla = str(d.ids[BETO[0]]), str(d.ids[CARLA[0]])
    return {
        ("PATCH", "/events/{event_id}"): {"json": {"description": "x"}},
        ("POST", "/events/{event_id}/exclusions"): {"json": {"user_ids": [beto, carla]}},
        ("POST", "/events/{event_id}/cover"): {"files": PNG},
        ("POST", "/wishlist/items/{item_id}/photos"): {"files": PNG},
        ("POST", "/events/{event_id}/wishlist/items"): {"json": {"title": "x"}},
        ("PATCH", "/events/{event_id}/wishlist/items/{item_id}"): {"json": {"title": "y"}},
        ("PUT", "/events/{event_id}/wishlist/order"): {
            "json": {"item_ids": [str(archived.item_id)]}
        },
        ("POST", "/events/{event_id}/conversations"): {
            "json": {"kind": "anonymous", "recipient_id": carla}
        },
        ("POST", "/conversations/{conversation_id}/messages"): {"json": {"body": "hola"}},
    }


def is_event_scoped(method: str, path: str) -> bool:
    if (method, path) in NOT_EVENT_SCOPED_EXACT:
        return False
    return not any(path == base or path.startswith(f"{base}/") for base in NOT_EVENT_SCOPED)


MUTATING: Final = ("post", "put", "patch", "delete")


def mutating_routes(app: FastAPI) -> list[tuple[str, str]]:
    paths: dict[str, dict[str, Any]] = app.openapi()["paths"]
    found = [
        (method.upper(), path)
        for path, operations in paths.items()
        for method in operations
        if method in MUTATING
    ]
    return sorted(found, key=lambda r: (r[1], r[0]))


# ── Setup ────────────────────────────────────────────────────────────────────


async def archived_event(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> Archived:
    """The shared drawn event, filled with one of everything, then archived by the host."""
    drawn = await drawn_event(client, db)  # Ana is signed in
    e = f"{EVENTS}/{drawn.id}"
    other = await create(client, name="Otro evento")

    item = await client.post(f"{e}/wishlist/items", json={"title": "Libro"}, headers=CSRF)
    assert item.status_code == 201, item.text
    item_id = uuid.UUID(item.json()["id"])
    photo_id = uuid.uuid4()
    async with db() as session:  # a stored photo row is enough: no image is processed
        session.add(
            WishlistPhoto(
                id=photo_id,
                item_id=item_id,
                object_key=f"events/{drawn.id}/items/{item_id}/p.webp",
                thumb_key=f"events/{drawn.id}/items/{item_id}/p_thumb.webp",
                width=10,
                height=10,
                position=0,
            )
        )
        await session.commit()

    direct = await client.post(
        f"{e}/conversations",
        json={"kind": "direct", "recipient_id": str(drawn.ids[BETO[0]])},
        headers=CSRF,
    )
    assert direct.status_code == 201, direct.text
    message = await client.post(
        f"/api/v1/conversations/{drawn.group_conversation_id}/messages",
        json={"body": "hola"},
        headers=CSRF,
    )
    assert message.status_code == 201, message.text

    # The exchange is over: the host archives through the real endpoint.
    async with db() as session:
        await session.execute(
            update(Event)
            .where(Event.id == uuid.UUID(drawn.id))
            .values(exchange_at=datetime.now(UTC) - timedelta(days=1))
        )
        await session.commit()
    archived = await client.post(f"{e}/archive", headers=CSRF)
    assert archived.status_code == 200, archived.text
    assert archived.json()["state"] == "archived"

    return Archived(
        drawn=drawn,
        other_event_id=str(other["id"]),
        item_id=item_id,
        photo_id=photo_id,
        direct_id=direct.json()["id"],
        message_id=message.json()["id"],
    )


async def snapshot(db: async_sessionmaker[AsyncSession], event_id: str) -> dict[str, Any]:
    """Everything a refused write could have changed."""
    eid = uuid.UUID(event_id)
    conversations = select(Conversation.id).where(Conversation.event_id == eid)

    async def count(model: Any, *where: Any) -> int:
        async with db() as session:
            return (
                await session.scalar(select(func.count()).select_from(model).where(*where))
            ) or 0

    async with db() as session:
        event = await session.get(Event, eid)
        assert event is not None
        row = {
            f: getattr(event, f)
            for f in (
                "state",
                "archived_at",
                "description",
                "invite_token",
                "cover_photo_key",
                "updated_at",
            )
        }
        items = (
            await session.execute(
                select(WishlistItem.id, WishlistItem.title, WishlistItem.position).where(
                    WishlistItem.event_id == eid
                )
            )
        ).all()
        messages = (
            await session.execute(
                select(Message.id, Message.body, Message.deleted_at).where(
                    Message.conversation_id.in_(conversations)
                )
            )
        ).all()
        reads = (
            await session.scalars(
                select(ConversationMember.last_read_at).where(
                    ConversationMember.conversation_id.in_(conversations)
                )
            )
        ).all()
    return {
        "event": row,
        "items": sorted(items),
        "messages": sorted(messages),
        "reads": sorted(str(r) for r in reads),
        "participants": await count(EventParticipant, EventParticipant.event_id == eid),
        "exclusions": await count(Exclusion, Exclusion.event_id == eid),
        "conversations": await count(Conversation, Conversation.event_id == eid),
        "photos": await count(
            WishlistPhoto,
            WishlistPhoto.item_id.in_(select(WishlistItem.id).where(WishlistItem.event_id == eid)),
        ),
    }


# ── Tests ────────────────────────────────────────────────────────────────────


def test_no_route_hides_from_discovery() -> None:
    """A route left out of the schema would also be left out of this test."""
    app_dir = Path(__file__).resolve().parents[2] / "app"
    hidden = [
        str(f.relative_to(app_dir))
        for f in app_dir.rglob("*.py")
        if "include_in_schema=False" in f.read_text(encoding="utf-8")
    ]
    assert hidden == []


def test_the_allowlist_holds_no_event_scoped_route(app: FastAPI) -> None:
    """Nothing addressed by an event, conversation, message or item hides in the allowlist."""
    scoped_param = re.compile(r"\{(event_id|conversation_id|message_id|item_id|token)\}")
    for method, path in mutating_routes(app):
        if not is_event_scoped(method, path):
            assert not scoped_param.search(path), f"{method} {path} is event-scoped"


async def test_every_mutating_route_refuses_an_archived_event(
    app: FastAPI, client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    archived = await archived_event(client, db)
    params = archived.params
    bodies = requests_for(archived)
    before = await snapshot(db, archived.drawn.id)

    checked: list[str] = []
    for method, full_path in mutating_routes(app):
        if not is_event_scoped(method, full_path):
            continue
        path = full_path.removeprefix(API_PREFIX)
        missing = set(re.findall(r"\{(\w+)\}", path)) - params.keys()
        assert not missing, f"{method} {path}: add a resource for {missing} to Archived"
        url = full_path.format(**params)

        # Joining is for someone outside the event; everything else as the host, who is
        # also a participant and owns the item, the photo and the message.
        who = OUTSIDER if path == "/invites/{token}/join" else ANA
        await login_as(client, *who)
        response = await client.request(method, url, headers=CSRF, **bodies.get((method, path), {}))

        label = f"{method} {path}"
        expected = EXPECTED_CODE.get((method, path), "EVENT_ARCHIVED")
        assert response.status_code == 409, f"{label}: {response.status_code} {response.text}"
        assert response.json()["error"]["code"] == expected, f"{label}: {response.text}"
        checked.append(label)

    # Discovery really found the event's routes (a sanity floor, not the list itself).
    assert len(checked) >= 20, checked
    assert "POST /events/{event_id}/archive" in checked  # archiving twice is refused too
    assert await snapshot(db, archived.drawn.id) == before


async def test_the_websocket_send_frame_is_refused(
    app: FastAPI, client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    archived = await archived_event(client, db)
    before = await snapshot(db, archived.drawn.id)
    await login_as(client, *ANA)
    async with WsClient(app, cookies=cookie_header(client)) as ws:
        for conversation_id in (archived.direct_id, str(archived.drawn.group_conversation_id)):
            await ws.send_json(
                {
                    "type": "send",
                    "conversation_id": conversation_id,
                    "body": "hola",
                    "client_id": conversation_id,
                }
            )
            assert await ws.receive_until("error") == {
                "type": "error",
                "client_id": conversation_id,
                "code": "CONVERSATION_READ_ONLY",
            }
    assert await snapshot(db, archived.drawn.id) == before


async def test_every_read_still_works(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    archived = await archived_event(client, db)
    d = archived.drawn
    e = f"{EVENTS}/{d.id}"
    for person in PEOPLE:
        await login_as(client, *person)
        me = d.ids[person[0]]
        detail = await client.get(e)
        assert detail.status_code == 200
        body = detail.json()
        assert body["state"] == "archived"
        assert body["archived_at"] is not None
        # Still only their own receiver (CLAUDE.md §2.1).
        assert body["my_assignment"]["receiver"]["user_id"] == str(d.receiver_of[me])
        for url in (
            f"{e}/participants",
            f"{e}/wishlists/{d.ids[ANA[0]]}",
            f"/api/v1/conversations/{d.group_conversation_id}",
            f"/api/v1/conversations/{d.group_conversation_id}/messages",
            f"/api/v1/conversations?event_id={d.id}",
        ):
            assert (await client.get(url)).status_code == 200, url
    await login_as(client, *ANA)
    for url in (f"{e}/exclusions", f"/api/v1/conversations/{archived.direct_id}/messages"):
        assert (await client.get(url)).status_code == 200, url
    past = (await client.get(EVENTS, params={"section": "past"})).json()["items"]
    assert [event["id"] for event in past] == [d.id]
