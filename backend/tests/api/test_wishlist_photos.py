"""Wishlist photos and copy-from-event (Prompt 20, PRD FR-WSH-3, FR-WSH-5)."""

import io
import uuid
from typing import Any

import httpx
import pytest
from arq.connections import ArqRedis
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import WishlistItem, WishlistPhoto
from app.services import wishlists as wishlist_service
from app.storage.r2 import ObjectStorage
from tests import images
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

pytestmark = pytest.mark.usefixtures("s3")

PHOTOS = "/api/v1/wishlist/items"


async def setup_event(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession], **overrides: Any
) -> dict[str, Any]:
    """Ana hosts Beto. Carla has an account but isn't in it. Ana stays signed in."""
    for person in (BETO, CARLA, ANA):
        await login_as(client, *person)
    event = await create(client, **overrides)
    await add_participant(db, event["id"], BETO[0])
    return event


async def add_item(
    client: httpx.AsyncClient, event: dict[str, Any], title: str = "Audífonos"
) -> dict[str, Any]:
    response = await client.post(
        f"{EVENTS}/{event['id']}/wishlist/items", json={"title": title}, headers=CSRF
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


async def upload(
    client: httpx.AsyncClient, item_id: str, data: bytes | None = None
) -> httpx.Response:
    return await client.post(
        f"{PHOTOS}/{item_id}/photos",
        files={"file": ("x.jpg", data or images.jpeg_with_gps((800, 600)), "image/jpeg")},
        headers=CSRF,
    )


async def photo_rows(db: async_sessionmaker[AsyncSession], item_id: str) -> list[WishlistPhoto]:
    async with db() as session:
        rows = await session.scalars(
            select(WishlistPhoto)
            .where(WishlistPhoto.item_id == uuid.UUID(item_id))
            .order_by(WishlistPhoto.position)
        )
        return list(rows.all())


def item_keys(event_id: str, item_id: str) -> str:
    return f"events/{event_id}/items/{item_id}/"


# ── Upload ───────────────────────────────────────────────────────────────────


async def test_three_uploads_then_the_fourth_is_409(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession], s3: ObjectStorage
) -> None:
    event = await setup_event(client, db)
    item = await add_item(client, event)

    for n in range(3):
        response = await upload(client, item["id"])
        assert response.status_code == 201, response.text
        assert len(response.json()["photos"]) == n + 1

    body = response.json()
    rows = await photo_rows(db, item["id"])
    assert [row.position for row in rows] == [0, 1, 2]
    prefix = item_keys(event["id"], item["id"])
    for row in rows:
        assert row.object_key.startswith(prefix)
        assert row.object_key.endswith(".webp")
        assert row.thumb_key == row.object_key.removesuffix(".webp") + "_thumb.webp"
        assert (row.width, row.height) == (800, 600)
    assert len(s3.list_keys(prefix)) == 6
    assert [p["id"] for p in body["photos"]] == [str(row.id) for row in rows]
    assert all(
        "X-Amz-Signature" in p["url"] and "X-Amz-Signature" in p["thumb_url"]
        for p in body["photos"]
    )

    fourth = await upload(client, item["id"])
    assert fourth.status_code == 409
    assert error_code(fourth) == "PHOTO_LIMIT_REACHED"
    assert len(s3.list_keys(prefix)) == 6  # refused before anything was stored


async def test_stored_photo_has_no_metadata(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession], s3: ObjectStorage
) -> None:
    event = await setup_event(client, db)
    item = await add_item(client, event)
    assert (await upload(client, item["id"], images.jpeg_with_gps())).status_code == 201
    (row,) = await photo_rows(db, item["id"])
    stored = s3._client.get_object(Bucket=s3.bucket, Key=row.object_key)["Body"].read()
    with Image.open(io.BytesIO(stored)) as image:
        assert image.format == "WEBP"
        assert max(image.size) == 1600
        assert not image.getexif()
        assert "icc_profile" not in image.info
        assert "xmp" not in image.info


async def test_the_limit_holds_under_the_lock_even_if_the_early_check_passes(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    s3: ObjectStorage,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Two uploads that both passed the early check: the second is refused under the lock
    and its objects are removed."""
    from app.services import wishlist_photos

    event = await setup_event(client, db)
    item = await add_item(client, event)
    for _ in range(3):
        assert (await upload(client, item["id"])).status_code == 201

    async def no_early_check(*_args: Any) -> None:
        return None

    monkeypatch.setattr(wishlist_photos, "ensure_photo_slot", no_early_check)
    response = await upload(client, item["id"])
    assert response.status_code == 409
    assert error_code(response) == "PHOTO_LIMIT_REACHED"
    assert len(s3.list_keys(item_keys(event["id"], item["id"]))) == 6


async def test_the_trigger_backstop_maps_to_409(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    s3: ObjectStorage,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If the service's own count were wrong, the DB trigger still refuses the 4th row,
    and the client gets the same 409 (not a 500)."""
    from app.services import wishlist_photos

    event = await setup_event(client, db)
    item = await add_item(client, event)
    for _ in range(3):
        assert (await upload(client, item["id"])).status_code == 201

    async def no_early_check(*_args: Any) -> None:
        return None

    monkeypatch.setattr(wishlist_photos, "ensure_photo_slot", no_early_check)
    monkeypatch.setattr(wishlist_photos, "MAX_PHOTOS_PER_ITEM", 4)
    response = await upload(client, item["id"])
    assert response.status_code == 409
    assert error_code(response) == "PHOTO_LIMIT_REACHED"
    assert len(await photo_rows(db, item["id"])) == 3
    assert len(s3.list_keys(item_keys(event["id"], item["id"]))) == 6


async def test_a_freed_slot_is_reused(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await setup_event(client, db)
    item = await add_item(client, event)
    for _ in range(3):
        await upload(client, item["id"])
    middle = (await photo_rows(db, item["id"]))[1]
    response = await client.delete(f"{PHOTOS}/{item['id']}/photos/{middle.id}", headers=CSRF)
    assert response.status_code == 204

    assert (await upload(client, item["id"])).status_code == 201
    assert [row.position for row in await photo_rows(db, item["id"])] == [0, 1, 2]


async def test_bad_files_are_refused(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession], s3: ObjectStorage
) -> None:
    event = await setup_event(client, db)
    item = await add_item(client, event)
    response = await upload(client, item["id"], b"%PDF-1.7 not an image")
    assert response.status_code == 415
    assert error_code(response) == "UNSUPPORTED_IMAGE"
    assert s3.list_keys(f"events/{event['id']}/") == []


# ── Delete ───────────────────────────────────────────────────────────────────


async def test_delete_photo_queues_cleanup_after_commit(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    arq_pool: ArqRedis,
) -> None:
    event = await setup_event(client, db)
    item = await add_item(client, event)
    await upload(client, item["id"])
    (row,) = await photo_rows(db, item["id"])

    response = await client.delete(f"{PHOTOS}/{item['id']}/photos/{row.id}", headers=CSRF)
    assert response.status_code == 204
    assert await photo_rows(db, item["id"]) == []
    jobs = await arq_pool.queued_jobs()
    assert [(job.function, sorted(job.args[0])) for job in jobs] == [
        ("delete_objects", sorted([row.object_key, row.thumb_key]))
    ]

    again = await client.delete(f"{PHOTOS}/{item['id']}/photos/{row.id}", headers=CSRF)
    assert again.status_code == 404
    assert error_code(again) == "PHOTO_NOT_FOUND"


async def test_a_photo_of_another_item_is_404(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await setup_event(client, db)
    first = await add_item(client, event)
    second = await add_item(client, event, "Taza")
    await upload(client, first["id"])
    (row,) = await photo_rows(db, first["id"])
    response = await client.delete(f"{PHOTOS}/{second['id']}/photos/{row.id}", headers=CSRF)
    assert response.status_code == 404
    assert error_code(response) == "PHOTO_NOT_FOUND"
    assert len(await photo_rows(db, first["id"])) == 1


# ── Permissions and state ────────────────────────────────────────────────────


async def test_only_the_owner_can_add_or_remove_photos(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await setup_event(client, db)
    item = await add_item(client, event)
    await upload(client, item["id"])
    (row,) = await photo_rows(db, item["id"])

    for person in (BETO, CARLA):  # another participant, and an outsider
        await login_as(client, *person)
        response = await upload(client, item["id"])
        assert response.status_code == 404
        assert error_code(response) == "WISHLIST_ITEM_NOT_FOUND"
        response = await client.delete(f"{PHOTOS}/{item['id']}/photos/{row.id}", headers=CSRF)
        assert response.status_code == 404
        assert error_code(response) == "WISHLIST_ITEM_NOT_FOUND"

    missing = await upload(client, str(uuid.uuid4()))
    assert missing.status_code == 404
    assert len(await photo_rows(db, item["id"])) == 1


async def test_photos_need_sign_in_and_the_csrf_header(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await setup_event(client, db)
    item = await add_item(client, event)
    no_header = await client.post(
        f"{PHOTOS}/{item['id']}/photos",
        files={"file": ("x.jpg", images.jpeg_with_gps((100, 100)), "image/jpeg")},
    )
    assert no_header.status_code == 403
    client.cookies.clear()
    assert (await upload(client, item["id"])).status_code == 401


async def test_archived_photos_are_read_only_and_drawn_fires_the_hook(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[uuid.UUID, uuid.UUID]] = []

    async def spy(event_id: uuid.UUID, owner_id: uuid.UUID) -> None:
        calls.append((event_id, owner_id))

    monkeypatch.setattr(wishlist_service, "on_wishlist_changed", spy)
    event = await setup_event(client, db)
    item = await add_item(client, event)
    ana = await user_id(db, ANA[0])

    await upload(client, item["id"])
    assert calls == []  # OPEN: no push hook

    await set_state(db, event["id"], "drawn")
    assert (await upload(client, item["id"])).status_code == 201
    rows = await photo_rows(db, item["id"])
    response = await client.delete(f"{PHOTOS}/{item['id']}/photos/{rows[0].id}", headers=CSRF)
    assert response.status_code == 204
    assert calls == [(uuid.UUID(event["id"]), ana)] * 2

    await set_state(db, event["id"], "archived")
    refused = await upload(client, item["id"])
    assert refused.status_code == 409
    assert error_code(refused) == "EVENT_ARCHIVED"
    refused = await client.delete(f"{PHOTOS}/{item['id']}/photos/{rows[1].id}", headers=CSRF)
    assert refused.status_code == 409
    assert error_code(refused) == "EVENT_ARCHIVED"


async def test_deleting_the_item_removes_its_photos_after_commit(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession], arq_pool: ArqRedis
) -> None:
    event = await setup_event(client, db)
    item = await add_item(client, event)
    await upload(client, item["id"])
    await upload(client, item["id"])
    keys = {k for row in await photo_rows(db, item["id"]) for k in (row.object_key, row.thumb_key)}

    response = await client.delete(
        f"{EVENTS}/{event['id']}/wishlist/items/{item['id']}", headers=CSRF
    )
    assert response.status_code == 204
    (job,) = await arq_pool.queued_jobs()
    assert set(job.args[0]) == keys


# ── Copy from another event ──────────────────────────────────────────────────


async def two_events(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Ana's list in ``source`` has two items (the first with two photos). Ana, signed in,
    also participates in ``target`` (hosted by Beto) with one item of her own."""
    source = await setup_event(client, db, name="Navidad 2025")
    first = await add_item(client, source, "Audífonos")
    await upload(client, first["id"])
    await upload(client, first["id"])
    await client.patch(
        f"{EVENTS}/{source['id']}/wishlist/items/{first['id']}",
        json={
            "note": "Negros",
            "url": "https://x.example/a",
            "price_crc": 30000,
            "priority": "high",
        },
        headers=CSRF,
    )
    await add_item(client, source, "Taza")

    await login_as(client, *BETO)
    target = await create(client, name="Oficina 2026")
    await add_participant(db, target["id"], ANA[0])
    await login_as(client, *ANA)
    await add_item(client, target, "Libro")
    return source, target


def copy_url(target: dict[str, Any], source: dict[str, Any]) -> str:
    return f"{EVENTS}/{target['id']}/wishlist/copy-from/{source['id']}"


async def test_copy_appends_items_with_independent_photo_copies(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    s3: ObjectStorage,
    arq_pool: ArqRedis,
) -> None:
    source, target = await two_events(client, db)
    ana = await user_id(db, ANA[0])
    original = (await client.get(f"{EVENTS}/{source['id']}/wishlists/{ana}")).json()["items"]

    response = await client.post(copy_url(target, source), headers=CSRF)
    assert response.status_code == 201, response.text
    copies = response.json()
    assert [c["title"] for c in copies] == ["Audífonos", "Taza"]
    assert [c["position"] for c in copies] == [1, 2]  # appended after "Libro"
    assert copies[0] | {"id": None, "photos": None, "position": None} == original[0] | {
        "id": None,
        "photos": None,
        "position": None,
    }
    assert len(copies[0]["photos"]) == 2
    assert copies[1]["photos"] == []
    assert {c["id"] for c in copies}.isdisjoint({o["id"] for o in original})

    listed = (await client.get(f"{EVENTS}/{target['id']}/wishlists/{ana}")).json()["items"]
    assert [i["title"] for i in listed] == ["Libro", "Audífonos", "Taza"]

    # New objects under the target event and the new item; the originals are untouched.
    copied_id = copies[0]["id"]
    new_keys = s3.list_keys(item_keys(target["id"], copied_id))
    assert len(new_keys) == 4
    old_rows = await photo_rows(db, original[0]["id"])
    new_rows = await photo_rows(db, copied_id)
    assert {r.object_key for r in old_rows}.isdisjoint({r.object_key for r in new_rows})
    for old, new in zip(old_rows, new_rows, strict=True):
        body = s3._client.get_object(Bucket=s3.bucket, Key=new.object_key)["Body"].read()
        assert body == s3._client.get_object(Bucket=s3.bucket, Key=old.object_key)["Body"].read()
        assert (new.width, new.height, new.position) == (old.width, old.height, old.position)

    # Deleting the copy only cleans up the copy's objects.
    response = await client.delete(
        f"{EVENTS}/{target['id']}/wishlist/items/{copied_id}", headers=CSRF
    )
    assert response.status_code == 204
    (job,) = await arq_pool.queued_jobs()
    assert set(job.args[0]) == set(new_keys)
    assert len(await photo_rows(db, original[0]["id"])) == 2


async def test_copy_sources_lists_other_events_with_items(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    source, target = await two_events(client, db)
    await create(client, name="Sin lista")  # Ana hosts it but has no items there

    response = await client.get(f"{EVENTS}/{target['id']}/wishlist/copy-sources")
    assert response.status_code == 200
    assert response.json() == [{"event_id": source["id"], "name": "Navidad 2025", "item_count": 2}]

    # Only her own items count: Beto has none in the source, so it isn't offered to him.
    await login_as(client, *BETO)
    assert (await client.get(f"{EVENTS}/{target['id']}/wishlist/copy-sources")).json() == []


async def test_copy_permissions(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    source, target = await two_events(client, db)

    # Not a participant of the source → 404, nothing copied.
    await login_as(client, *CARLA)
    carla_event = await create(client)
    response = await client.post(copy_url(carla_event, source), headers=CSRF)
    assert response.status_code == 404
    assert error_code(response) == "EVENT_NOT_FOUND"

    # Not a participant of the target → 404.
    response = await client.post(copy_url(target, carla_event), headers=CSRF)
    assert response.status_code == 404
    assert error_code(response) == "EVENT_NOT_FOUND"

    # The same event → 422.
    await login_as(client, *ANA)
    response = await client.post(copy_url(target, target), headers=CSRF)
    assert response.status_code == 422
    assert error_code(response) == "WISHLIST_COPY_SAME_EVENT"


async def test_copy_needs_an_editable_target_but_any_source(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    source, target = await two_events(client, db)
    await set_state(db, source["id"], "archived")  # last year's list: the main use case
    await set_state(db, target["id"], "drawn")
    assert (await client.post(copy_url(target, source), headers=CSRF)).status_code == 201

    await set_state(db, target["id"], "archived")
    response = await client.post(copy_url(target, source), headers=CSRF)
    assert response.status_code == 409
    assert error_code(response) == "EVENT_ARCHIVED"


async def test_copy_from_an_empty_list_copies_nothing(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    source, target = await two_events(client, db)
    await login_as(client, *BETO)  # Beto has no items in the source
    response = await client.post(copy_url(source, target), headers=CSRF)
    assert response.status_code == 201
    assert response.json() == []


async def test_a_failed_copy_rolls_back_and_removes_copied_objects(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    s3: ObjectStorage,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source, target = await two_events(client, db)
    real_copy = ObjectStorage.copy
    calls = 0

    def flaky_copy(self: ObjectStorage, source_key: str, dest_key: str) -> None:
        nonlocal calls
        calls += 1
        if calls == 3:
            raise RuntimeError("R2 is down")
        real_copy(self, source_key, dest_key)

    monkeypatch.setattr(ObjectStorage, "copy", flaky_copy)
    before = set(s3.list_keys(""))
    response = await client.post(copy_url(target, source), headers=CSRF)
    assert response.status_code == 500

    assert set(s3.list_keys("")) == before
    async with db() as session:
        titles = (
            await session.scalars(
                select(WishlistItem.title).where(WishlistItem.event_id == uuid.UUID(target["id"]))
            )
        ).all()
    assert titles == ["Libro"]
