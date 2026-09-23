"""Events API: create, dashboard sections, detail, edit and delete (Prompt 9)."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import Event, EventParticipant, User
from tests.api.auth_helpers import CSRF, login_as

EVENTS = "/api/v1/events"

ANA = ("ana@test.local", "Ana")
BETO = ("beto@test.local", "Beto")
CARLA = ("carla@test.local", "Carla")


def future(days: float = 30) -> str:
    return (datetime.now(UTC) + timedelta(days=days)).isoformat()


def valid_event(**overrides: Any) -> dict[str, Any]:
    return {"name": "Oficina 2026", "budget_crc": 25000, "exchange_at": future(), **overrides}


async def create(client: httpx.AsyncClient, **overrides: Any) -> dict[str, Any]:
    response = await client.post(EVENTS, json=valid_event(**overrides), headers=CSRF)
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


async def user_id(db: async_sessionmaker[AsyncSession], email: str) -> uuid.UUID:
    async with db() as session:
        found = await session.scalar(select(User.id).where(User.email == email))
    assert found is not None
    return found


async def add_participant(db: async_sessionmaker[AsyncSession], event_id: str, email: str) -> None:
    uid = await user_id(db, email)
    async with db() as session:
        session.add(EventParticipant(event_id=uuid.UUID(event_id), user_id=uid))
        await session.commit()


async def set_state(db: async_sessionmaker[AsyncSession], event_id: str, state: str) -> None:
    async with db() as session:
        await session.execute(
            update(Event).where(Event.id == uuid.UUID(event_id)).values(state=state)
        )
        await session.commit()


def error_code(response: httpx.Response) -> str:
    code: str = response.json()["error"]["code"]
    return code


# ── Create ───────────────────────────────────────────────────────────────────


async def test_create_returns_the_host_view(client: httpx.AsyncClient) -> None:
    await login_as(client, *ANA)
    body = await create(client, description="  Intercambio de oficina  ", location="San José")
    assert body["name"] == "Oficina 2026"
    assert body["description"] == "Intercambio de oficina"  # trimmed
    assert body["budget_crc"] == 25000
    assert body["state"] == "open"
    assert body["my_role"] == "host"
    assert body["participant_count"] == 1
    assert body["my_assignment"] is None
    assert body["group_chat_enabled"] is True
    assert body["is_online"] is False
    assert body["host"]["name"] == "Ana"
    assert set(body["host"]) == {"id", "name", "avatar_url"}  # never the email
    assert len(body["invite_token"]) >= 43  # 32 random bytes, URL-safe


async def test_creator_is_host_and_participant(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    await login_as(client, *ANA)
    body = await create(client)
    ana = await user_id(db, ANA[0])
    async with db() as session:
        event = await session.get(Event, uuid.UUID(body["id"]))
        members = (
            await session.scalars(
                select(EventParticipant.user_id).where(
                    EventParticipant.event_id == uuid.UUID(body["id"])
                )
            )
        ).all()
    assert event is not None
    assert event.host_id == ana
    assert members == [ana]


async def test_invite_tokens_are_unique(client: httpx.AsyncClient) -> None:
    await login_as(client, *ANA)
    tokens = {(await create(client))["invite_token"] for _ in range(3)}
    assert len(tokens) == 3


async def test_blank_optional_text_becomes_null(client: httpx.AsyncClient) -> None:
    await login_as(client, *ANA)
    body = await create(client, description="   ", location="")
    assert body["description"] is None
    assert body["location"] is None


async def test_online_event_and_join_deadline(client: httpx.AsyncClient) -> None:
    await login_as(client, *ANA)
    body = await create(
        client,
        is_online=True,
        join_deadline=future(10),
        exchange_at=future(20),
        group_chat_enabled=False,
    )
    assert body["is_online"] is True
    assert body["location"] is None
    assert body["group_chat_enabled"] is False
    assert body["join_deadline"] is not None


@pytest.mark.parametrize(
    ("case", "overrides"),
    [
        ("name too short", {"name": "ab"}),
        ("name too short after trimming", {"name": "   ab   "}),
        ("name too long", {"name": "x" * 81}),
        ("name missing", {"name": None}),
        ("description too long", {"description": "x" * 1001}),
        ("budget negative", {"budget_crc": -1}),
        ("budget not an integer", {"budget_crc": 1.5}),
        ("budget as a string", {"budget_crc": "25000"}),
        ("budget absurdly large", {"budget_crc": 3_000_000_000}),
        ("budget missing", {"budget_crc": None}),
        ("exchange in the past", {"exchange_at": future(-1)}),
        ("exchange without a timezone", {"exchange_at": "2099-12-20T19:00:00"}),
        ("exchange missing", {"exchange_at": None}),
        ("deadline equal to exchange", {"exchange_at": future(5), "join_deadline": future(5)}),
        ("deadline after exchange", {"exchange_at": future(5), "join_deadline": future(6)}),
        ("location and online", {"location": "San José", "is_online": True}),
        ("location too long", {"location": "x" * 201}),
        ("online not a boolean", {"is_online": "yes"}),
        ("state is not client-settable", {"state": "drawn"}),
        ("invite token is not client-settable", {"invite_token": "mine"}),
        ("host is not client-settable", {"host_id": str(uuid.uuid4())}),
    ],
)
async def test_create_validation(
    client: httpx.AsyncClient, case: str, overrides: dict[str, Any]
) -> None:
    await login_as(client, *ANA)
    payload = {k: v for k, v in valid_event(**overrides).items() if v is not None}
    if case == "deadline equal to exchange":
        payload["join_deadline"] = payload["exchange_at"]
    response = await client.post(EVENTS, json=payload, headers=CSRF)
    assert response.status_code == 422, case
    assert error_code(response) == "VALIDATION_ERROR"
    assert "Traceback" not in response.text


async def test_create_requires_a_session(client: httpx.AsyncClient) -> None:
    response = await client.post(EVENTS, json=valid_event(), headers=CSRF)
    assert response.status_code == 401
    assert error_code(response) == "AUTH_REQUIRED"


# ── Dashboard sections and pagination ────────────────────────────────────────


async def test_sections_filter_by_role_and_state(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    await login_as(client, *CARLA)
    await login_as(client, *BETO)
    beto_event = await create(client, name="Familia Beto", exchange_at=future(5))
    await login_as(client, *ANA)
    later = await create(client, name="Ana later", exchange_at=future(40))
    sooner = await create(client, name="Ana sooner", exchange_at=future(10))
    archived = await create(client, name="Ana archived")
    await set_state(db, archived["id"], "archived")
    await add_participant(db, beto_event["id"], ANA[0])
    await add_participant(db, beto_event["id"], CARLA[0])

    async def section(name: str) -> list[dict[str, Any]]:
        response = await client.get(EVENTS, params={"section": name})
        assert response.status_code == 200
        assert response.json()["next_cursor"] is None
        items: list[dict[str, Any]] = response.json()["items"]
        return items

    hosting = await section("hosting")
    assert [e["id"] for e in hosting] == [sooner["id"], later["id"]]  # soonest first
    assert all(e["is_host"] for e in hosting)
    assert set(hosting[0]) == {
        "id",
        "name",
        "state",
        "participant_count",
        "exchange_at",
        "budget_crc",
        "is_host",
    }

    participating = await section("participating")
    assert [e["id"] for e in participating] == [beto_event["id"]]
    assert participating[0]["is_host"] is False
    assert participating[0]["participant_count"] == 3

    past = await section("past")
    assert [e["id"] for e in past] == [archived["id"]]
    assert past[0]["state"] == "archived"
    assert past[0]["is_host"] is True

    await login_as(client, *BETO)
    assert [e["id"] for e in await section("hosting")] == [beto_event["id"]]
    assert await section("participating") == []
    assert await section("past") == []  # not a participant of Ana's archived event


async def test_archived_participation_shows_in_past(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    await login_as(client, *ANA)
    await login_as(client, *BETO)
    event = await create(client)
    await add_participant(db, event["id"], ANA[0])
    await set_state(db, event["id"], "archived")
    await login_as(client, *ANA)
    past = (await client.get(EVENTS, params={"section": "past"})).json()["items"]
    assert [(e["id"], e["is_host"]) for e in past] == [(event["id"], False)]
    participating = (await client.get(EVENTS, params={"section": "participating"})).json()
    assert participating["items"] == []


async def _seed_events(db: async_sessionmaker[AsyncSession], host_email: str, n: int) -> None:
    host = await user_id(db, host_email)
    base = datetime.now(UTC) + timedelta(days=1)
    async with db() as session:
        for i in range(n):
            # Pairs share a timestamp, so the id tiebreaker is exercised.
            event = Event(
                host_id=host,
                name=f"Evento {i:02d}",
                budget_crc=i,
                exchange_at=base + timedelta(hours=i // 2),
            )
            session.add(event)
            await session.flush()
            session.add(EventParticipant(event_id=event.id, user_id=host))
        await session.commit()


@pytest.mark.parametrize("section", ["hosting", "past"])
async def test_cursor_pagination_walks_every_event_once(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession], section: str
) -> None:
    await login_as(client, *ANA)
    await _seed_events(db, ANA[0], 45)
    if section == "past":
        async with db() as session:
            await session.execute(update(Event).values(state="archived"))
            await session.commit()

    seen: list[dict[str, Any]] = []
    sizes: list[int] = []
    cursor: str | None = None
    while True:
        params = {"section": section, **({"cursor": cursor} if cursor else {})}
        body = (await client.get(EVENTS, params=params)).json()
        sizes.append(len(body["items"]))
        seen.extend(body["items"])
        cursor = body["next_cursor"]
        if cursor is None:
            break

    assert sizes == [20, 20, 5]
    assert len({e["id"] for e in seen}) == 45
    keys = [(e["exchange_at"], e["id"]) for e in seen]
    assert keys == sorted(keys, reverse=section == "past")


async def test_exactly_one_full_page_has_no_next_cursor(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    await login_as(client, *ANA)
    await _seed_events(db, ANA[0], 20)
    body = (await client.get(EVENTS, params={"section": "hosting"})).json()
    assert len(body["items"]) == 20
    assert body["next_cursor"] is None


@pytest.mark.parametrize(
    "params",
    [
        {},
        {"section": "all"},
        {"section": "hosting", "cursor": "not-a-cursor"},
        {"section": "hosting", "cursor": "W10"},  # base64 of []
        {"section": "hosting", "cursor": "x" * 201},
    ],
)
async def test_list_validation(client: httpx.AsyncClient, params: dict[str, str]) -> None:
    await login_as(client, *ANA)
    response = await client.get(EVENTS, params=params)
    assert response.status_code == 422
    assert error_code(response) == "VALIDATION_ERROR"


async def test_list_requires_a_session(client: httpx.AsyncClient) -> None:
    assert (await client.get(EVENTS, params={"section": "hosting"})).status_code == 401


# ── Detail and authorization ─────────────────────────────────────────────────


async def test_non_participant_gets_404_like_a_missing_event(client: httpx.AsyncClient) -> None:
    await login_as(client, *ANA)
    event = await create(client)
    await login_as(client, *BETO)
    hidden = await client.get(f"{EVENTS}/{event['id']}")
    missing = await client.get(f"{EVENTS}/{uuid.uuid4()}")
    assert hidden.status_code == missing.status_code == 404
    assert hidden.json() == missing.json()
    assert error_code(hidden) == "EVENT_NOT_FOUND"
    assert "Oficina" not in hidden.text


async def test_participant_view_hides_the_invite_token(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    await login_as(client, *BETO)
    await login_as(client, *ANA)
    event = await create(client)
    await add_participant(db, event["id"], BETO[0])

    await login_as(client, *BETO)
    response = await client.get(f"{EVENTS}/{event['id']}")
    assert response.status_code == 200
    body = response.json()
    assert "invite_token" not in body
    assert event["invite_token"] not in response.text
    assert body["my_role"] == "participant"
    assert body["participant_count"] == 2
    assert body["host"]["name"] == "Ana"
    assert "ana@test.local" not in response.text
    assert body["my_assignment"] is None

    await login_as(client, *ANA)
    host_view = (await client.get(f"{EVENTS}/{event['id']}")).json()
    assert host_view["invite_token"] == event["invite_token"]
    assert host_view["my_role"] == "host"


async def test_host_sees_a_disabled_link_as_null(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    await login_as(client, *ANA)
    event = await create(client)
    async with db() as session:
        await session.execute(
            update(Event).where(Event.id == uuid.UUID(event["id"])).values(invite_token=None)
        )
        await session.commit()
    body = (await client.get(f"{EVENTS}/{event['id']}")).json()
    assert "invite_token" in body
    assert body["invite_token"] is None


async def test_non_host_patch_and_delete_get_403(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    await login_as(client, *BETO)
    await login_as(client, *ANA)
    event = await create(client)
    await add_participant(db, event["id"], BETO[0])
    await login_as(client, *BETO)

    patch = await client.patch(f"{EVENTS}/{event['id']}", json={"name": "Mío"}, headers=CSRF)
    assert patch.status_code == 403
    assert error_code(patch) == "HOST_ONLY"
    delete = await client.delete(f"{EVENTS}/{event['id']}", headers=CSRF)
    assert delete.status_code == 403
    assert error_code(delete) == "HOST_ONLY"

    # Even when the state would also refuse it, a non-host learns only "host only".
    await set_state(db, event["id"], "drawn")
    delete = await client.delete(f"{EVENTS}/{event['id']}", headers=CSRF)
    assert error_code(delete) == "HOST_ONLY"


async def test_non_participant_patch_and_delete_get_404(client: httpx.AsyncClient) -> None:
    await login_as(client, *ANA)
    event = await create(client)
    await login_as(client, *BETO)
    patch = await client.patch(f"{EVENTS}/{event['id']}", json={"name": "Mío"}, headers=CSRF)
    delete = await client.delete(f"{EVENTS}/{event['id']}", headers=CSRF)
    assert patch.status_code == delete.status_code == 404
    assert error_code(patch) == error_code(delete) == "EVENT_NOT_FOUND"


async def test_mutations_require_the_csrf_header(client: httpx.AsyncClient) -> None:
    await login_as(client, *ANA)
    event = await create(client)
    assert (await client.patch(f"{EVENTS}/{event['id']}", json={"name": "Otro"})).status_code == 403
    assert (await client.delete(f"{EVENTS}/{event['id']}")).status_code == 403


# ── Edit and field locking ───────────────────────────────────────────────────


async def test_open_event_every_field_can_change(client: httpx.AsyncClient) -> None:
    await login_as(client, *ANA)
    event = await create(client, location="San José")
    changes = {
        "name": "Oficina Navidad",
        "description": "Traer algo hecho a mano",
        "budget_crc": 30000,
        "exchange_at": future(60),
        "join_deadline": future(50),
        "location": None,
        "is_online": True,
        "group_chat_enabled": False,
    }
    response = await client.patch(f"{EVENTS}/{event['id']}", json=changes, headers=CSRF)
    assert response.status_code == 200, response.text
    body = response.json()
    for field in ("name", "description", "budget_crc", "location", "is_online"):
        assert body[field] == changes[field]
    assert body["group_chat_enabled"] is False
    assert datetime.fromisoformat(body["exchange_at"]) == datetime.fromisoformat(
        changes["exchange_at"]
    )
    assert body["invite_token"] == event["invite_token"]
    assert (await client.get(f"{EVENTS}/{event['id']}")).json() == body


async def test_drawn_event_locks_all_but_four_fields(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    await login_as(client, *ANA)
    event = await create(client)
    await set_state(db, event["id"], "drawn")
    url = f"{EVENTS}/{event['id']}"

    for locked in (
        {"budget_crc": 1},
        {"name": "Otro nombre"},
        {"join_deadline": future(1)},
        {"group_chat_enabled": False},
        {"description": "ok", "budget_crc": 1},  # one locked field sinks the whole edit
    ):
        response = await client.patch(url, json=locked, headers=CSRF)
        assert response.status_code == 409, locked
        assert error_code(response) == "EVENT_FIELD_LOCKED"

    allowed = {
        "description": "ok",
        "location": "Heredia",
        "exchange_at": future(45),
        # Unchanged values of locked fields are accepted (a form can resend them).
        "budget_crc": event["budget_crc"],
        "name": event["name"],
    }
    response = await client.patch(url, json=allowed, headers=CSRF)
    assert response.status_code == 200, response.text
    assert response.json()["description"] == "ok"
    assert response.json()["location"] == "Heredia"
    response = await client.patch(url, json={"location": None, "is_online": True}, headers=CSRF)
    assert response.status_code == 200
    assert response.json()["budget_crc"] == 25000


async def test_archived_event_is_read_only(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    await login_as(client, *ANA)
    event = await create(client)
    await set_state(db, event["id"], "archived")
    url = f"{EVENTS}/{event['id']}"
    for response in (
        await client.patch(url, json={"description": "x"}, headers=CSRF),
        await client.delete(url, headers=CSRF),
    ):
        assert response.status_code == 409
        assert error_code(response) == "EVENT_ARCHIVED"
    assert (await client.get(url)).status_code == 200


@pytest.mark.parametrize(
    ("case", "patch"),
    [
        ("exchange in the past", {"exchange_at": future(-1)}),
        ("deadline after exchange", {"join_deadline": future(40)}),  # exchange is +30d
        ("exchange before deadline", {"exchange_at": future(3)}),  # deadline is +5d
        ("null name", {"name": None}),
        ("null budget", {"budget_crc": None}),
        ("null exchange", {"exchange_at": None}),
        ("online with a location", {"is_online": True}),  # location is set
        ("location on an online event", {"location": "x", "is_online": True}),
        ("unknown field", {"state": "drawn"}),
        ("name too short", {"name": "ab"}),
    ],
)
async def test_patch_validation(
    client: httpx.AsyncClient, case: str, patch: dict[str, Any]
) -> None:
    await login_as(client, *ANA)
    event = await create(client, location="San José", join_deadline=future(5))
    response = await client.patch(f"{EVENTS}/{event['id']}", json=patch, headers=CSRF)
    assert response.status_code == 422, case
    assert error_code(response) == "VALIDATION_ERROR"
    unchanged = (await client.get(f"{EVENTS}/{event['id']}")).json()
    assert unchanged["name"] == event["name"]
    assert unchanged["location"] == "San José"


async def test_clearing_the_deadline_is_allowed(client: httpx.AsyncClient) -> None:
    await login_as(client, *ANA)
    event = await create(client, join_deadline=future(5))
    response = await client.patch(
        f"{EVENTS}/{event['id']}", json={"join_deadline": None}, headers=CSRF
    )
    assert response.status_code == 200
    assert response.json()["join_deadline"] is None


# ── Delete ───────────────────────────────────────────────────────────────────


async def test_host_deletes_an_open_event_with_cascade(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    await login_as(client, *BETO)
    await login_as(client, *ANA)
    event = await create(client)
    await add_participant(db, event["id"], BETO[0])

    response = await client.delete(f"{EVENTS}/{event['id']}", headers=CSRF)
    assert response.status_code == 204
    assert (await client.get(f"{EVENTS}/{event['id']}")).status_code == 404
    async with db() as session:
        assert await session.scalar(select(func.count()).select_from(Event)) == 0
        assert await session.scalar(select(func.count()).select_from(EventParticipant)) == 0
        assert await session.scalar(select(func.count()).select_from(User)) == 2


async def test_drawn_event_cannot_be_deleted(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    await login_as(client, *ANA)
    event = await create(client)
    await set_state(db, event["id"], "drawn")
    response = await client.delete(f"{EVENTS}/{event['id']}", headers=CSRF)
    assert response.status_code == 409
    assert error_code(response) == "EVENT_ALREADY_DRAWN"
    assert (await client.get(f"{EVENTS}/{event['id']}")).status_code == 200
