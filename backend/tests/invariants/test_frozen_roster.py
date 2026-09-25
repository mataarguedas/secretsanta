"""Invariant 3 — frozen roster after the draw (CLAUDE.md §2.3, PRD §3, §13.4).

Every roster-changing action returns 409 ``EVENT_ALREADY_DRAWN`` and changes nothing.
"""

import uuid

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import EventParticipant, Exclusion
from tests.api.auth_helpers import CSRF, login_as
from tests.api.event_helpers import EVENTS, set_state
from tests.invariants.drawn import ANA, OUTSIDER, PEOPLE, DrawnEvent, drawn_event

BETO, CARLA = PEOPLE[1], PEOPLE[2]


async def counts(db: async_sessionmaker[AsyncSession], event_id: str) -> tuple[int, int]:
    eid = uuid.UUID(event_id)
    async with db() as session:
        people = await session.scalar(
            select(func.count())
            .select_from(EventParticipant)
            .where(EventParticipant.event_id == eid)
        )
        pairs = await session.scalar(
            select(func.count()).select_from(Exclusion).where(Exclusion.event_id == eid)
        )
    return people or 0, pairs or 0


async def attempts(client: httpx.AsyncClient, drawn: DrawnEvent) -> dict[str, httpx.Response]:
    """Each roster change, as the user allowed to make it while OPEN."""
    e = f"{EVENTS}/{drawn.id}"
    carla = drawn.ids[CARLA[0]]
    beto = drawn.ids[BETO[0]]
    out: dict[str, httpx.Response] = {}

    await login_as(client, *OUTSIDER)
    out["join (valid token)"] = await client.post(
        f"/api/v1/invites/{drawn.invite_token}/join", headers=CSRF
    )
    await login_as(client, *BETO)
    out["leave"] = await client.post(f"{e}/leave", headers=CSRF)

    await login_as(client, *ANA)
    out["remove"] = await client.delete(f"{e}/participants/{carla}", headers=CSRF)
    out["exclusion POST"] = await client.post(
        f"{e}/exclusions", json={"user_ids": [str(beto), str(carla)]}, headers=CSRF
    )
    out["exclusion DELETE"] = await client.delete(
        f"{e}/exclusions/{drawn.exclusion_id}", headers=CSRF
    )
    out["invite regenerate"] = await client.post(f"{e}/invite/regenerate", headers=CSRF)
    return out


async def test_drawn_roster_is_frozen(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    drawn = await drawn_event(client, db)
    before = await counts(db, drawn.id)
    assert before == (5, 1)

    for action, response in (await attempts(client, drawn)).items():
        assert response.status_code == 409, f"{action}: {response.status_code} {response.text}"
        assert response.json()["error"]["code"] == "EVENT_ALREADY_DRAWN", action

    assert await counts(db, drawn.id) == before
    # The invite token didn't change either.
    await login_as(client, *ANA)
    detail = (await client.get(f"{EVENTS}/{drawn.id}")).json()
    assert detail["invite_token"] == drawn.invite_token


async def test_archived_roster_is_frozen_too(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    drawn = await drawn_event(client, db)
    await set_state(db, drawn.id, "archived")
    before = await counts(db, drawn.id)
    responses = await attempts(client, drawn)
    # Roster edits are EVENT_ALREADY_DRAWN in both states; regenerate reports the archive.
    for action, response in responses.items():
        expected = "EVENT_ARCHIVED" if action == "invite regenerate" else "EVENT_ALREADY_DRAWN"
        assert response.status_code == 409, action
        assert response.json()["error"]["code"] == expected, action
    assert await counts(db, drawn.id) == before


async def test_account_deletion_is_refused_during_a_draw(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    drawn = await drawn_event(client, db)
    before = await counts(db, drawn.id)
    # Any participant, the host included: nobody can leave the chain by deleting themselves.
    for person in (BETO, ANA):
        await login_as(client, *person)
        response = await client.delete("/api/v1/me", headers=CSRF)
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "ACCOUNT_IN_ACTIVE_DRAW"
        assert (await client.get("/api/v1/me")).status_code == 200
    assert await counts(db, drawn.id) == before


async def test_account_deletion_is_allowed_once_archived(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    drawn = await drawn_event(client, db)
    await set_state(db, drawn.id, "archived")
    await login_as(client, *BETO)
    assert (await client.delete("/api/v1/me", headers=CSRF)).status_code == 204
