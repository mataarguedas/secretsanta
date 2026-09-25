"""Account deletion (Prompt 28, FR-ACC-3, PRD §13.10)."""

import uuid
from dataclasses import dataclass
from typing import Any

import httpx
from arq.connections import ArqRedis
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import (
    Assignment,
    Conversation,
    ConversationMember,
    Event,
    EventParticipant,
    Exclusion,
    Message,
    PushSubscription,
    RefreshToken,
    User,
    WishlistItem,
    WishlistPhoto,
)
from app.services.covers import event_prefix, thumb_key
from tests.api.auth_helpers import CSRF, cookie_attrs, login_as
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
from tests.push import subscribe

DORA = ("dora.delgado@test.local", "Dora Delgado")  # the one who deletes her account
ME = "/api/v1/me"
CONVERSATIONS = "/api/v1/conversations"


async def queued(pool: ArqRedis) -> list[tuple[str, tuple[Any, ...]]]:
    return [(job.function, job.args) for job in await pool.queued_jobs()]


async def keys_to_delete(pool: ArqRedis) -> set[str]:
    return {key for fn, args in await queued(pool) if fn == "delete_objects" for key in args[0]}


async def add_item(
    db: async_sessionmaker[AsyncSession], event_id: str, owner: uuid.UUID, photos: int
) -> list[str]:
    """A wishlist item with stored photo rows (no image processing). Returns their keys."""
    item_id = uuid.uuid4()
    keys: list[str] = []
    async with db() as session:
        session.add(
            WishlistItem(
                id=item_id,
                event_id=uuid.UUID(event_id),
                user_id=owner,
                title="Libro",
                priority="medium",
                position=0,
            )
        )
        await session.flush()
        for n in range(photos):
            main = f"events/{event_id}/items/{item_id}/{uuid.uuid4()}.webp"
            keys += [main, thumb_key(main)]
            session.add(
                WishlistPhoto(
                    item_id=item_id,
                    object_key=main,
                    thumb_key=thumb_key(main),
                    width=10,
                    height=10,
                    position=n,
                )
            )
        await session.commit()
    return keys


async def send(client: httpx.AsyncClient, conversation_id: str, body: str) -> dict[str, Any]:
    response = await client.post(
        f"{CONVERSATIONS}/{conversation_id}/messages", json={"body": body}, headers=CSRF
    )
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


async def start(client: httpx.AsyncClient, event_id: str, recipient: uuid.UUID, kind: str) -> str:
    response = await client.post(
        f"{EVENTS}/{event_id}/conversations",
        json={"kind": kind, "recipient_id": str(recipient)},
        headers=CSRF,
    )
    assert response.status_code == 201, response.text
    conversation_id: str = response.json()["id"]
    return conversation_id


async def group_of(db: async_sessionmaker[AsyncSession], event_id: str) -> str:
    async with db() as session:
        found = await session.scalar(
            select(Conversation.id).where(
                Conversation.event_id == uuid.UUID(event_id), Conversation.kind == "group"
            )
        )
    assert found is not None
    return str(found)


@dataclass
class World:
    ids: dict[str, uuid.UUID]
    ana_event: str  # OPEN, hosted by Ana; Dora and Beto joined
    dora_event: str  # OPEN, hosted by Dora; Ana joined; a cover and an item with 2 photos
    dora_event_keys: list[str]
    joined_keys: list[str]  # Dora's photos in Ana's event
    direct: str  # Dora → Ana, named
    anonymous: str  # Dora → Ana, anonymous
    group: str  # Ana's event's group chat


async def world(client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]) -> World:
    for person in (ANA, BETO, CARLA, DORA):
        await login_as(client, *person)
    ids = {p[0]: await user_id(db, p[0]) for p in (ANA, BETO, CARLA, DORA)}
    dora = ids[DORA[0]]

    # Dora hosts an OPEN event with a cover and an item with 2 photos; Ana joined.
    dora_event = (await create(client, name="Cena del barrio"))["id"]
    await add_participant(db, dora_event, ANA[0])
    cover = f"events/{dora_event}/cover.webp"
    async with db() as session:
        event = await session.get(Event, uuid.UUID(dora_event))
        assert event is not None
        event.cover_photo_key = cover
        await session.commit()
    dora_event_keys = [cover, thumb_key(cover), *await add_item(db, dora_event, dora, 2)]

    # Ana hosts an OPEN event that Dora and Beto joined; Dora is in an exclusion.
    await login_as(client, *ANA)
    ana_event = (await create(client, name="Oficina"))["id"]
    await add_participant(db, ana_event, DORA[0])
    await add_participant(db, ana_event, BETO[0])
    excluded = await client.post(
        f"{EVENTS}/{ana_event}/exclusions",
        json={"user_ids": [str(dora), str(ids[BETO[0]])]},
        headers=CSRF,
    )
    assert excluded.status_code == 201, excluded.text
    joined_keys = await add_item(db, ana_event, dora, 1)

    # Dora writes to Ana: named, anonymous, and in the group.
    await login_as(client, *DORA)
    direct = await start(client, ana_event, ids[ANA[0]], "direct")
    anonymous = await start(client, ana_event, ids[ANA[0]], "anonymous")
    group = await group_of(db, ana_event)
    await send(client, direct, "Hola Ana")
    await send(client, anonymous, "¿Qué te gusta?")
    await send(client, group, "Hola a todos")
    await subscribe(db, dora)
    return World(ids, ana_event, dora_event, dora_event_keys, joined_keys, direct, anonymous, group)


async def delete_me(client: httpx.AsyncClient) -> httpx.Response:
    return await client.delete(ME, headers=CSRF)


# ── Blocked ──────────────────────────────────────────────────────────────────


async def drawn_with(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession], host: tuple[str, str]
) -> str:
    """``host`` hosts an event with the other three of Ana/Beto/Carla/Dora, drawn."""
    await login_as(client, *host)
    event_id: str = (await create(client, name="Intercambio sorteado"))["id"]
    for person in (ANA, BETO, CARLA, DORA):
        if person != host:
            await add_participant(db, event_id, person[0])
    drawn = await client.post(f"{EVENTS}/{event_id}/draw", headers=CSRF)
    assert drawn.status_code == 200, drawn.text
    return event_id


async def test_a_drawn_event_blocks_deletion(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    for person in (ANA, BETO, CARLA, DORA):
        await login_as(client, *person)
    event_id = await drawn_with(client, db, ANA)

    await login_as(client, *DORA)
    preview = (await client.get(f"{ME}/deletion-preview")).json()
    assert preview == {
        "blocked": True,
        "blocking_events": [{"id": event_id, "name": "Intercambio sorteado"}],
        "hosted_open_events": [],
    }
    response = await delete_me(client)
    assert (response.status_code, error_code(response)) == (409, "ACCOUNT_IN_ACTIVE_DRAW")
    assert "set-cookie" not in response.headers
    assert (await client.get(ME)).status_code == 200  # still signed in, nothing deleted
    async with db() as session:
        assert await session.scalar(select(func.count()).select_from(Assignment)) == 4


async def test_the_preview_lists_hosted_open_events_with_their_size(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    w = await world(client, db)
    await login_as(client, *DORA)
    preview = (await client.get(f"{ME}/deletion-preview")).json()
    assert preview == {
        "blocked": False,
        "blocking_events": [],
        "hosted_open_events": [
            {"id": w.dora_event, "name": "Cena del barrio", "participant_count": 2}
        ],
    }


async def test_the_preview_needs_a_session(client: httpx.AsyncClient) -> None:
    assert (await client.get(f"{ME}/deletion-preview")).status_code == 401
    assert (await delete_me(client)).status_code == 401


# ── Deleting ─────────────────────────────────────────────────────────────────


async def test_deletion_removes_the_user_and_everything_they_own(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession], arq_pool: ArqRedis
) -> None:
    w = await world(client, db)
    dora = w.ids[DORA[0]]

    await login_as(client, *DORA)
    response = await delete_me(client)
    assert response.status_code == 204, response.text
    for name in ("access_token", "refresh_token"):
        assert cookie_attrs(response, name)["max-age"] == "0"
    assert (await client.get(ME)).status_code == 401

    async with db() as session:

        async def count(model: Any, *where: Any) -> int:
            return await session.scalar(select(func.count()).select_from(model).where(*where)) or 0

        assert await session.get(User, dora) is None
        # Her hosted OPEN event, with everything in it, is gone.
        assert await session.get(Event, uuid.UUID(w.dora_event)) is None
        # Off Ana's roster, her exclusion and her wishlist gone; Ana and Beto stay.
        roster = await session.scalars(
            select(EventParticipant.user_id).where(
                EventParticipant.event_id == uuid.UUID(w.ana_event)
            )
        )
        assert set(roster.all()) == {w.ids[ANA[0]], w.ids[BETO[0]]}
        assert await count(Exclusion) == 0
        assert await count(WishlistItem, WishlistItem.user_id == dora) == 0
        assert await count(PushSubscription) == 0
        assert await count(RefreshToken, RefreshToken.user_id == dora) == 0
        # Her messages keep their rows but lose their bodies.
        bodies = (await session.execute(select(Message.body, Message.deleted_at))).all()
        assert len(bodies) == 3
        assert all(body is None and deleted is not None for body, deleted in bodies)
        # No thread key still names her.
        keys = (await session.scalars(select(Conversation.pair_key))).all()
        assert not any(str(dora) in (key or "") for key in keys)

    # Storage: her event's folder and her photos elsewhere, after the commit.
    jobs = await queued(arq_pool)
    assert ("delete_prefix", (event_prefix(uuid.UUID(w.dora_event)),)) in jobs
    assert set(w.joined_keys) <= await keys_to_delete(arq_pool)
    # Every key of her hosted event lives under the folder that is deleted.
    assert all(key.startswith(event_prefix(uuid.UUID(w.dora_event))) for key in w.dora_event_keys)


async def test_others_see_a_deleted_user_and_the_alias_holds(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    w = await world(client, db)
    dora = w.ids[DORA[0]]
    await login_as(client, *DORA)
    assert (await delete_me(client)).status_code == 204

    await login_as(client, *ANA)
    responses: list[httpx.Response] = []

    async def get(url: str) -> Any:
        response = await client.get(url)
        assert response.status_code == 200, f"{url}: {response.text}"
        responses.append(response)
        return response.json()

    def other(detail: dict[str, Any]) -> dict[str, Any]:
        member: dict[str, Any] = next(m for m in detail["members"] if not m["is_self"])
        return member

    direct = await get(f"{CONVERSATIONS}/{w.direct}")
    assert other(direct) | {"id": None} == {
        "id": None,
        "display_name": "Deleted user",
        "avatar_url": None,
        "is_self": False,
        "is_anonymous": False,
        "anon_number": None,
        "is_former": False,
        "is_deleted": True,
    }
    anonymous = await get(f"{CONVERSATIONS}/{w.anonymous}")
    alias = other(anonymous)
    assert alias["is_anonymous"] is True
    assert alias["display_name"] == f"Secret Elf #{alias['anon_number']}"
    assert (alias["is_former"], alias["is_deleted"]) == (False, False)

    for conversation_id in (w.direct, w.anonymous, w.group):
        page = await get(f"{CONVERSATIONS}/{conversation_id}/messages")
        assert [(m["body"], m["deleted"]) for m in page["items"]] == [(None, True)]
    group = await get(f"{CONVERSATIONS}/{w.group}")
    assert [m["display_name"] for m in group["members"] if m["is_deleted"]] == ["Deleted user"]
    await get(f"{CONVERSATIONS}?event_id={w.ana_event}")
    await get(CONVERSATIONS)
    await get(f"{EVENTS}/{w.ana_event}")
    await get(f"{EVENTS}/{w.ana_event}/participants")

    for response in responses:
        for secret in (str(dora), dora.hex, DORA[0], DORA[1], DORA[1].split()[0]):
            assert secret.lower() not in response.text.lower(), f"{response.url} leaks {secret}"


async def test_archived_events_outlive_their_deleted_host(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession], arq_pool: ArqRedis
) -> None:
    for person in (ANA, BETO, CARLA, DORA):
        await login_as(client, *person)
    event_id = await drawn_with(client, db, DORA)
    dora = await user_id(db, DORA[0])
    keys = await add_item(db, event_id, dora, 1)
    await set_state(db, event_id, "archived")

    await login_as(client, *DORA)
    assert (await client.get(f"{ME}/deletion-preview")).json()["blocked"] is False
    assert (await delete_me(client)).status_code == 204

    async with db() as session:
        event = await session.get(Event, uuid.UUID(event_id))
        assert event is not None
        assert (event.state, event.host_id, event.invite_token) == ("archived", None, None)
        pairs = (
            await session.execute(
                select(Assignment.giver_id, Assignment.receiver_id).where(
                    Assignment.event_id == event.id
                )
            )
        ).all()
        assert len(pairs) == 2  # the two that involved her are gone
        assert all(dora not in pair for pair in pairs)
        assert (
            await session.scalar(
                select(func.count()).select_from(WishlistItem).where(WishlistItem.user_id == dora)
            )
            == 0
        )
        members = (
            await session.scalars(
                select(ConversationMember.account_deleted).where(
                    ConversationMember.event_id == event.id,
                    ConversationMember.user_id.is_(None),
                )
            )
        ).all()
        assert members == [True]  # her group membership
    assert set(keys) <= await keys_to_delete(arq_pool)

    # Everyone else still has it in Past, with "Deleted user" as the host.
    await login_as(client, *ANA)
    detail = (await client.get(f"{EVENTS}/{event_id}")).json()
    assert detail["host"] is None
    assert detail["state"] == "archived"
    past = (await client.get(EVENTS, params={"section": "past"})).json()["items"]
    assert [e["id"] for e in past] == [event_id]


async def test_a_deleted_user_can_sign_up_again_from_scratch(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    w = await world(client, db)
    await login_as(client, *DORA)
    assert (await delete_me(client)).status_code == 204

    await login_as(client, *DORA)
    me = (await client.get(ME)).json()
    assert me["id"] != str(w.ids[DORA[0]])
    assert me["email"] == DORA[0]
    for section in ("hosting", "participating", "past"):
        assert (await client.get(EVENTS, params={"section": section})).json()["items"] == []
    assert (await client.get(CONVERSATIONS)).json()["items"] == []
    # The old threads stay closed to the new account.
    assert (await client.get(f"{CONVERSATIONS}/{w.direct}")).status_code == 404
