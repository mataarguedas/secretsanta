"""Shared helpers for event and invite API tests."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import Event, EventParticipant, User
from app.services.chat import add_group_member
from tests.api.auth_helpers import CSRF

EVENTS = "/api/v1/events"

ANA = ("ana@test.local", "Ana")
BETO = ("beto@test.local", "Beto")
CARLA = ("carla@test.local", "Carla")


def future(days: float = 30) -> str:
    return (datetime.now(UTC) + timedelta(days=days)).isoformat()


def valid_event(**overrides: Any) -> dict[str, Any]:
    return {"name": "Oficina 2026", "budget_crc": 25000, "exchange_at": future(), **overrides}


async def create(client: httpx.AsyncClient, **overrides: Any) -> dict[str, Any]:
    response = await client.post(EVENTS, json=valid_event(**overrides), headers=CSRF)
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


async def user_id(db: async_sessionmaker[AsyncSession], email: str) -> uuid.UUID:
    async with db() as session:
        found = await session.scalar(select(User.id).where(User.email == email))
    assert found is not None
    return found


async def add_participant(db: async_sessionmaker[AsyncSession], event_id: str, email: str) -> None:
    """What a join does, without the invite link: the roster and the group chat."""
    uid = await user_id(db, email)
    async with db() as session:
        session.add(EventParticipant(event_id=uuid.UUID(event_id), user_id=uid))
        await add_group_member(session, uuid.UUID(event_id), uid)
        await session.commit()


async def set_state(db: async_sessionmaker[AsyncSession], event_id: str, state: str) -> None:
    async with db() as session:
        await session.execute(
            update(Event).where(Event.id == uuid.UUID(event_id)).values(state=state)
        )
        await session.commit()


def error_code(response: httpx.Response) -> str:
    code: str = response.json()["error"]["code"]
    return code
