"""Link previews on chat messages: unfurled by the worker right after sending, stored with
the event's objects, broadcast as ``message_updated``, and gone with the message."""

import asyncio
import contextlib
import json
import uuid
from typing import Any

import httpx
import pytest
from arq.connections import ArqRedis
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import Message
from app.realtime.channels import conversation_channel
from app.storage.r2 import ObjectStorage
from app.worker.tasks import unfurl_message
from tests.api.auth_helpers import CSRF, login_as
from tests.api.event_helpers import ANA, BETO, set_state, user_id
from tests.api.test_chat import API, by_kind, conversations, send, setup_event, start
from tests.conftest import TEST_REDIS_URL
from tests.links import FakeLinks, og_page
from tests.push import queued, run_jobs

pytestmark = pytest.mark.usefixtures("s3")

PAGE = "https://tienda.cr/lego"
PICTURE = "https://cdn.tienda.cr/lego.png"


def publish_lego(links: FakeLinks) -> None:
    links.html(PAGE, og_page("Lego Ideas", PICTURE, "Un set grande", "Juguetería"))
    links.image(PICTURE)


async def history(client: httpx.AsyncClient, conversation_id: str) -> list[dict[str, Any]]:
    response = await client.get(f"{API}/conversations/{conversation_id}/messages")
    assert response.status_code == 200, response.text
    items: list[dict[str, Any]] = response.json()["items"]
    return items


async def direct_with_beto(client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]) -> str:
    event = await setup_event(client, db)
    conversation: str = (await start(client, event, await user_id(db, BETO[0]), "direct")).json()[
        "id"
    ]
    return conversation


async def test_a_link_gets_a_preview_everyone_in_the_thread_sees(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    arq_pool: ArqRedis,
    redis_client: Redis,
    fake_links: FakeLinks,
    s3: ObjectStorage,
) -> None:
    publish_lego(fake_links)
    conversation = await direct_with_beto(client, db)

    listener = Redis.from_url(TEST_REDIS_URL, decode_responses=True)
    pubsub = listener.pubsub(ignore_subscribe_messages=True)
    await pubsub.subscribe(conversation_channel(uuid.UUID(conversation)))
    try:
        sent = (await send(client, conversation, f"Mirá esto: {PAGE}.")).json()
        assert sent["link_preview"] is None  # not yet: the worker does it
        assert ("unfurl_message", (sent["id"],)) in await queued(arq_pool)

        await run_jobs(arq_pool, db, redis_client, "unfurl_message")
        frames = []
        with contextlib.suppress(TimeoutError):
            async with asyncio.timeout(2):
                async for raw in pubsub.listen():
                    frames.append(json.loads(raw["data"]))
                    if frames[-1]["type"] == "message_updated":
                        break
    finally:
        await pubsub.aclose()  # type: ignore[no-untyped-call]
        await listener.aclose()

    updated = frames[-1]
    assert updated["type"] == "message_updated"
    assert updated["message"]["id"] == sent["id"]
    preview = updated["message"]["link_preview"]
    assert preview | {"image_url": None} == {
        "url": PAGE,
        "title": "Lego Ideas",
        "description": "Un set grande",
        "site_name": "Juguetería",
        "is_video": False,
        "image_url": None,
        "image_width": 640,
        "image_height": 360,
    }
    # Our own copy in R2, presigned like any photo: the browser never contacts the site.
    assert preview["image_url"].startswith("http://localhost:9000/")
    assert "cdn.tienda.cr" not in preview["image_url"]
    (key,) = s3.list_keys("events/")
    assert f"/conversations/{conversation}/" in key
    assert key.endswith(".webp")

    await login_as(client, *BETO)
    (message,) = await history(client, conversation)
    assert message["link_preview"]["title"] == "Lego Ideas"
    assert message["link_preview"]["image_url"].startswith("http://localhost:9000/")
    # The list preview carries it too.
    (direct,) = by_kind(await conversations(client), "direct")
    assert direct["last_message"]["link_preview"]["title"] == "Lego Ideas"

    # Idempotent: a retried job changes nothing and fetches nothing.
    fake_links.requested.clear()
    ctx = {"sessionmaker": db, "app_redis": redis_client}
    assert await unfurl_message(ctx, sent["id"]) is False
    assert fake_links.requested == []
    assert len(s3.list_keys("events/")) == 1


async def test_the_youtube_example_previews_the_video(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    arq_pool: ArqRedis,
    redis_client: Redis,
    fake_links: FakeLinks,
) -> None:
    url = "https://www.youtube.com/watch?v=9h30Bx4Klxg&list=RD9h30Bx4Klxg&start_radio=1"
    fake_links.json(
        "https://www.youtube.com/oembed?format=json&url="
        "https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D9h30Bx4Klxg",
        '{"title": "La canción", "author_name": "El canal"}',
    )
    # No HD thumbnail for this video: the 320x180 one is used.
    fake_links.image("https://i.ytimg.com/vi/9h30Bx4Klxg/mqdefault.jpg")
    conversation = await direct_with_beto(client, db)
    await send(client, conversation, url)
    await run_jobs(arq_pool, db, redis_client, "unfurl_message")

    (message,) = await history(client, conversation)
    preview = message["link_preview"]
    assert preview["url"] == url
    assert (preview["title"], preview["description"], preview["site_name"]) == (
        "La canción",
        "El canal",
        "YouTube",
    )
    assert preview["is_video"] is True
    assert preview["image_url"] is not None


async def test_no_link_no_job_and_a_dead_link_no_preview(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    arq_pool: ArqRedis,
    redis_client: Redis,
    fake_links: FakeLinks,
) -> None:
    conversation = await direct_with_beto(client, db)
    await send(client, conversation, "Sin enlaces, ¿ok?")
    assert [job for job, _ in await queued(arq_pool) if job == "unfurl_message"] == []

    await send(client, conversation, "https://no-existe.cr/nada")
    await run_jobs(arq_pool, db, redis_client, "unfurl_message")
    assert [m["link_preview"] for m in await history(client, conversation)] == [None, None]
    assert fake_links.requested == ["https://no-existe.cr/nada"]


async def test_a_page_without_a_picture_still_gets_a_text_preview(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    arq_pool: ArqRedis,
    redis_client: Redis,
    fake_links: FakeLinks,
    s3: ObjectStorage,
) -> None:
    fake_links.html(PAGE, og_page("Lego Ideas", "https://cdn.tienda.cr/roto.png"))
    conversation = await direct_with_beto(client, db)
    await send(client, conversation, PAGE)
    await run_jobs(arq_pool, db, redis_client, "unfurl_message")
    (message,) = await history(client, conversation)
    preview = message["link_preview"]
    assert (preview["title"], preview["image_url"], preview["image_width"]) == (
        "Lego Ideas",
        None,
        None,
    )
    assert s3.list_keys("events/") == []


async def test_deleting_the_message_removes_its_preview_and_picture(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    arq_pool: ArqRedis,
    redis_client: Redis,
    fake_links: FakeLinks,
    s3: ObjectStorage,
) -> None:
    publish_lego(fake_links)
    conversation = await direct_with_beto(client, db)
    sent = (await send(client, conversation, PAGE)).json()
    await run_jobs(arq_pool, db, redis_client, "unfurl_message")
    assert len(s3.list_keys("events/")) == 1

    assert (await client.delete(f"{API}/messages/{sent['id']}", headers=CSRF)).status_code == 204
    (message,) = await history(client, conversation)
    assert (message["deleted"], message["link_preview"]) == (True, None)
    async with db() as session:
        row = await session.get(Message, uuid.UUID(sent["id"]))
        assert row is not None
        assert row.link_preview is None
    await run_jobs(arq_pool, db, redis_client, "delete_objects")
    assert s3.list_keys("events/") == []


async def test_a_message_deleted_before_the_worker_gets_no_preview(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    arq_pool: ArqRedis,
    redis_client: Redis,
    fake_links: FakeLinks,
    s3: ObjectStorage,
) -> None:
    publish_lego(fake_links)
    conversation = await direct_with_beto(client, db)
    sent = (await send(client, conversation, PAGE)).json()
    await client.delete(f"{API}/messages/{sent['id']}", headers=CSRF)
    await run_jobs(arq_pool, db, redis_client, "unfurl_message")
    assert fake_links.requested == []
    assert s3.list_keys("events/") == []


async def test_archived_events_are_left_alone(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    arq_pool: ArqRedis,
    redis_client: Redis,
    fake_links: FakeLinks,
) -> None:
    publish_lego(fake_links)
    event = await setup_event(client, db)
    conversation = (await start(client, event, await user_id(db, BETO[0]), "direct")).json()["id"]
    await send(client, conversation, PAGE)
    await set_state(db, event["id"], "archived")
    await run_jobs(arq_pool, db, redis_client, "unfurl_message")
    assert fake_links.requested == []
    (message,) = await history(client, conversation)
    assert message["link_preview"] is None


async def test_account_deletion_removes_the_users_previews(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    arq_pool: ArqRedis,
    redis_client: Redis,
    fake_links: FakeLinks,
    s3: ObjectStorage,
) -> None:
    publish_lego(fake_links)
    event = await setup_event(client, db)
    ana = await user_id(db, ANA[0])
    await login_as(client, *BETO)
    conversation = (await start(client, event, ana, "anonymous")).json()["id"]
    await send(client, conversation, PAGE)
    await run_jobs(arq_pool, db, redis_client, "unfurl_message")
    assert len(s3.list_keys("events/")) == 1

    deleted = await client.delete(f"{API}/me", headers=CSRF)
    assert deleted.status_code == 204, deleted.text
    await run_jobs(arq_pool, db, redis_client, "delete_objects")
    assert s3.list_keys("events/") == []

    await login_as(client, *ANA)
    (message,) = await history(client, conversation)
    assert (message["deleted"], message["link_preview"]) == (True, None)
