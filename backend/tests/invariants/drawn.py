"""A drawn event with 5 participants, shared by the invariant tests."""

import uuid
from dataclasses import dataclass
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import Assignment, Conversation, ConversationKind
from tests.api.auth_helpers import CSRF, login_as
from tests.api.event_helpers import EVENTS, add_participant, create, user_id

ANA = ("ana@test.local", "Ana")  # the host
PEOPLE = (
    ANA,
    ("beto@test.local", "Beto"),
    ("carla@test.local", "Carla"),
    ("dani@test.local", "Dani"),
    ("eva@test.local", "Eva"),
)
OUTSIDER = ("fede@test.local", "Fede")  # signed up, not in the event


@dataclass
class DrawnEvent:
    event: dict[str, Any]
    invite_token: str
    ids: dict[str, uuid.UUID]  # email → user id
    exclusion_id: str  # created before the draw
    receiver_of: dict[uuid.UUID, uuid.UUID]  # read straight from the DB, test-only
    group_conversation_id: uuid.UUID

    @property
    def id(self) -> str:
        return str(self.event["id"])


async def open_event(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> tuple[dict[str, Any], dict[str, uuid.UUID]]:
    """Ana hosts all of PEOPLE; the event is still OPEN. Ana stays signed in."""
    for person in (*PEOPLE[1:], OUTSIDER, ANA):
        await login_as(client, *person)
    event = await create(client)
    for email, _name in PEOPLE[1:]:
        await add_participant(db, event["id"], email)
    ids = {email: await user_id(db, email) for email, _name in (*PEOPLE, OUTSIDER)}
    return event, ids


async def drawn_event(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> DrawnEvent:
    event, ids = await open_event(client, db)
    carla, dani = ids["carla@test.local"], ids["dani@test.local"]
    exclusions = await client.post(
        f"{EVENTS}/{event['id']}/exclusions",
        json={"user_ids": [str(carla), str(dani)]},
        headers=CSRF,
    )
    assert exclusions.status_code == 201, exclusions.text
    drawn = await client.post(f"{EVENTS}/{event['id']}/draw", headers=CSRF)
    assert drawn.status_code == 200, drawn.text

    async with db() as session:
        rows = await session.scalars(
            select(Assignment).where(Assignment.event_id == uuid.UUID(event["id"]))
        )
        receiver_of = {row.giver_id: row.receiver_id for row in rows.all()}
        group = await session.scalar(
            select(Conversation.id).where(
                Conversation.event_id == uuid.UUID(event["id"]),
                Conversation.kind == ConversationKind.GROUP,
            )
        )
    assert group is not None
    return DrawnEvent(
        event=event,
        invite_token=event["invite_token"],
        ids=ids,
        exclusion_id=exclusions.json()["items"][0]["id"],
        receiver_of=receiver_of,
        group_conversation_id=group,
    )
