"""Roster: list, remove and leave (Prompt 13, PRD §3, CLAUDE.md §2.3)."""

import uuid
from typing import Any

import httpx
import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import EventParticipant
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
    user_id,
)

DANI = ("dani@test.local", "Dani")


async def roster_event(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> dict[str, Any]:
    """Ana hosts; Beto then Carla join. Dani exists but isn't in it. Ana stays signed in."""
    for person in (BETO, CARLA, DANI, ANA):
        await login_as(client, *person)
    event = await create(client)
    await add_participant(db, event["id"], BETO[0])
    await add_participant(db, event["id"], CARLA[0])
    return event


async def member_ids(db: async_sessionmaker[AsyncSession], event_id: str) -> set[uuid.UUID]:
    async with db() as session:
        rows = await session.scalars(
            select(EventParticipant.user_id).where(EventParticipant.event_id == uuid.UUID(event_id))
        )
        return set(rows.all())


# ── List ─────────────────────────────────────────────────────────────────────


async def test_roster_is_host_first_then_join_order_without_emails(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await roster_event(client, db)
    await login_as(client, *BETO)
    response = await client.get(f"{EVENTS}/{event['id']}/participants")
    assert response.status_code == 200
    rows = response.json()
    assert [r["name"] for r in rows] == ["Ana", "Beto", "Carla"]
    assert set(rows[0]) == {"user_id", "name", "avatar_url", "is_host", "is_self", "joined_at"}
    assert [r["is_host"] for r in rows] == [True, False, False]
    assert [r["is_self"] for r in rows] == [False, True, False]
    assert rows[1]["user_id"] == str(await user_id(db, BETO[0]))
    assert "@" not in response.text  # no emails anywhere


async def test_roster_is_for_participants_only(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await roster_event(client, db)
    await login_as(client, *DANI)
    response = await client.get(f"{EVENTS}/{event['id']}/participants")
    assert response.status_code == 404
    assert error_code(response) == "EVENT_NOT_FOUND"
    client.cookies.clear()
    assert (await client.get(f"{EVENTS}/{event['id']}/participants")).status_code == 401


async def test_roster_is_readable_after_the_draw(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await roster_event(client, db)
    await set_state(db, event["id"], "archived")
    response = await client.get(f"{EVENTS}/{event['id']}/participants")
    assert response.status_code == 200
    assert len(response.json()) == 3


# ── Remove ───────────────────────────────────────────────────────────────────


async def test_host_removes_a_participant(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await roster_event(client, db)
    carla = await user_id(db, CARLA[0])
    response = await client.delete(f"{EVENTS}/{event['id']}/participants/{carla}", headers=CSRF)
    assert response.status_code == 204
    assert carla not in await member_ids(db, event["id"])
    assert (await client.get(f"{EVENTS}/{event['id']}")).json()["participant_count"] == 2

    await login_as(client, *CARLA)
    gone = await client.get(f"{EVENTS}/{event['id']}")
    assert gone.status_code == 404
    participating = (await client.get(EVENTS, params={"section": "participating"})).json()
    assert participating["items"] == []


async def test_host_cannot_remove_themselves(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await roster_event(client, db)
    ana = await user_id(db, ANA[0])
    response = await client.delete(f"{EVENTS}/{event['id']}/participants/{ana}", headers=CSRF)
    assert response.status_code == 409
    assert error_code(response) == "HOST_CANNOT_LEAVE"
    assert ana in await member_ids(db, event["id"])


@pytest.mark.parametrize("who", ["outsider", "unknown"])
async def test_removing_someone_not_in_the_event_is_404(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession], who: str
) -> None:
    event = await roster_event(client, db)
    target = await user_id(db, DANI[0]) if who == "outsider" else uuid.uuid4()
    response = await client.delete(f"{EVENTS}/{event['id']}/participants/{target}", headers=CSRF)
    assert response.status_code == 404
    assert error_code(response) == "PARTICIPANT_NOT_FOUND"


async def test_only_the_host_removes(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await roster_event(client, db)
    carla = await user_id(db, CARLA[0])
    await login_as(client, *BETO)
    response = await client.delete(f"{EVENTS}/{event['id']}/participants/{carla}", headers=CSRF)
    assert response.status_code == 403
    assert error_code(response) == "HOST_ONLY"

    await login_as(client, *DANI)
    response = await client.delete(f"{EVENTS}/{event['id']}/participants/{carla}", headers=CSRF)
    assert response.status_code == 404
    assert error_code(response) == "EVENT_NOT_FOUND"
    assert carla in await member_ids(db, event["id"])


# ── Leave ────────────────────────────────────────────────────────────────────


async def test_participant_leaves(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await roster_event(client, db)
    await login_as(client, *BETO)
    response = await client.post(f"{EVENTS}/{event['id']}/leave", headers=CSRF)
    assert response.status_code == 204
    assert await user_id(db, BETO[0]) not in await member_ids(db, event["id"])
    assert (await client.get(f"{EVENTS}/{event['id']}")).status_code == 404
    again = await client.post(f"{EVENTS}/{event['id']}/leave", headers=CSRF)
    assert again.status_code == 404
    assert error_code(again) == "EVENT_NOT_FOUND"


async def test_host_cannot_leave(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await roster_event(client, db)
    response = await client.post(f"{EVENTS}/{event['id']}/leave", headers=CSRF)
    assert response.status_code == 409
    assert error_code(response) == "HOST_CANNOT_LEAVE"
    assert len(await member_ids(db, event["id"])) == 3


async def test_a_leaver_can_rejoin_with_the_link(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await roster_event(client, db)
    await login_as(client, *BETO)
    await client.post(f"{EVENTS}/{event['id']}/leave", headers=CSRF)
    rejoin = await client.post(f"/api/v1/invites/{event['invite_token']}/join", headers=CSRF)
    assert rejoin.status_code == 200
    assert await user_id(db, BETO[0]) in await member_ids(db, event["id"])


# ── Frozen roster (CLAUDE.md §2.3) ───────────────────────────────────────────


@pytest.mark.parametrize("state", ["drawn", "archived"])
async def test_roster_is_frozen_after_the_draw(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession], state: str
) -> None:
    code = "EVENT_ALREADY_DRAWN"  # for archived events too (CLAUDE.md §2.3)
    event = await roster_event(client, db)
    await set_state(db, event["id"], state)
    carla = await user_id(db, CARLA[0])

    remove = await client.delete(f"{EVENTS}/{event['id']}/participants/{carla}", headers=CSRF)
    assert remove.status_code == 409
    assert error_code(remove) == code

    host_leave = await client.post(f"{EVENTS}/{event['id']}/leave", headers=CSRF)
    assert host_leave.status_code == 409
    assert error_code(host_leave) == code  # the frozen state wins over HOST_CANNOT_LEAVE

    await login_as(client, *BETO)
    leave = await client.post(f"{EVENTS}/{event['id']}/leave", headers=CSRF)
    assert leave.status_code == 409
    assert error_code(leave) == code

    assert len(await member_ids(db, event["id"])) == 3


async def test_roster_mutations_require_the_csrf_header(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await roster_event(client, db)
    carla = await user_id(db, CARLA[0])
    assert (await client.delete(f"{EVENTS}/{event['id']}/participants/{carla}")).status_code == 403
    await login_as(client, *BETO)
    assert (await client.post(f"{EVENTS}/{event['id']}/leave")).status_code == 403
    async with db() as session:
        count = await session.scalar(select(func.count()).select_from(EventParticipant))
    assert count == 3
