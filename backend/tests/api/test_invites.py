"""Invite links: regenerate, disable, preview and join (Prompt 12, PRD §4.3)."""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import Event, EventParticipant
from app.services import invites as invite_service
from tests.api.auth_helpers import CSRF, login_as
from tests.api.event_helpers import (
    ANA,
    BETO,
    CARLA,
    EVENTS,
    add_participant,
    create,
    error_code,
    set_state,
)

INVITES = "/api/v1/invites"


async def hosted_event(client: httpx.AsyncClient, **overrides: Any) -> dict[str, Any]:
    """Ana hosts an event; Beto and Carla exist. Ana stays signed in."""
    await login_as(client, *BETO)
    await login_as(client, *CARLA)
    await login_as(client, *ANA)
    return await create(client, **overrides)


async def participant_count(db: async_sessionmaker[AsyncSession], event_id: str) -> int:
    async with db() as session:
        count = await session.scalar(
            select(func.count())
            .select_from(EventParticipant)
            .where(EventParticipant.event_id == uuid.UUID(event_id))
        )
    return count or 0


# ── Regenerate / disable ─────────────────────────────────────────────────────


async def test_regenerate_replaces_the_token(client: httpx.AsyncClient) -> None:
    event = await hosted_event(client)
    old = event["invite_token"]
    response = await client.post(f"{EVENTS}/{event['id']}/invite/regenerate", headers=CSRF)
    assert response.status_code == 200
    new = response.json()["invite_token"]
    assert new != old
    assert len(new) >= 43

    await login_as(client, *BETO)
    stale = await client.get(f"{INVITES}/{old}")
    assert stale.status_code == 404
    assert error_code(stale) == "INVITE_INVALID"
    assert (await client.get(f"{INVITES}/{new}")).status_code == 200


async def test_disable_then_regenerate_reenables(client: httpx.AsyncClient) -> None:
    event = await hosted_event(client)
    url = f"{EVENTS}/{event['id']}/invite"
    disabled = await client.delete(url, headers=CSRF)
    assert disabled.status_code == 200
    assert disabled.json()["invite_token"] is None

    await login_as(client, *BETO)
    for response in (
        await client.get(f"{INVITES}/{event['invite_token']}"),
        await client.post(f"{INVITES}/{event['invite_token']}/join", headers=CSRF),
    ):
        assert response.status_code == 404
        assert error_code(response) == "INVITE_INVALID"

    await login_as(client, *ANA)
    enabled = await client.post(f"{url}/regenerate", headers=CSRF)
    assert enabled.json()["invite_token"]
    await login_as(client, *BETO)
    assert (await client.get(f"{INVITES}/{enabled.json()['invite_token']}")).status_code == 200


async def test_invite_management_is_host_only(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await hosted_event(client)
    await add_participant(db, event["id"], BETO[0])
    await login_as(client, *BETO)
    for response in (
        await client.post(f"{EVENTS}/{event['id']}/invite/regenerate", headers=CSRF),
        await client.delete(f"{EVENTS}/{event['id']}/invite", headers=CSRF),
    ):
        assert response.status_code == 403
        assert error_code(response) == "HOST_ONLY"

    await login_as(client, *CARLA)  # not a participant
    response = await client.post(f"{EVENTS}/{event['id']}/invite/regenerate", headers=CSRF)
    assert response.status_code == 404
    assert error_code(response) == "EVENT_NOT_FOUND"


async def test_regenerate_is_open_only_and_disable_not_when_archived(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await hosted_event(client)
    url = f"{EVENTS}/{event['id']}/invite"
    await set_state(db, event["id"], "drawn")
    regenerate = await client.post(f"{url}/regenerate", headers=CSRF)
    assert regenerate.status_code == 409
    assert error_code(regenerate) == "EVENT_ALREADY_DRAWN"
    assert (await client.delete(url, headers=CSRF)).status_code == 200  # turning off is fine

    await set_state(db, event["id"], "archived")
    archived = await client.delete(url, headers=CSRF)
    assert archived.status_code == 409
    assert error_code(archived) == "EVENT_ARCHIVED"


async def test_invite_routes_require_session_and_csrf(client: httpx.AsyncClient) -> None:
    event = await hosted_event(client)
    token = event["invite_token"]
    assert (await client.post(f"{EVENTS}/{event['id']}/invite/regenerate")).status_code == 403
    assert (await client.post(f"{INVITES}/{token}/join")).status_code == 403
    client.cookies.clear()
    assert (await client.get(f"{INVITES}/{token}")).status_code == 401
    assert (await client.post(f"{INVITES}/{token}/join", headers=CSRF)).status_code == 401


# ── Preview ──────────────────────────────────────────────────────────────────


async def test_preview_for_a_new_user(client: httpx.AsyncClient) -> None:
    event = await hosted_event(client, name="Familia", budget_crc=15000)
    await login_as(client, *BETO)
    response = await client.get(f"{INVITES}/{event['invite_token']}")
    assert response.status_code == 200
    body = response.json()
    assert body["event_name"] == "Familia"
    assert body["budget_crc"] == 15000
    assert body["participant_count"] == 1
    assert body["host"]["name"] == "Ana"
    assert set(body["host"]) == {"id", "name", "avatar_url"}
    assert body["already_participant"] is False
    assert body["event_id"] is None  # not revealed before joining
    assert body["joinable"] is True
    assert body["reason"] is None
    assert "invite_token" not in body
    assert "ana@test.local" not in response.text


async def test_preview_for_an_existing_participant(client: httpx.AsyncClient) -> None:
    event = await hosted_event(client)
    body = (await client.get(f"{INVITES}/{event['invite_token']}")).json()  # the host
    assert body["already_participant"] is True
    assert body["event_id"] == event["id"]
    assert body["joinable"] is False
    assert body["reason"] == "ALREADY_PARTICIPANT"


@pytest.mark.parametrize(
    ("state", "deadline_hours", "reason"),
    [
        ("drawn", None, "EVENT_ALREADY_DRAWN"),
        ("archived", None, "EVENT_ALREADY_DRAWN"),
        ("open", -1, "JOIN_DEADLINE_PASSED"),
    ],
)
async def test_preview_explains_why_joining_is_closed(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    state: str,
    deadline_hours: int | None,
    reason: str,
) -> None:
    event = await hosted_event(client)
    await set_state(db, event["id"], state)
    if deadline_hours is not None:
        await _set_deadline(db, event["id"], hours=deadline_hours)
    await login_as(client, *BETO)
    body = (await client.get(f"{INVITES}/{event['invite_token']}")).json()
    assert body["joinable"] is False
    assert body["reason"] == reason
    assert body["event_id"] is None


@pytest.mark.parametrize("token", ["nope", "x" * 43, "x" * 129])
async def test_unknown_tokens_are_invalid(client: httpx.AsyncClient, token: str) -> None:
    await login_as(client, *BETO)
    for response in (
        await client.get(f"{INVITES}/{token}"),
        await client.post(f"{INVITES}/{token}/join", headers=CSRF),
    ):
        assert response.status_code in (404, 422)
        if response.status_code == 404:
            assert error_code(response) == "INVITE_INVALID"


async def _set_deadline(db: async_sessionmaker[AsyncSession], event_id: str, hours: int) -> None:
    """Move the deadline without tripping deadline < exchange_at."""
    async with db() as session:
        await session.execute(
            update(Event)
            .where(Event.id == uuid.UUID(event_id))
            .values(join_deadline=datetime.now(UTC) + timedelta(hours=hours))
        )
        await session.commit()


# ── Join ─────────────────────────────────────────────────────────────────────


async def test_join_adds_the_user_as_a_participant(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await hosted_event(client)
    await login_as(client, *BETO)
    response = await client.post(f"{INVITES}/{event['invite_token']}/join", headers=CSRF)
    assert response.status_code == 200
    assert response.json() == {"event_id": event["id"]}
    assert await participant_count(db, event["id"]) == 2

    detail = await client.get(f"{EVENTS}/{event['id']}")
    assert detail.status_code == 200
    assert detail.json()["my_role"] == "participant"
    assert detail.json()["participant_count"] == 2
    participating = (await client.get(EVENTS, params={"section": "participating"})).json()
    assert [e["id"] for e in participating["items"]] == [event["id"]]


async def test_joining_twice_is_already_participant_with_the_event_id(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await hosted_event(client)
    await login_as(client, *BETO)
    url = f"{INVITES}/{event['invite_token']}/join"
    assert (await client.post(url, headers=CSRF)).status_code == 200
    again = await client.post(url, headers=CSRF)
    assert again.status_code == 409
    assert error_code(again) == "ALREADY_PARTICIPANT"
    assert again.json()["error"]["params"] == {"event_id": event["id"]}
    assert await participant_count(db, event["id"]) == 2


async def test_the_host_joining_their_own_link_is_already_participant(
    client: httpx.AsyncClient,
) -> None:
    event = await hosted_event(client)
    response = await client.post(f"{INVITES}/{event['invite_token']}/join", headers=CSRF)
    assert response.status_code == 409
    assert error_code(response) == "ALREADY_PARTICIPANT"


@pytest.mark.parametrize(
    ("state", "deadline_hours", "code"),
    [
        ("drawn", None, "EVENT_ALREADY_DRAWN"),
        ("archived", None, "EVENT_ALREADY_DRAWN"),
        ("open", -1, "JOIN_DEADLINE_PASSED"),
    ],
)
async def test_join_is_refused_when_closed(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    state: str,
    deadline_hours: int | None,
    code: str,
) -> None:
    event = await hosted_event(client)
    await set_state(db, event["id"], state)
    if deadline_hours is not None:
        await _set_deadline(db, event["id"], hours=deadline_hours)
    await login_as(client, *BETO)
    response = await client.post(f"{INVITES}/{event['invite_token']}/join", headers=CSRF)
    assert response.status_code == 409
    assert error_code(response) == code
    assert await participant_count(db, event["id"]) == 1


async def test_a_future_deadline_still_allows_joining(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await hosted_event(client)
    await _set_deadline(db, event["id"], hours=2)
    await login_as(client, *BETO)
    response = await client.post(f"{INVITES}/{event['invite_token']}/join", headers=CSRF)
    assert response.status_code == 200


async def test_concurrent_double_join_creates_one_row(
    app: Any, client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await hosted_event(client)
    beto = await login_as(client, *BETO)
    cookies = {name: beto.cookies[name] for name in ("access_token",)}
    url = f"{INVITES}/{event['invite_token']}/join"

    async def join() -> httpx.Response:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver", cookies=cookies
        ) as other:
            return await other.post(url, headers=CSRF)

    results = await asyncio.gather(*(join() for _ in range(4)))
    statuses = sorted(r.status_code for r in results)
    assert statuses == [200, 409, 409, 409]
    assert {error_code(r) for r in results if r.status_code == 409} == {"ALREADY_PARTICIPANT"}
    assert await participant_count(db, event["id"]) == 2


async def test_unique_constraint_race_becomes_already_participant(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If the pre-check ever misses a concurrent insert, the DB constraint still answers
    with ALREADY_PARTICIPANT instead of a 500."""
    event = await hosted_event(client)
    await add_participant(db, event["id"], BETO[0])

    async def never_a_participant(*_args: object) -> bool:
        return False

    monkeypatch.setattr(invite_service, "is_participant", never_a_participant)
    await login_as(client, *BETO)
    response = await client.post(f"{INVITES}/{event['invite_token']}/join", headers=CSRF)
    assert response.status_code == 409
    assert error_code(response) == "ALREADY_PARTICIPANT"
    assert response.json()["error"]["params"] == {"event_id": event["id"]}
    assert await participant_count(db, event["id"]) == 2
