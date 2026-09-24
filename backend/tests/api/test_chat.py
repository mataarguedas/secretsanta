"""Chat REST API (Prompt 21, PRD §4.7)."""

import uuid
from typing import Any

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import Conversation, ConversationMember, Message
from app.services import chat as chat_service
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

API = "/api/v1"
DANI = ("dani@test.local", "Dani")  # has an account, not in the event


async def setup_event(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession], **overrides: Any
) -> dict[str, Any]:
    """Ana hosts Beto and Carla. Ana stays signed in."""
    for person in (BETO, CARLA, DANI, ANA):
        await login_as(client, *person)
    event = await create(client, **overrides)
    for person in (BETO, CARLA):
        await add_participant(db, event["id"], person[0])
    return event


async def start(
    client: httpx.AsyncClient, event: dict[str, Any], recipient: uuid.UUID, kind: str
) -> httpx.Response:
    return await client.post(
        f"{EVENTS}/{event['id']}/conversations",
        json={"kind": kind, "recipient_id": str(recipient)},
        headers=CSRF,
    )


async def send(client: httpx.AsyncClient, conversation_id: str, body: str) -> httpx.Response:
    return await client.post(
        f"{API}/conversations/{conversation_id}/messages", json={"body": body}, headers=CSRF
    )


async def conversations(client: httpx.AsyncClient, **params: str) -> list[dict[str, Any]]:
    response = await client.get(f"{API}/conversations", params=params)
    assert response.status_code == 200, response.text
    items: list[dict[str, Any]] = response.json()["items"]
    return items


def by_kind(items: list[dict[str, Any]], kind: str) -> list[dict[str, Any]]:
    return [item for item in items if item["kind"] == kind]


# ── Starting conversations ───────────────────────────────────────────────────


async def test_start_is_idempotent_and_direct_and_anonymous_coexist(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await setup_event(client, db)
    beto = await user_id(db, BETO[0])

    first = await start(client, event, beto, "anonymous")
    assert first.status_code == 201, first.text
    again = await start(client, event, beto, "anonymous")
    assert again.status_code == 200
    assert again.json()["id"] == first.json()["id"]

    body = first.json()
    assert body["kind"] == "anonymous"
    assert body["my_member"]["is_anonymous"] is True
    assert body["my_member"]["is_self"] is True
    assert 1 <= body["my_member"]["anon_number"] <= 999
    assert body["title_member"]["display_name"] == "Beto"
    assert body["event"] == {"id": event["id"], "name": event["name"], "state": "open"}
    assert body["unread_count"] == 0
    assert body["last_message"] is None
    assert "pair_key" not in first.text

    direct = await start(client, event, beto, "direct")
    assert direct.status_code == 201
    assert direct.json()["id"] != body["id"]
    assert direct.json()["my_member"]["display_name"] == "Ana"

    # The direct thread is one per pair, whoever starts it.
    await login_as(client, *BETO)
    from_beto = await start(client, event, await user_id(db, ANA[0]), "direct")
    assert from_beto.status_code == 200
    assert from_beto.json()["id"] == direct.json()["id"]
    # An anonymous thread is per (initiator, recipient): Beto → Ana is a different one.
    anon_back = await start(client, event, await user_id(db, ANA[0]), "anonymous")
    assert anon_back.status_code == 201
    assert anon_back.json()["id"] != body["id"]


async def test_two_threads_from_the_same_initiator_get_different_numbers(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await setup_event(client, db)
    to_beto = (await start(client, event, await user_id(db, BETO[0]), "anonymous")).json()
    to_carla = (await start(client, event, await user_id(db, CARLA[0]), "anonymous")).json()
    assert to_beto["my_member"]["anon_number"] != to_carla["my_member"]["anon_number"]
    assert to_beto["my_member"]["id"] != to_carla["my_member"]["id"]


async def test_anon_numbers_are_random_and_unique_per_event(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A taken number is never reused, even when ``secrets`` would pick it."""
    picks: list[list[int]] = []

    def smallest(free: list[int]) -> int:
        picks.append(free)
        return free[0]

    monkeypatch.setattr(chat_service.secrets, "choice", smallest)
    event = await setup_event(client, db)
    a = (await start(client, event, await user_id(db, BETO[0]), "anonymous")).json()
    b = (await start(client, event, await user_id(db, CARLA[0]), "anonymous")).json()
    assert (a["my_member"]["anon_number"], b["my_member"]["anon_number"]) == (1, 2)
    assert 1 not in picks[1]


async def test_start_refusals(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await setup_event(client, db)
    ana = await user_id(db, ANA[0])
    dani = await user_id(db, DANI[0])

    myself = await start(client, event, ana, "direct")
    assert (myself.status_code, error_code(myself)) == (422, "CONVERSATION_WITH_SELF")
    outsider = await start(client, event, dani, "anonymous")
    assert (outsider.status_code, error_code(outsider)) == (404, "PARTICIPANT_NOT_FOUND")
    group = await client.post(
        f"{EVENTS}/{event['id']}/conversations",
        json={"kind": "group", "recipient_id": str(dani)},
        headers=CSRF,
    )
    assert group.status_code == 422

    await login_as(client, *DANI)
    not_in_event = await start(client, event, ana, "direct")
    assert (not_in_event.status_code, error_code(not_in_event)) == (404, "EVENT_NOT_FOUND")

    await login_as(client, *ANA)
    await set_state(db, event["id"], "archived")
    archived = await start(client, event, await user_id(db, BETO[0]), "direct")
    assert (archived.status_code, error_code(archived)) == (409, "EVENT_ARCHIVED")


# ── Group conversation ───────────────────────────────────────────────────────


async def test_group_follows_the_roster_and_the_flag(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await setup_event(client, db)
    (group,) = by_kind(await conversations(client, event_id=event["id"]), "group")
    assert group["title_member"] is None
    detail = (await client.get(f"{API}/conversations/{group['id']}")).json()
    assert sorted(m["display_name"] for m in detail["members"]) == ["Ana", "Beto", "Carla"]

    # Joining through the link adds Dani.
    await login_as(client, *DANI)
    joined = await client.post(f"{API}/invites/{event['invite_token']}/join", headers=CSRF)
    assert joined.status_code == 200, joined.text
    assert (await send(client, group["id"], "¡Hola!")).status_code == 201

    # Leaving detaches her: she loses access, her message stays from a former member.
    left = await client.post(f"{EVENTS}/{event['id']}/leave", headers=CSRF)
    assert left.status_code == 204
    gone = await client.get(f"{API}/conversations/{group['id']}")
    assert (gone.status_code, error_code(gone)) == (404, "CONVERSATION_NOT_FOUND")
    assert await conversations(client) == []

    await login_as(client, *ANA)
    detail = (await client.get(f"{API}/conversations/{group['id']}")).json()
    former = [m for m in detail["members"] if m["is_former"]]
    assert [m["display_name"] for m in former] == ["Former participant"]
    messages = (await client.get(f"{API}/conversations/{group['id']}/messages")).json()
    assert messages["items"][0]["sender_member_id"] == former[0]["id"]
    assert messages["items"][0]["body"] == "¡Hola!"

    # Host removes Carla: also out of the group.
    carla = await user_id(db, CARLA[0])
    await client.delete(f"{EVENTS}/{event['id']}/participants/{carla}", headers=CSRF)
    detail = (await client.get(f"{API}/conversations/{group['id']}")).json()
    assert sorted(m["display_name"] for m in detail["members"] if not m["is_former"]) == [
        "Ana",
        "Beto",
    ]

    # Turning the group chat off deletes it; back on, it's new with the current roster.
    off = await client.patch(
        f"{EVENTS}/{event['id']}", json={"group_chat_enabled": False}, headers=CSRF
    )
    assert off.status_code == 200, off.text
    assert by_kind(await conversations(client), "group") == []
    async with db() as session:
        assert await session.get(Conversation, uuid.UUID(group["id"])) is None
    await client.patch(f"{EVENTS}/{event['id']}", json={"group_chat_enabled": True}, headers=CSRF)
    (new_group,) = by_kind(await conversations(client), "group")
    assert new_group["id"] != group["id"]
    detail = (await client.get(f"{API}/conversations/{new_group['id']}")).json()
    assert sorted(m["display_name"] for m in detail["members"]) == ["Ana", "Beto"]


async def test_an_event_without_group_chat_has_no_group(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    await setup_event(client, db, group_chat_enabled=False)
    assert await conversations(client) == []


async def test_list_is_scoped_sorted_and_paginated(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(chat_service, "CONVERSATION_PAGE", 2)
    event = await setup_event(client, db)
    other = await create(client, name="Otra fiesta")
    (group,) = by_kind(await conversations(client, event_id=event["id"]), "group")
    direct = (await start(client, event, await user_id(db, BETO[0]), "direct")).json()
    await send(client, group["id"], "primero")
    await send(client, direct["id"], "segundo")

    first = (await client.get(f"{API}/conversations")).json()
    assert [c["id"] for c in first["items"]] == [direct["id"], group["id"]]
    assert first["next_cursor"]
    rest = await client.get(f"{API}/conversations", params={"cursor": first["next_cursor"]})
    (last,) = rest.json()["items"]
    assert last["event"]["id"] == other["id"]
    assert rest.json()["next_cursor"] is None

    only = await conversations(client, event_id=other["id"])
    assert [c["event"]["name"] for c in only] == ["Otra fiesta"]
    bad = await client.get(f"{API}/conversations", params={"cursor": "nope"})
    assert bad.status_code == 422


# ── Messages ─────────────────────────────────────────────────────────────────


async def test_send_read_and_unread(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await setup_event(client, db)
    direct = (await start(client, event, await user_id(db, BETO[0]), "direct")).json()

    sent = await send(client, direct["id"], "  ¿Qué talla usás?  ")
    assert sent.status_code == 201, sent.text
    message = sent.json()
    assert message["body"] == "¿Qué talla usás?"
    assert message["deleted"] is False
    assert message["sender_member_id"] == direct["my_member"]["id"]
    assert set(message) == {
        "id",
        "conversation_id",
        "sender_member_id",
        "body",
        "deleted",
        "created_at",
    }
    await send(client, direct["id"], "otra")
    mine = by_kind(await conversations(client), "direct")[0]
    assert mine["unread_count"] == 0  # my own messages are never unread
    assert mine["last_message"]["body"] == "otra"

    await login_as(client, *BETO)
    theirs = by_kind(await conversations(client), "direct")[0]
    assert theirs["unread_count"] == 2
    assert theirs["last_message_at"] is not None
    read = await client.post(f"{API}/conversations/{direct['id']}/read", headers=CSRF)
    assert read.status_code == 204
    assert by_kind(await conversations(client), "direct")[0]["unread_count"] == 0
    # No read state of the other person anywhere.
    detail = await client.get(f"{API}/conversations/{direct['id']}")
    assert "last_read" not in detail.text


@pytest.mark.parametrize("body", ["", "   ", "x" * 2001])
async def test_message_length_is_1_to_2000_after_trimming(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession], body: str
) -> None:
    await setup_event(client, db)
    (group,) = by_kind(await conversations(client), "group")
    response = await send(client, group["id"], body)
    assert response.status_code == 422
    assert (await send(client, group["id"], "x" * 2000)).status_code == 201


async def test_history_is_newest_first_and_paginated(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(chat_service, "MESSAGE_PAGE", 3)
    await setup_event(client, db)
    (group,) = by_kind(await conversations(client), "group")
    for n in range(7):
        await send(client, group["id"], f"m{n}")

    seen: list[str] = []
    cursor = None
    pages = 0
    while True:
        params = {"cursor": cursor} if cursor else {}
        page = (
            await client.get(f"{API}/conversations/{group['id']}/messages", params=params)
        ).json()
        seen += [m["body"] for m in page["items"]]
        pages += 1
        cursor = page["next_cursor"]
        if not cursor:
            break
    assert seen == [f"m{n}" for n in reversed(range(7))]
    assert pages == 3


async def test_only_the_sender_can_delete_and_it_leaves_a_placeholder(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await setup_event(client, db)
    direct = (await start(client, event, await user_id(db, BETO[0]), "direct")).json()
    message = (await send(client, direct["id"], "borrame")).json()

    await login_as(client, *BETO)
    theirs = await client.delete(f"{API}/messages/{message['id']}", headers=CSRF)
    assert (theirs.status_code, error_code(theirs)) == (404, "MESSAGE_NOT_FOUND")
    assert by_kind(await conversations(client), "direct")[0]["unread_count"] == 1

    await login_as(client, *ANA)
    assert (await client.delete(f"{API}/messages/{message['id']}", headers=CSRF)).status_code == 204
    assert (await client.delete(f"{API}/messages/{message['id']}", headers=CSRF)).status_code == 204
    history = (await client.get(f"{API}/conversations/{direct['id']}/messages")).json()
    assert history["items"][0] | {"created_at": None} == {
        "id": message["id"],
        "conversation_id": direct["id"],
        "sender_member_id": message["sender_member_id"],
        "body": None,
        "deleted": True,
        "created_at": None,
    }
    async with db() as session:
        row = await session.get(Message, uuid.UUID(message["id"]))
        assert row is not None
        assert row.body is None
        assert row.deleted_at is not None

    await login_as(client, *BETO)
    assert by_kind(await conversations(client), "direct")[0]["unread_count"] == 0
    missing = await client.delete(f"{API}/messages/{uuid.uuid4()}", headers=CSRF)
    assert missing.status_code == 404


async def test_sending_is_rate_limited_to_30_per_minute(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    await setup_event(client, db)
    (group,) = by_kind(await conversations(client), "group")
    for n in range(30):
        assert (await send(client, group["id"], f"m{n}")).status_code == 201
    limited = await send(client, group["id"], "m30")
    assert (limited.status_code, error_code(limited)) == (429, "RATE_LIMITED")

    await login_as(client, *BETO)  # per user, not global
    assert (await send(client, group["id"], "hola")).status_code == 201


async def test_archived_chats_are_read_only(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await setup_event(client, db)
    (group,) = by_kind(await conversations(client), "group")
    message = (await send(client, group["id"], "antes")).json()
    await set_state(db, event["id"], "archived")

    for response in (
        await send(client, group["id"], "después"),
        await client.delete(f"{API}/messages/{message['id']}", headers=CSRF),
        await client.post(f"{API}/conversations/{group['id']}/read", headers=CSRF),
    ):
        assert (response.status_code, error_code(response)) == (409, "CONVERSATION_READ_ONLY")
    history = await client.get(f"{API}/conversations/{group['id']}/messages")
    assert [m["body"] for m in history.json()["items"]] == ["antes"]
    assert (await client.get(f"{API}/conversations/{group['id']}")).status_code == 200


async def test_drawn_chats_stay_writable(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await setup_event(client, db)
    await set_state(db, event["id"], "drawn")
    (group,) = by_kind(await conversations(client), "group")
    assert (await send(client, group["id"], "¡Ya salió!")).status_code == 201
    beto = await user_id(db, BETO[0])
    assert (await start(client, event, beto, "anonymous")).status_code == 201


async def test_non_members_get_404_everywhere(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await setup_event(client, db)
    direct = (await start(client, event, await user_id(db, BETO[0]), "direct")).json()
    message = (await send(client, direct["id"], "privado")).json()

    for person in (CARLA, DANI):  # in the event but not the thread; not in the event
        await login_as(client, *person)
        for response in (
            await client.get(f"{API}/conversations/{direct['id']}"),
            await client.get(f"{API}/conversations/{direct['id']}/messages"),
            await send(client, direct["id"], "hola"),
            await client.post(f"{API}/conversations/{direct['id']}/read", headers=CSRF),
        ):
            assert (response.status_code, error_code(response)) == (
                404,
                "CONVERSATION_NOT_FOUND",
            )
        gone = await client.delete(f"{API}/messages/{message['id']}", headers=CSRF)
        assert gone.status_code == 404
    client.cookies.clear()
    assert (await client.get(f"{API}/conversations")).status_code == 401


async def test_an_anonymous_thread_appears_to_its_recipient_only_with_a_message(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    """So the recipient never learns when it was opened (FR-CHT-3)."""
    event = await setup_event(client, db)
    anon = (await start(client, event, await user_id(db, BETO[0]), "anonymous")).json()
    assert by_kind(await conversations(client), "anonymous")  # the initiator sees it

    await login_as(client, *BETO)
    assert by_kind(await conversations(client), "anonymous") == []

    await login_as(client, *ANA)
    await send(client, anon["id"], "¿Qué te gusta?")
    await login_as(client, *BETO)
    (seen,) = by_kind(await conversations(client), "anonymous")
    assert seen["title_member"]["display_name"] == anon["my_member"]["display_name"]
    assert seen["title_member"]["is_anonymous"] is True
    assert seen["unread_count"] == 1


async def test_a_leaver_keeps_direct_threads_but_cannot_use_them(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event = await setup_event(client, db)
    beto = await user_id(db, BETO[0])
    direct = (await start(client, event, beto, "direct")).json()
    await login_as(client, *BETO)
    assert (await client.post(f"{EVENTS}/{event['id']}/leave", headers=CSRF)).status_code == 204
    assert (await client.get(f"{API}/conversations/{direct['id']}")).status_code == 404

    async with db() as session:  # the thread and its member row are still there
        member = await session.scalar(
            select(ConversationMember).where(
                ConversationMember.conversation_id == uuid.UUID(direct["id"]),
                ConversationMember.user_id == beto,
            )
        )
        assert member is not None
