"""The notify pipeline end to end (Prompt 25): the API queues ids only, the worker's tasks
push through ``notify``. pywebpush is replaced by ``push_spy``; jobs are run by hand."""

import json
import uuid

import httpx
from arq.connections import ArqRedis
from fastapi import FastAPI
from redis.asyncio import Redis
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import NotificationLog, PushSubscription, User
from app.realtime.channels import active_key
from tests.api.auth_helpers import CSRF, login_as
from tests.api.event_helpers import EVENTS, set_state
from tests.invariants.drawn import PEOPLE, DrawnEvent, drawn_event, open_event
from tests.push import PushSpy, endpoint_for, queued, run_jobs, subscribe
from tests.ws import WsClient, cookie_header

API = "/api/v1"
EMAILS = [email for email, _name in PEOPLE]
NAMES = [name for _email, name in PEOPLE]


async def set_user(db: async_sessionmaker[AsyncSession], uid: uuid.UUID, **values: object) -> None:
    async with db() as session:
        await session.execute(update(User).where(User.id == uid).values(**values))
        await session.commit()


async def everyone_subscribed(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession], arq_pool: ArqRedis
) -> DrawnEvent:
    """The 5-person drawn event, everyone with a device; the reveal job not run yet."""
    drawn = await drawn_event(client, db)
    await subscribe(db, *(drawn.ids[e] for e in EMAILS))
    return drawn


# ── Reveal ───────────────────────────────────────────────────────────────────


async def test_the_reveal_pushes_every_participant_in_their_language(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    arq_pool: ArqRedis,
    redis_client: Redis,
    push_spy: PushSpy,
) -> None:
    drawn = await everyone_subscribed(client, db, arq_pool)
    eva = drawn.ids["eva@test.local"]
    await set_user(db, eva, locale="en")
    # reveal is always on, whatever the toggles say (FR-NTF-3)
    await set_user(db, eva, notify_message=False, notify_wishlist=False, notify_reminder=False)

    jobs = await run_jobs(arq_pool, db, redis_client)

    assert jobs == [("send_reveal", (drawn.id,))]  # the event id and nothing else
    assert sorted(push_spy.recipients) == sorted(drawn.ids[e] for e in EMAILS)
    (ana,) = push_spy.to(drawn.ids["ana@test.local"])
    assert ana == {
        "title": "Secret Santa",
        "body": "Ya se hizo el sorteo de «Oficina 2026»: ¡descubre a quién le regalas!",
        "tag": f"reveal:{drawn.id}",
        "url": f"/events/{drawn.id}",
    }
    (english,) = push_spy.to(eva)
    assert english["body"] == "The draw for Oficina 2026 is done — see who you're giving to!"


async def test_a_failed_draw_queues_no_reveal(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession], arq_pool: ArqRedis
) -> None:
    event, _ids = await open_event(client, db)
    await client.post(f"{EVENTS}/{event['id']}/draw", headers=CSRF)
    again = await client.post(f"{EVENTS}/{event['id']}/draw", headers=CSRF)
    assert again.status_code == 409
    assert [f for f, _ in await queued(arq_pool)] == ["send_reveal"]  # once, not twice


# ── Messages ─────────────────────────────────────────────────────────────────


async def send(client: httpx.AsyncClient, conversation_id: uuid.UUID | str, body: str) -> str:
    response = await client.post(
        f"{API}/conversations/{conversation_id}/messages", json={"body": body}, headers=CSRF
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


async def test_a_group_message_pushes_everyone_but_the_sender(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    arq_pool: ArqRedis,
    redis_client: Redis,
    push_spy: PushSpy,
) -> None:
    drawn = await everyone_subscribed(client, db, arq_pool)
    await run_jobs(arq_pool, db, redis_client)  # the reveal
    push_spy.sent.clear()
    await set_user(db, drawn.ids["eva@test.local"], locale="en")

    message_id = await send(client, drawn.group_conversation_id, "¿Quién trae el pastel?")
    jobs = await run_jobs(arq_pool, db, redis_client)

    assert jobs == [("send_message_push", (message_id,))]
    ana = drawn.ids["ana@test.local"]
    assert ana not in push_spy.recipients
    assert sorted(push_spy.recipients) == sorted(drawn.ids[e] for e in EMAILS[1:])
    group = drawn.group_conversation_id
    for user, payload in push_spy.sent:
        assert payload == {
            "title": "Oficina 2026",
            "body": "Ana: ¿Quién trae el pastel?",
            "tag": f"conv:{group}",  # one notification per thread, updated in place
            "url": f"/chats/{group}",
        }, user


async def test_no_push_for_the_thread_on_screen(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    arq_pool: ArqRedis,
    redis_client: Redis,
    push_spy: PushSpy,
) -> None:
    drawn = await everyone_subscribed(client, db, arq_pool)
    await run_jobs(arq_pool, db, redis_client)
    push_spy.sent.clear()
    beto, carla = drawn.ids["beto@test.local"], drawn.ids["carla@test.local"]
    await redis_client.set(active_key(beto), str(drawn.group_conversation_id), ex=60)
    await redis_client.set(active_key(carla), str(uuid.uuid4()), ex=60)  # another thread

    await send(client, drawn.group_conversation_id, "hola")
    await run_jobs(arq_pool, db, redis_client)

    assert beto not in push_spy.recipients
    assert carla in push_spy.recipients


async def test_the_message_preference_is_respected(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    arq_pool: ArqRedis,
    redis_client: Redis,
    push_spy: PushSpy,
) -> None:
    drawn = await everyone_subscribed(client, db, arq_pool)
    await run_jobs(arq_pool, db, redis_client)
    push_spy.sent.clear()
    carla = drawn.ids["carla@test.local"]
    await set_user(db, carla, notify_message=False)

    await send(client, drawn.group_conversation_id, "hola")
    await run_jobs(arq_pool, db, redis_client)
    assert carla not in push_spy.recipients
    assert len(push_spy.recipients) == 3


async def test_the_preview_is_80_characters(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    arq_pool: ArqRedis,
    redis_client: Redis,
    push_spy: PushSpy,
) -> None:
    drawn = await everyone_subscribed(client, db, arq_pool)
    await run_jobs(arq_pool, db, redis_client)
    push_spy.sent.clear()
    await send(client, drawn.group_conversation_id, "x" * 300)
    await run_jobs(arq_pool, db, redis_client)
    body = push_spy.sent[0][1]["body"]
    assert body == "Ana: " + "x" * 79 + "…"


async def test_a_message_deleted_before_the_worker_runs_isnt_pushed(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    arq_pool: ArqRedis,
    redis_client: Redis,
    push_spy: PushSpy,
) -> None:
    drawn = await everyone_subscribed(client, db, arq_pool)
    await run_jobs(arq_pool, db, redis_client)
    push_spy.sent.clear()
    message_id = await send(client, drawn.group_conversation_id, "ups")
    await client.delete(f"{API}/messages/{message_id}", headers=CSRF)
    await run_jobs(arq_pool, db, redis_client)
    assert push_spy.sent == []


async def test_a_websocket_send_also_queues_the_push(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    arq_pool: ArqRedis,
    redis_client: Redis,
    push_spy: PushSpy,
    app: FastAPI,
) -> None:
    drawn = await everyone_subscribed(client, db, arq_pool)
    await run_jobs(arq_pool, db, redis_client)
    push_spy.sent.clear()
    await login_as(client, *PEOPLE[1])  # Beto
    ws = await WsClient(app, cookies=cookie_header(client)).connect()
    try:
        await ws.send_json(
            {
                "type": "send",
                "conversation_id": str(drawn.group_conversation_id),
                "body": "por el socket",
                "client_id": "c1",
            }
        )
        ack = await ws.receive_until("ack")
    finally:
        await ws.close()

    assert await queued(arq_pool) == [("send_message_push", (ack["message_id"],))]
    await run_jobs(arq_pool, db, redis_client)
    assert drawn.ids["beto@test.local"] not in push_spy.recipients
    assert push_spy.to(drawn.ids["ana@test.local"])[0]["body"] == "Beto: por el socket"


async def test_every_device_gets_it_and_dead_ones_are_removed(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    arq_pool: ArqRedis,
    redis_client: Redis,
    push_spy: PushSpy,
) -> None:
    drawn = await everyone_subscribed(client, db, arq_pool)
    beto = drawn.ids["beto@test.local"]
    await subscribe(db, beto, device="laptop")
    push_spy.failures[endpoint_for(beto, "phone")] = 410

    await run_jobs(arq_pool, db, redis_client)  # the reveal

    assert len(push_spy.to(beto)) == 1  # the laptop; the phone answered 410
    async with db() as session:
        endpoints = set(
            await session.scalars(
                select(PushSubscription.endpoint).where(PushSubscription.user_id == beto)
            )
        )
        stamped = await session.scalar(
            select(func.count(PushSubscription.id)).where(
                PushSubscription.last_success_at.is_not(None)
            )
        )
    assert endpoints == {endpoint_for(beto, "laptop")}
    assert stamped == 5  # 4 phones + Beto's laptop


# ── Wishlist updates ─────────────────────────────────────────────────────────


def giver_of(drawn: DrawnEvent, receiver: uuid.UUID) -> uuid.UUID:
    return next(g for g, r in drawn.receiver_of.items() if r == receiver)


async def add_item(client: httpx.AsyncClient, event_id: str, title: str = "Libro") -> str:
    response = await client.post(
        f"{EVENTS}/{event_id}/wishlist/items", json={"title": title}, headers=CSRF
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


async def test_a_wishlist_change_pushes_only_the_giver_once_per_10_minutes(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    arq_pool: ArqRedis,
    redis_client: Redis,
    push_spy: PushSpy,
) -> None:
    drawn = await everyone_subscribed(client, db, arq_pool)
    await run_jobs(arq_pool, db, redis_client)
    push_spy.sent.clear()
    await login_as(client, *PEOPLE[1])  # Beto edits his list, twice
    beto = drawn.ids["beto@test.local"]
    item = await add_item(client, drawn.id)
    await client.patch(
        f"{EVENTS}/{drawn.id}/wishlist/items/{item}", json={"title": "Libro 2"}, headers=CSRF
    )

    jobs = await run_jobs(arq_pool, db, redis_client)

    assert jobs == [("send_wishlist_updated", (drawn.id, str(beto)))]  # debounced: one
    assert await redis_client.ttl(f"wl_debounce:{drawn.id}:{beto}") > 590
    giver = giver_of(drawn, beto)
    assert push_spy.recipients == [giver]
    (payload,) = push_spy.to(giver)
    assert payload == {
        "title": "Oficina 2026",
        "body": "La persona a quien le regalas actualizó su lista de deseos.",
        "tag": f"wishlist:{drawn.id}",
        "url": f"/events/{drawn.id}/wishlists?user={beto}",
    }
    text = (payload["title"] + " " + payload["body"]).lower()
    assert "beto" not in text
    assert "beto@test.local" not in text

    async with db() as session:
        logs = list(await session.scalars(select(NotificationLog)))
    assert [(log.user_id, log.kind) for log in logs] == [(giver, "wishlist_debounce")]

    # After the window, the next change pushes again.
    await redis_client.delete(f"wl_debounce:{drawn.id}:{beto}")
    await client.delete(f"{EVENTS}/{drawn.id}/wishlist/items/{item}", headers=CSRF)
    assert [f for f, _ in await run_jobs(arq_pool, db, redis_client)] == ["send_wishlist_updated"]
    assert len(push_spy.to(giver)) == 2


async def test_the_wishlist_push_respects_the_givers_preference(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    arq_pool: ArqRedis,
    redis_client: Redis,
    push_spy: PushSpy,
) -> None:
    drawn = await everyone_subscribed(client, db, arq_pool)
    await run_jobs(arq_pool, db, redis_client)
    push_spy.sent.clear()
    beto = drawn.ids["beto@test.local"]
    await set_user(db, giver_of(drawn, beto), notify_wishlist=False, locale="en")
    await login_as(client, *PEOPLE[1])
    await add_item(client, drawn.id)
    await run_jobs(arq_pool, db, redis_client)
    assert push_spy.sent == []


async def test_open_or_archived_events_queue_no_wishlist_push(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    arq_pool: ArqRedis,
    redis_client: Redis,
) -> None:
    event, _ids = await open_event(client, db)
    await add_item(client, event["id"])
    assert await queued(arq_pool) == []
    await set_state(db, event["id"], "archived")
    refused = await client.post(
        f"{EVENTS}/{event['id']}/wishlist/items", json={"title": "x"}, headers=CSRF
    )
    assert refused.status_code == 409
    assert await queued(arq_pool) == []
    assert await redis_client.keys("wl_debounce:*") == []


async def test_the_queue_never_carries_names_bodies_or_pairs(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    arq_pool: ArqRedis,
    redis_client: Redis,
) -> None:
    drawn = await drawn_event(client, db)
    await send(client, drawn.group_conversation_id, "un secreto")
    await login_as(client, *PEOPLE[1])
    await add_item(client, drawn.id)
    jobs = json.dumps([args for _f, args in await queued(arq_pool)])
    for name in NAMES:
        assert name not in jobs
    assert "un secreto" not in jobs
    beto = drawn.ids["beto@test.local"]
    assert str(giver_of(drawn, beto)) not in jobs  # the worker looks the giver up itself
