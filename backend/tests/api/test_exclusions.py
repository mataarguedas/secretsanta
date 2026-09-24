"""Exclusion rules (Prompt 15, PRD §4.4, CLAUDE.md §2.3)."""

import uuid
from typing import Any

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import Exclusion
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
EVA = ("eva@test.local", "Eva")  # signed up, never joins


class Ids:
    def __init__(self, ana: uuid.UUID, beto: uuid.UUID, carla: uuid.UUID, dani: uuid.UUID):
        self.ana, self.beto, self.carla, self.dani = ana, beto, carla, dani


async def four_person_event(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> tuple[dict[str, Any], Ids]:
    """Ana hosts Beto, Carla and Dani. Eva exists but isn't in it. Ana stays signed in."""
    for person in (BETO, CARLA, DANI, EVA, ANA):
        await login_as(client, *person)
    event = await create(client)
    for person in (BETO, CARLA, DANI):
        await add_participant(db, event["id"], person[0])
    ids = Ids(*[await user_id(db, p[0]) for p in (ANA, BETO, CARLA, DANI)])
    return event, ids


def url(event: dict[str, Any], suffix: str = "") -> str:
    return f"{EVENTS}/{event['id']}/exclusions{suffix}"


async def post(
    client: httpx.AsyncClient, event: dict[str, Any], *users: uuid.UUID
) -> httpx.Response:
    return await client.post(url(event), json={"user_ids": [str(u) for u in users]}, headers=CSRF)


def pairs(body: dict[str, Any]) -> set[frozenset[str]]:
    return {frozenset((x["user_a"]["name"], x["user_b"]["name"])) for x in body["items"]}


async def stored(db: async_sessionmaker[AsyncSession], event_id: str) -> list[Exclusion]:
    async with db() as session:
        rows = await session.scalars(
            select(Exclusion).where(Exclusion.event_id == uuid.UUID(event_id))
        )
        return list(rows.all())


# ── Create, list, delete ─────────────────────────────────────────────────────


async def test_empty_list_is_feasible(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event, _ = await four_person_event(client, db)
    response = await client.get(url(event))
    assert response.status_code == 200
    assert response.json() == {"items": [], "feasible": True}


async def test_pair_is_created_in_canonical_order_with_public_users(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event, ids = await four_person_event(client, db)
    high, low = sorted((ids.ana, ids.beto), reverse=True)
    response = await post(client, event, high, low)  # deliberately the "wrong" order
    assert response.status_code == 201
    body = response.json()
    assert body["feasible"] is True
    [item] = body["items"]
    assert set(item) == {"id", "user_a", "user_b"}
    assert set(item["user_a"]) == {"id", "name", "avatar_url"}
    assert uuid.UUID(item["user_a"]["id"]) < uuid.UUID(item["user_b"]["id"])
    assert "@" not in response.text

    [row] = await stored(db, event["id"])
    assert (row.user_a_id, row.user_b_id) == (low, high)
    # The GET agrees with the POST response.
    assert (await client.get(url(event))).json() == body


async def test_reversed_duplicate_pair_is_skipped(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event, ids = await four_person_event(client, db)
    first = (await post(client, event, ids.beto, ids.carla)).json()
    again = await post(client, event, ids.carla, ids.beto)
    assert again.status_code == 201
    assert again.json() == first
    assert len(await stored(db, event["id"])) == 1


async def test_group_helper_creates_every_pair_and_skips_existing(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event, ids = await four_person_event(client, db)
    await post(client, event, ids.beto, ids.carla)
    response = await post(client, event, ids.beto, ids.carla, ids.dani)
    assert response.status_code == 201
    assert pairs(response.json()) == {
        frozenset(("Beto", "Carla")),
        frozenset(("Beto", "Dani")),
        frozenset(("Carla", "Dani")),
    }
    assert len(await stored(db, event["id"])) == 3
    assert all(r.user_a_id < r.user_b_id for r in await stored(db, event["id"]))


async def test_feasibility_follows_every_change(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event, ids = await four_person_event(client, db)

    def pair_id(body: dict[str, Any], a: str, b: str) -> str:
        return next(x["id"] for x in body["items"] if pairs({"items": [x]}) == {frozenset((a, b))})

    ab = await post(client, event, ids.ana, ids.beto)
    assert ab.json()["feasible"] is True
    # Beto, Carla and Dani can then only give to Ana: at most one of them can.
    group = await post(client, event, ids.beto, ids.carla, ids.dani)
    assert group.json()["feasible"] is False
    assert (await client.get(url(event))).json()["feasible"] is False

    # Dropping A⟷B is not enough: a 3-person family in a 4-person event is still stuck.
    removed = await client.delete(
        url(event, f"/{pair_id(group.json(), 'Ana', 'Beto')}"), headers=CSRF
    )
    assert removed.status_code == 200
    assert removed.json()["feasible"] is False
    assert len(removed.json()["items"]) == 3

    # Dropping C⟷D is: Ana ⟷ Beto and Carla ⟷ Dani swap.
    fixed = await client.delete(
        url(event, f"/{pair_id(removed.json(), 'Carla', 'Dani')}"), headers=CSRF
    )
    assert fixed.json()["feasible"] is True
    assert pairs(fixed.json()) == {frozenset(("Beto", "Carla")), frozenset(("Beto", "Dani"))}


async def test_delete_unknown_or_foreign_exclusion_is_404(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event, ids = await four_person_event(client, db)
    other = await create(client)
    await add_participant(db, other["id"], BETO[0])
    foreign = (await post(client, other, ids.ana, ids.beto)).json()["items"][0]["id"]

    for exclusion_id in (str(uuid.uuid4()), foreign):
        response = await client.delete(url(event, f"/{exclusion_id}"), headers=CSRF)
        assert response.status_code == 404
        assert error_code(response) == "EXCLUSION_NOT_FOUND"
    assert len(await stored(db, other["id"])) == 1


# ── Validation ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "user_ids",
    [
        pytest.param("one", id="one id"),
        pytest.param("dupe", id="duplicate ids"),
        pytest.param([], id="empty"),
        pytest.param(["not-a-uuid", "x"], id="not uuids"),
    ],
)
async def test_invalid_bodies_are_422(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession], user_ids: Any
) -> None:
    event, ids = await four_person_event(client, db)
    if user_ids == "one":
        user_ids = [str(ids.beto)]
    elif user_ids == "dupe":
        user_ids = [str(ids.beto), str(ids.beto)]
    response = await client.post(url(event), json={"user_ids": user_ids}, headers=CSRF)
    assert response.status_code == 422
    assert error_code(response) == "VALIDATION_ERROR"


async def test_every_id_must_be_a_current_participant(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event, ids = await four_person_event(client, db)
    eva = await user_id(db, EVA[0])
    for outsider in (eva, uuid.uuid4()):
        response = await post(client, event, ids.beto, ids.carla, outsider)
        assert response.status_code == 422
        assert error_code(response) == "EXCLUSION_INVALID_PARTICIPANT"
    assert await stored(db, event["id"]) == []  # nothing partial


async def test_database_enforces_canonical_order(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event, ids = await four_person_event(client, db)
    low, high = sorted((ids.beto, ids.carla))
    async with db() as session:
        session.add(Exclusion(event_id=uuid.UUID(event["id"]), user_a_id=high, user_b_id=low))
        with pytest.raises(IntegrityError, match="canonical_order"):
            await session.commit()


# ── Authorization and state ──────────────────────────────────────────────────


async def test_non_host_gets_host_only_on_every_route(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event, ids = await four_person_event(client, db)
    existing = (await post(client, event, ids.carla, ids.dani)).json()["items"][0]["id"]
    await login_as(client, *BETO)
    responses = [
        await client.get(url(event)),
        await post(client, event, ids.ana, ids.carla),
        await client.delete(url(event, f"/{existing}"), headers=CSRF),
    ]
    for response in responses:
        assert response.status_code == 403
        assert error_code(response) == "HOST_ONLY"
        assert "Carla" not in response.text
    assert len(await stored(db, event["id"])) == 1


async def test_outsiders_get_404(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event, _ = await four_person_event(client, db)
    await login_as(client, *EVA)
    response = await client.get(url(event))
    assert response.status_code == 404
    assert error_code(response) == "EVENT_NOT_FOUND"


@pytest.mark.parametrize("state", ["drawn", "archived"])
async def test_edits_are_locked_after_the_draw_but_the_list_is_readable(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession], state: str
) -> None:
    event, ids = await four_person_event(client, db)
    existing = (await post(client, event, ids.beto, ids.carla)).json()["items"][0]["id"]
    await set_state(db, event["id"], state)

    for response in (
        await post(client, event, ids.ana, ids.dani),
        await client.delete(url(event, f"/{existing}"), headers=CSRF),
    ):
        assert response.status_code == 409
        assert error_code(response) == "EVENT_ALREADY_DRAWN"
    listed = await client.get(url(event))
    assert listed.status_code == 200
    assert len(listed.json()["items"]) == 1
    assert len(await stored(db, event["id"])) == 1


async def test_mutations_require_the_csrf_header(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event, ids = await four_person_event(client, db)
    response = await client.post(url(event), json={"user_ids": [str(ids.ana), str(ids.beto)]})
    assert response.status_code == 403
    assert error_code(response) == "CSRF_HEADER_MISSING"


# ── Roster changes ───────────────────────────────────────────────────────────


async def test_removing_a_participant_deletes_their_exclusions(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event, ids = await four_person_event(client, db)
    await post(client, event, ids.beto, ids.carla, ids.dani)
    response = await client.delete(f"{EVENTS}/{event['id']}/participants/{ids.dani}", headers=CSRF)
    assert response.status_code == 204
    assert pairs((await client.get(url(event))).json()) == {frozenset(("Beto", "Carla"))}


async def test_leaving_deletes_your_exclusions(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event, ids = await four_person_event(client, db)
    await post(client, event, ids.ana, ids.beto)
    await post(client, event, ids.carla, ids.dani)
    await login_as(client, *BETO)
    assert (await client.post(f"{EVENTS}/{event['id']}/leave", headers=CSRF)).status_code == 204
    await login_as(client, *ANA)
    assert pairs((await client.get(url(event))).json()) == {frozenset(("Carla", "Dani"))}


async def test_deleting_the_event_cascades(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event, ids = await four_person_event(client, db)
    await post(client, event, ids.beto, ids.carla)
    assert (await client.delete(f"{EVENTS}/{event['id']}", headers=CSRF)).status_code == 204
    assert await stored(db, event["id"]) == []


# ── Draw readiness on the event detail ───────────────────────────────────────


async def test_draw_readiness_is_host_only(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event, _ = await four_person_event(client, db)
    host_view = (await client.get(f"{EVENTS}/{event['id']}")).json()
    assert host_view["draw_readiness"] == {
        "participant_count": 4,
        "feasible": True,
        "can_draw": True,
    }
    await login_as(client, *BETO)
    guest = await client.get(f"{EVENTS}/{event['id']}")
    assert "draw_readiness" not in guest.json()
    assert "feasible" not in guest.text


async def test_draw_readiness_tracks_exclusions_count_and_state(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event, ids = await four_person_event(client, db)

    async def readiness() -> dict[str, Any]:
        readiness: dict[str, Any] = (await client.get(f"{EVENTS}/{event['id']}")).json()[
            "draw_readiness"
        ]
        return readiness

    await post(client, event, ids.ana, ids.beto, ids.carla)  # Dani can't be everyone's
    assert await readiness() == {"participant_count": 4, "feasible": False, "can_draw": False}

    # Two people: feasible as a graph, but a draw needs at least 3.
    for person in (ids.carla, ids.dani):
        await client.delete(f"{EVENTS}/{event['id']}/participants/{person}", headers=CSRF)
    assert await readiness() == {"participant_count": 2, "feasible": False, "can_draw": False}
    await add_participant(db, event["id"], CARLA[0])
    await add_participant(db, event["id"], DANI[0])
    assert await readiness() == {"participant_count": 4, "feasible": True, "can_draw": True}

    await set_state(db, event["id"], "drawn")
    assert (await readiness())["can_draw"] is False
