"""Event cover photos (Prompt 18): upload, replace, remove, cleanup, limits."""

import io
import uuid
from typing import Any
from urllib.parse import urlsplit

import httpx
import pytest
from arq.connections import ArqRedis
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import Event
from app.services import covers as cover_service
from app.storage.images import MAX_BYTES, process_image
from app.storage.r2 import ObjectStorage
from app.worker.tasks import delete_objects, delete_prefix
from tests import images
from tests.api.auth_helpers import CSRF, login_as
from tests.api.event_helpers import (
    ANA,
    BETO,
    EVENTS,
    add_participant,
    create,
    error_code,
    set_state,
)

pytestmark = pytest.mark.usefixtures("s3")


async def upload(
    client: httpx.AsyncClient, event: dict[str, Any], data: bytes, name: str = "photo.jpg"
) -> httpx.Response:
    return await client.post(
        f"{EVENTS}/{event['id']}/cover",
        files={"file": (name, data, "image/jpeg")},
        headers=CSRF,
    )


async def queued(pool: ArqRedis) -> list[tuple[str, tuple[Any, ...]]]:
    return [(job.function, job.args) for job in await pool.queued_jobs()]


async def cover_key(db: async_sessionmaker[AsyncSession], event_id: str) -> str | None:
    async with db() as session:
        event = await session.get(Event, uuid.UUID(event_id))
    assert event is not None
    return event.cover_photo_key


def key_of(url: str, bucket: str) -> str:
    return urlsplit(url).path.removeprefix(f"/{bucket}/")


async def host_event(client: httpx.AsyncClient) -> dict[str, Any]:
    """Ana hosts a new event; Beto has an account but isn't in it. Ana stays signed in."""
    await login_as(client, *BETO)
    await login_as(client, *ANA)
    return await create(client)


async def test_upload_stores_clean_webp_and_returns_presigned_urls(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession], s3: ObjectStorage
) -> None:
    event = await host_event(client)
    response = await upload(client, event, images.jpeg_with_gps((2400, 1800)))
    assert response.status_code == 200, response.text
    body = response.json()

    key = await cover_key(db, event["id"])
    assert key is not None
    assert key.startswith(f"events/{event['id']}/cover/")
    assert key.endswith(".webp")
    thumb = key.removesuffix(".webp") + "_thumb.webp"
    assert set(s3.list_keys(f"events/{event['id']}/")) == {key, thumb}

    for field, expected in (("cover_url", key), ("cover_thumb_url", thumb)):
        url = body[field]
        assert url.startswith(f"http://localhost:9000/{s3.bucket}/")
        assert "X-Amz-Expires=3600" in url
        assert key_of(url, s3.bucket) == expected

    stored = s3._client.get_object(Bucket=s3.bucket, Key=key)["Body"].read()
    image = Image.open(io.BytesIO(stored))
    assert image.format == "WEBP"
    assert image.size == (1600, 1200)
    assert dict(image.getexif()) == {}
    assert b"GPS" not in stored
    assert b"Apple" not in stored

    # Every participant sees it, and the dashboard card has the thumbnail.
    await add_participant(db, event["id"], BETO[0])
    await login_as(client, *BETO)
    detail = (await client.get(f"{EVENTS}/{event['id']}")).json()
    assert key_of(detail["cover_url"], s3.bucket) == key
    cards = (await client.get(EVENTS, params={"section": "participating"})).json()["items"]
    assert key_of(cards[0]["cover_thumb_url"], s3.bucket) == thumb


async def test_no_cover_means_null_urls(client: httpx.AsyncClient) -> None:
    event = await host_event(client)
    assert (event["cover_url"], event["cover_thumb_url"]) == (None, None)


async def test_replacing_enqueues_cleanup_of_the_old_objects_after_commit(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    s3: ObjectStorage,
    arq_pool: ArqRedis,
) -> None:
    event = await host_event(client)
    await upload(client, event, images.small_png())
    old = await cover_key(db, event["id"])
    assert old is not None
    assert await queued(arq_pool) == []  # a first upload has nothing to clean

    response = await upload(client, event, images.png_with_alpha(), name="new.png")
    assert response.status_code == 200
    new = await cover_key(db, event["id"])
    assert new != old
    old_thumb = old.removesuffix(".webp") + "_thumb.webp"
    assert await queued(arq_pool) == [("delete_objects", ([old, old_thumb],))]

    # What the worker would do:
    await delete_objects({}, [old, old_thumb])
    assert set(s3.list_keys(f"events/{event['id']}/")) == {
        new,
        new.removesuffix(".webp") + "_thumb.webp",
    }


async def test_remove_cover(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    arq_pool: ArqRedis,
) -> None:
    event = await host_event(client)
    await upload(client, event, images.small_png())
    old = await cover_key(db, event["id"])
    assert old is not None

    response = await client.delete(f"{EVENTS}/{event['id']}/cover", headers=CSRF)
    assert response.status_code == 200
    assert (response.json()["cover_url"], response.json()["cover_thumb_url"]) == (None, None)
    assert await cover_key(db, event["id"]) is None
    assert await queued(arq_pool) == [
        ("delete_objects", ([old, old.removesuffix(".webp") + "_thumb.webp"],))
    ]

    # Removing again is a no-op and enqueues nothing more.
    assert (await client.delete(f"{EVENTS}/{event['id']}/cover", headers=CSRF)).status_code == 200
    assert len(await queued(arq_pool)) == 1


async def test_deleting_the_event_cleans_its_whole_folder(
    client: httpx.AsyncClient, s3: ObjectStorage, arq_pool: ArqRedis
) -> None:
    event = await host_event(client)
    other = await create(client)
    await upload(client, event, images.small_png())
    await upload(client, other, images.small_png())

    assert (await client.delete(f"{EVENTS}/{event['id']}", headers=CSRF)).status_code == 204
    prefix = f"events/{event['id']}/"
    assert await queued(arq_pool) == [("delete_prefix", (prefix,))]
    await delete_prefix({}, prefix)
    assert s3.list_keys(prefix) == []
    assert len(s3.list_keys(f"events/{other['id']}/")) == 2


@pytest.mark.parametrize(
    ("data", "name", "status", "code"),
    [
        pytest.param(b"not an image at all", "fake.jpg", 415, "UNSUPPORTED_IMAGE", id="txt as jpg"),
        pytest.param(b"\xff\xd8" + b"\0" * MAX_BYTES, "big.jpg", 413, "FILE_TOO_LARGE", id="11 MB"),
    ],
)
async def test_bad_files_are_refused_and_nothing_is_stored(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    s3: ObjectStorage,
    data: bytes,
    name: str,
    status: int,
    code: str,
) -> None:
    event = await host_event(client)
    response = await upload(client, event, data, name=name)
    assert response.status_code == status
    assert error_code(response) == code
    assert await cover_key(db, event["id"]) is None
    assert s3.list_keys("events/") == []


async def test_host_only_and_open_only(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession], arq_pool: ArqRedis
) -> None:
    event = await host_event(client)
    await add_participant(db, event["id"], BETO[0])
    await login_as(client, *BETO)
    for response in (
        await upload(client, event, images.small_png()),
        await client.delete(f"{EVENTS}/{event['id']}/cover", headers=CSRF),
    ):
        assert response.status_code == 403
        assert error_code(response) == "HOST_ONLY"

    await login_as(client, *ANA)
    await upload(client, event, images.small_png())
    await set_state(db, event["id"], "drawn")
    for response in (
        await upload(client, event, images.small_png()),
        await client.delete(f"{EVENTS}/{event['id']}/cover", headers=CSRF),
    ):
        assert response.status_code == 409
        assert error_code(response) == "EVENT_ALREADY_DRAWN"
    assert await queued(arq_pool) == []  # refused requests clean nothing up


async def test_uploads_are_rate_limited_per_user(client: httpx.AsyncClient) -> None:
    event = await host_event(client)
    data = images.small_png((8, 8))
    statuses = [(await upload(client, event, data)).status_code for _ in range(21)]
    assert statuses[:20] == [200] * 20
    assert statuses[20] == 429
    last = await upload(client, event, data)
    assert error_code(last) == "RATE_LIMITED"


async def test_upload_requires_session_and_csrf(client: httpx.AsyncClient) -> None:
    event = await host_event(client)
    no_csrf = await client.post(
        f"{EVENTS}/{event['id']}/cover", files={"file": ("a.png", images.small_png(), "image/png")}
    )
    assert no_csrf.status_code == 403
    client.cookies.clear()
    assert (await upload(client, event, images.small_png())).status_code == 401


async def test_a_failed_commit_removes_the_just_uploaded_objects(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    s3: ObjectStorage,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    event = await host_event(client)

    class CommitFailedError(RuntimeError):
        pass

    async with db() as session:
        row = await session.get(Event, uuid.UUID(event["id"]))
        assert row is not None

        async def failing_commit() -> None:
            raise CommitFailedError

        monkeypatch.setattr(session, "commit", failing_commit)
        with pytest.raises(CommitFailedError):
            await cover_service.set_cover(session, row, process_image(images.small_png()))

    assert s3.list_keys("events/") == []
    assert await cover_key(db, event["id"]) is None
