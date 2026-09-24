"""The reveal (Prompt 16, PRD §4.5, §6, CLAUDE.md §2.1, §2.4)."""

import asyncio
import uuid
from typing import Any

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import Assignment, Event
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
PEOPLE = (ANA, BETO, CARLA, DANI)


async def drawable_event(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession], guests: int = 3
) -> dict[str, Any]:
    """Ana hosts ``guests`` of Beto, Carla, Dani. Ana stays signed in."""
    for person in (*PEOPLE[1:], ANA):
        await login_as(client, *person)
    event = await create(client)
    for person in PEOPLE[1 : 1 + guests]:
        await add_participant(db, event["id"], person[0])
    return event


async def draw(client: httpx.AsyncClient, event: dict[str, Any]) -> httpx.Response:
    return await client.post(f"{EVENTS}/{event['id']}/draw", headers=CSRF)


async def stored(db: async_sessionmaker[AsyncSession], event_id: str) -> dict[uuid.UUID, uuid.UUID]:
    async with db() as session:
        rows = await session.scalars(
            select(Assignment).where(Assignment.event_id == uuid.UUID(event_id))
        )
        return {row.giver_id: row.receiver_id for row in rows.all()}


async def event_row(db: async_sessionmaker[AsyncSession], event_id: str) -> Event:
    async with db() as session:
        event = await session.get(Event, uuid.UUID(event_id))
    assert event is not None
    return event


async def test_draw_stores_a_valid_permutation_and_returns_only_the_state(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await drawable_event(client, db)
    response = await draw(client, event)
    assert response.status_code == 200
    assert response.json() == {"state": "drawn"}

    pairs = await stored(db, event["id"])
    ids = {await user_id(db, p[0]) for p in PEOPLE}
    assert set(pairs) == ids
    assert set(pairs.values()) == ids
    assert all(giver != receiver for giver, receiver in pairs.items())

    row = await event_row(db, event["id"])
    assert row.state == "drawn"
    assert row.drawn_at is not None


async def test_draw_respects_exclusions(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await drawable_event(client, db)
    ana, beto = await user_id(db, ANA[0]), await user_id(db, BETO[0])
    await client.post(
        f"{EVENTS}/{event['id']}/exclusions",
        json={"user_ids": [str(ana), str(beto)]},
        headers=CSRF,
    )
    assert (await draw(client, event)).status_code == 200
    pairs = await stored(db, event["id"])
    assert pairs[ana] != beto
    assert pairs[beto] != ana


async def test_fewer_than_three_participants(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await drawable_event(client, db, guests=1)
    response = await draw(client, event)
    assert response.status_code == 409
    assert error_code(response) == "NOT_ENOUGH_PARTICIPANTS"
    assert (await event_row(db, event["id"])).state == "open"
    assert await stored(db, event["id"]) == {}


async def test_infeasible_exclusions(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await drawable_event(client, db, guests=2)
    ana, beto, carla = [await user_id(db, p[0]) for p in (ANA, BETO, CARLA)]
    for other in (beto, carla):
        await client.post(
            f"{EVENTS}/{event['id']}/exclusions",
            json={"user_ids": [str(ana), str(other)]},
            headers=CSRF,
        )
    response = await draw(client, event)
    assert response.status_code == 409
    assert error_code(response) == "DRAW_INFEASIBLE"
    assert (await event_row(db, event["id"])).state == "open"
    assert await stored(db, event["id"]) == {}


@pytest.mark.parametrize("state", ["drawn", "archived"])
async def test_only_open_events_can_be_drawn(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession], state: str
) -> None:
    event = await drawable_event(client, db)
    await set_state(db, event["id"], state)
    response = await draw(client, event)
    assert response.status_code == 409
    assert error_code(response) == "EVENT_ALREADY_DRAWN"
    assert await stored(db, event["id"]) == {}


async def test_drawing_twice_is_409_and_keeps_the_first_draw(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await drawable_event(client, db)
    assert (await draw(client, event)).status_code == 200
    first = await stored(db, event["id"])
    again = await draw(client, event)
    assert again.status_code == 409
    assert error_code(again) == "EVENT_ALREADY_DRAWN"
    assert await stored(db, event["id"]) == first


async def test_non_host_gets_403_and_outsiders_404(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await drawable_event(client, db, guests=2)
    await login_as(client, *BETO)
    response = await draw(client, event)
    assert response.status_code == 403
    assert error_code(response) == "HOST_ONLY"
    await login_as(client, *DANI)
    response = await draw(client, event)
    assert response.status_code == 404
    assert error_code(response) == "EVENT_NOT_FOUND"
    assert await stored(db, event["id"]) == {}


async def test_draw_requires_the_csrf_header(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await drawable_event(client, db)
    response = await client.post(f"{EVENTS}/{event['id']}/draw")
    assert response.status_code == 403
    assert await stored(db, event["id"]) == {}


async def test_concurrent_draws_exactly_one_succeeds(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    """Each request runs on its own DB session; the row lock serializes them."""
    event = await drawable_event(client, db)
    responses = await asyncio.gather(*(draw(client, event) for _ in range(4)))
    statuses = sorted(r.status_code for r in responses)
    assert statuses == [200, 409, 409, 409]
    assert all(error_code(r) == "EVENT_ALREADY_DRAWN" for r in responses if r.status_code == 409)
    assert len(await stored(db, event["id"])) == 4


async def test_my_assignment_is_each_givers_own_receiver_only(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await drawable_event(client, db)
    before = (await client.get(f"{EVENTS}/{event['id']}")).json()
    assert before["my_assignment"] is None

    await draw(client, event)
    pairs = await stored(db, event["id"])
    names = {await user_id(db, p[0]): p[1] for p in PEOPLE}

    for person in PEOPLE:
        await login_as(client, *person)
        me = await user_id(db, person[0])
        response = await client.get(f"{EVENTS}/{event['id']}")
        body = response.json()
        receiver = pairs[me]
        assert body["my_assignment"] == {
            "receiver": {"user_id": str(receiver), "name": names[receiver], "avatar_url": None}
        }
        # No other user's id appears anywhere in the response, except the host's (the
        # header shows who hosts; that alone ties them to no giver).
        host = await user_id(db, ANA[0])
        others = {str(r) for r in pairs.values() if r not in (receiver, host)}
        assert not any(other in response.text for other in others)


async def test_host_gets_no_extra_assignment_data(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await drawable_event(client, db)
    await draw(client, event)
    body = (await client.get(f"{EVENTS}/{event['id']}")).json()
    assert set(body["my_assignment"]) == {"receiver"}
    assert "assignments" not in body
    assert body["draw_readiness"]["can_draw"] is False
