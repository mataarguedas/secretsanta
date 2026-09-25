"""Wishlists (Prompt 19, PRD §4.6, CLAUDE.md §2.6)."""

import uuid
from typing import Any

import httpx
import pytest
from arq.connections import ArqRedis
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import WishlistItem, WishlistPhoto
from app.models.wishlist import MAX_PHOTOS_PER_ITEM, PHOTO_LIMIT_FUNCTION
from app.services import wishlists as wishlist_service
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

DANI = ("dani@test.local", "Dani")  # has an account, not in the event


async def setup_event(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> dict[str, Any]:
    """Ana hosts Beto and Carla. Ana stays signed in."""
    for person in (BETO, CARLA, DANI, ANA):
        await login_as(client, *person)
    event = await create(client)
    for person in (BETO, CARLA):
        await add_participant(db, event["id"], person[0])
    return event


def items_url(event: dict[str, Any], suffix: str = "") -> str:
    return f"{EVENTS}/{event['id']}/wishlist/items{suffix}"


async def add(client: httpx.AsyncClient, event: dict[str, Any], **fields: Any) -> dict[str, Any]:
    response = await client.post(items_url(event), json={"title": "Libro", **fields}, headers=CSRF)
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


async def wishlist(
    client: httpx.AsyncClient, event: dict[str, Any], owner: uuid.UUID
) -> httpx.Response:
    return await client.get(f"{EVENTS}/{event['id']}/wishlists/{owner}")


async def count_items(db: async_sessionmaker[AsyncSession], event_id: str, owner: uuid.UUID) -> int:
    async with db() as session:
        found = await session.scalar(
            select(func.count())
            .select_from(WishlistItem)
            .where(WishlistItem.event_id == uuid.UUID(event_id), WishlistItem.user_id == owner)
        )
    return found or 0


async def add_photos(db: async_sessionmaker[AsyncSession], item_id: str, count: int) -> None:
    async with db() as session:
        for n in range(count):
            session.add(
                WishlistPhoto(
                    item_id=uuid.UUID(item_id),
                    object_key=f"events/e/items/{item_id}/{n}.webp",
                    thumb_key=f"events/e/items/{item_id}/{n}_thumb.webp",
                    width=100,
                    height=100,
                    position=n,
                )
            )
        await session.commit()


# ── Create and read ──────────────────────────────────────────────────────────


async def test_create_appends_and_everyone_can_read_in_order(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await setup_event(client, db)
    first = await add(
        client,
        event,
        title="  Audífonos  ",
        priority="high",
        price_crc=30000,
        url="https://tienda.example/audifonos?color=negro",
    )
    assert first == {
        "id": first["id"],
        "title": "Audífonos",
        "note": None,
        "url": "https://tienda.example/audifonos?color=negro",
        "price_crc": 30000,
        "priority": "high",
        "position": 0,
        "photos": [],
    }
    second = await add(client, event, title="Libro")
    assert (second["priority"], second["position"]) == ("medium", 1)
    third = await add(client, event, title="Taza", note="Grande\nde cerámica", priority="low")
    assert third["note"] == "Grande\nde cerámica"

    ana = await user_id(db, ANA[0])
    own = (await wishlist(client, event, ana)).json()
    assert own["is_self"] is True
    assert own["owner"] == {"id": str(ana), "name": "Ana", "avatar_url": None}
    assert [i["title"] for i in own["items"]] == ["Audífonos", "Libro", "Taza"]

    await login_as(client, *BETO)
    seen = (await wishlist(client, event, ana)).json()
    assert seen["is_self"] is False
    assert seen["items"] == own["items"]
    assert "@" not in (await wishlist(client, event, ana)).text


async def test_photos_come_back_as_presigned_urls(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await setup_event(client, db)
    item = await add(client, event)
    await add_photos(db, item["id"], 2)
    ana = await user_id(db, ANA[0])
    photos = (await wishlist(client, event, ana)).json()["items"][0]["photos"]
    assert [p["width"] for p in photos] == [100, 100]
    assert all("X-Amz-Expires=3600" in p["url"] for p in photos)
    assert all(p["thumb_url"].split("?")[0].endswith("_thumb.webp") for p in photos)


async def test_reading_needs_both_people_in_the_event(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await setup_event(client, db)
    dani = await user_id(db, DANI[0])
    response = await wishlist(client, event, dani)
    assert response.status_code == 404
    assert error_code(response) == "PARTICIPANT_NOT_FOUND"

    await login_as(client, *DANI)
    response = await wishlist(client, event, await user_id(db, ANA[0]))
    assert response.status_code == 404
    assert error_code(response) == "EVENT_NOT_FOUND"


# ── Validation ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "body",
    [
        pytest.param({"title": "x" * 121}, id="title over 120"),
        pytest.param({"title": "   "}, id="blank title"),
        pytest.param({}, id="no title"),
        pytest.param({"title": "a", "note": "n" * 1001}, id="note over 1000"),
        pytest.param({"title": "a", "url": "javascript:alert(1)"}, id="javascript url"),
        pytest.param({"title": "a", "url": "JavaScript:alert(1)"}, id="javascript mixed case"),
        pytest.param({"title": "a", "url": "data:text/html,<b>x</b>"}, id="data url"),
        pytest.param({"title": "a", "url": "file:///etc/passwd"}, id="file url"),
        pytest.param({"title": "a", "url": "ftp://example.com/x"}, id="ftp url"),
        pytest.param({"title": "a", "url": "https://"}, id="no host"),
        pytest.param({"title": "a", "url": "//example.com"}, id="scheme-relative"),
        pytest.param({"title": "a", "url": "https://exa mple.com"}, id="space in url"),
        pytest.param({"title": "a", "url": "https://x.com/\u0000"}, id="control char"),
        pytest.param({"title": "a", "price_crc": -1}, id="negative price"),
        pytest.param({"title": "a", "price_crc": 1.5}, id="fractional price"),
        pytest.param({"title": "a", "price_crc": "100"}, id="price as string"),
        pytest.param({"title": "a", "priority": "urgent"}, id="unknown priority"),
        pytest.param({"title": "a", "user_id": str(uuid.uuid4())}, id="extra field"),
    ],
)
async def test_invalid_items_are_422(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession], body: dict[str, Any]
) -> None:
    event = await setup_event(client, db)
    response = await client.post(items_url(event), json=body, headers=CSRF)
    assert response.status_code == 422, body
    assert error_code(response) == "VALIDATION_ERROR"
    assert await count_items(db, event["id"], await user_id(db, ANA[0])) == 0


async def test_optional_fields_accept_blank_as_null(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await setup_event(client, db)
    item = await add(client, event, note="  ", url="", price_crc=None)
    assert (item["note"], item["url"], item["price_crc"]) == (None, None, None)
    item = await add(client, event, url="HTTP://Example.com/x", price_crc=0)
    assert (item["url"], item["price_crc"]) == ("HTTP://Example.com/x", 0)


# ── Update and delete ────────────────────────────────────────────────────────


async def test_patch_changes_only_what_is_sent(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await setup_event(client, db)
    item = await add(client, event, note="Tapa dura", price_crc=12000)
    response = await client.patch(
        items_url(event, f"/{item['id']}"), json={"priority": "high", "note": ""}, headers=CSRF
    )
    assert response.status_code == 200
    body = response.json()
    assert (body["priority"], body["note"], body["price_crc"], body["title"]) == (
        "high",
        None,
        12000,
        "Libro",
    )
    for bad in ({"title": None}, {"priority": None}, {"url": "javascript:x"}):
        response = await client.patch(items_url(event, f"/{item['id']}"), json=bad, headers=CSRF)
        assert response.status_code == 422, bad


async def test_delete_removes_the_item_and_queues_photo_cleanup(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession], arq_pool: ArqRedis
) -> None:
    event = await setup_event(client, db)
    keep = await add(client, event, title="Queda")
    gone = await add(client, event, title="Se va")
    await add_photos(db, gone["id"], 2)

    response = await client.delete(items_url(event, f"/{gone['id']}"), headers=CSRF)
    assert response.status_code == 204
    ana = await user_id(db, ANA[0])
    assert [i["id"] for i in (await wishlist(client, event, ana)).json()["items"]] == [keep["id"]]

    [job] = await arq_pool.queued_jobs()
    assert job.function == "delete_objects"
    assert sorted(job.args[0]) == sorted(
        f"events/e/items/{gone['id']}/{name}"
        for name in ("0.webp", "0_thumb.webp", "1.webp", "1_thumb.webp")
    )

    again = await client.delete(items_url(event, f"/{gone['id']}"), headers=CSRF)
    assert again.status_code == 404


async def test_nobody_else_can_edit_or_delete_your_items(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await setup_event(client, db)
    item = await add(client, event, title="Mío")
    other_event = await create(client)
    foreign = await add(client, other_event, title="Otro evento")

    await login_as(client, *BETO)
    for response in (
        await client.patch(
            items_url(event, f"/{item['id']}"), json={"title": "hack"}, headers=CSRF
        ),
        await client.delete(items_url(event, f"/{item['id']}"), headers=CSRF),
    ):
        assert response.status_code == 404
        assert error_code(response) == "WISHLIST_ITEM_NOT_FOUND"

    # The owner can't reach an item through another event's URL either.
    await login_as(client, *ANA)
    response = await client.patch(
        items_url(event, f"/{foreign['id']}"), json={"title": "x"}, headers=CSRF
    )
    assert response.status_code == 404

    ana = await user_id(db, ANA[0])
    assert (await wishlist(client, event, ana)).json()["items"][0]["title"] == "Mío"


# ── Reorder ──────────────────────────────────────────────────────────────────


async def test_reorder(client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]) -> None:
    event = await setup_event(client, db)
    a, b, c = [(await add(client, event, title=t))["id"] for t in ("A", "B", "C")]
    order_url = f"{EVENTS}/{event['id']}/wishlist/order"

    response = await client.put(order_url, json={"item_ids": [c, a, b]}, headers=CSRF)
    assert response.status_code == 200
    assert [(i["title"], i["position"]) for i in response.json()] == [("C", 0), ("A", 1), ("B", 2)]
    ana = await user_id(db, ANA[0])
    assert [i["title"] for i in (await wishlist(client, event, ana)).json()["items"]] == [
        "C",
        "A",
        "B",
    ]
    # New items still go to the end.
    assert (await add(client, event, title="D"))["position"] == 3


async def test_reorder_must_list_exactly_your_items(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await setup_event(client, db)
    a, b = [(await add(client, event, title=t))["id"] for t in ("A", "B")]
    await login_as(client, *BETO)
    betos = (await add(client, event, title="de Beto"))["id"]
    await login_as(client, *ANA)
    order_url = f"{EVENTS}/{event['id']}/wishlist/order"

    for ids in ([a], [a, b, betos], [a, betos], [a, b, str(uuid.uuid4())]):
        response = await client.put(order_url, json={"item_ids": ids}, headers=CSRF)
        assert response.status_code == 422, ids
        assert error_code(response) == "WISHLIST_ORDER_MISMATCH"
    duplicate = await client.put(order_url, json={"item_ids": [a, a]}, headers=CSRF)
    assert error_code(duplicate) == "VALIDATION_ERROR"

    ana = await user_id(db, ANA[0])
    assert [i["title"] for i in (await wishlist(client, event, ana)).json()["items"]] == ["A", "B"]


# ── State ────────────────────────────────────────────────────────────────────


async def test_archived_wishlists_are_read_only(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await setup_event(client, db)
    item = await add(client, event)
    await set_state(db, event["id"], "archived")
    for response in (
        await client.post(items_url(event), json={"title": "x"}, headers=CSRF),
        await client.patch(items_url(event, f"/{item['id']}"), json={"title": "y"}, headers=CSRF),
        await client.delete(items_url(event, f"/{item['id']}"), headers=CSRF),
        await client.put(
            f"{EVENTS}/{event['id']}/wishlist/order", json={"item_ids": [item["id"]]}, headers=CSRF
        ),
    ):
        assert response.status_code == 409
        assert error_code(response) == "EVENT_ARCHIVED"
    ana = await user_id(db, ANA[0])
    assert (await wishlist(client, event, ana)).status_code == 200


async def test_drawn_wishlists_stay_editable_and_fire_the_hook(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[uuid.UUID, uuid.UUID]] = []

    async def spy(
        _session: object, _redis: object, event_id: uuid.UUID, owner_id: uuid.UUID
    ) -> None:
        calls.append((event_id, owner_id))

    monkeypatch.setattr(wishlist_service, "on_wishlist_changed", spy)
    event = await setup_event(client, db)
    item = await add(client, event)
    assert calls == []  # OPEN: no giver yet, nothing to notify

    await set_state(db, event["id"], "drawn")
    ana = await user_id(db, ANA[0])
    other = await add(client, event, title="Otro")
    await client.patch(items_url(event, f"/{item['id']}"), json={"title": "Libro 2"}, headers=CSRF)
    await client.put(
        f"{EVENTS}/{event['id']}/wishlist/order",
        json={"item_ids": [other["id"], item["id"]]},
        headers=CSRF,
    )
    await client.delete(items_url(event, f"/{item['id']}"), headers=CSRF)
    assert calls == [(uuid.UUID(event["id"]), ana)] * 4


# ── Roster changes and the photo limit ───────────────────────────────────────


async def test_removing_or_leaving_deletes_the_items_and_queues_photo_cleanup(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession], arq_pool: ArqRedis
) -> None:
    event = await setup_event(client, db)
    beto, carla = await user_id(db, BETO[0]), await user_id(db, CARLA[0])
    for person in (BETO, CARLA):
        await login_as(client, *person)
        item = await add(client, event, title=f"de {person[1]}")
        await add_photos(db, item["id"], 1)

    await login_as(client, *ANA)
    removed = await client.delete(f"{EVENTS}/{event['id']}/participants/{beto}", headers=CSRF)
    assert removed.status_code == 204
    assert await count_items(db, event["id"], beto) == 0

    await login_as(client, *CARLA)
    assert (await client.post(f"{EVENTS}/{event['id']}/leave", headers=CSRF)).status_code == 204
    assert await count_items(db, event["id"], carla) == 0

    jobs = await arq_pool.queued_jobs()
    assert [job.function for job in jobs] == ["delete_objects", "delete_objects"]
    assert all(len(job.args[0]) == 2 for job in jobs)


async def test_the_database_refuses_a_fourth_photo(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    assert f">= {MAX_PHOTOS_PER_ITEM} THEN" in PHOTO_LIMIT_FUNCTION
    event = await setup_event(client, db)
    item = await add(client, event)
    await add_photos(db, item["id"], MAX_PHOTOS_PER_ITEM)
    with pytest.raises(IntegrityError, match="WISHLIST_PHOTO_LIMIT"):
        await add_photos(db, item["id"], 1)
