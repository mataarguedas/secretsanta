"""Test helpers for the notify pipeline.

``PushSpy`` replaces pywebpush: every push the worker would send is recorded as
``(user_id, payload)``, the user being recovered from the fake endpoint. ``run_jobs`` runs
what the API queued on arq through the real task functions, the way the worker would.
"""

import json
import uuid
from dataclasses import dataclass, field
from typing import Any

import pytest
from arq.connections import ArqRedis
from pywebpush import WebPushException
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import get_settings
from app.models import PushSubscription
from app.notifications import webpush
from app.scripts.gen_vapid_keys import generate_vapid_keys
from app.worker.settings import WorkerSettings

ENDPOINT_PREFIX = "https://fcm.googleapis.com/fcm/send/"


class _Gone:
    def __init__(self, status_code: int) -> None:
        self.status_code = status_code


@dataclass
class PushSpy:
    sent: list[tuple[uuid.UUID, dict[str, Any]]] = field(default_factory=list)
    # Endpoints answered with this status instead of 201 (e.g. 410 = unsubscribed).
    failures: dict[str, int] = field(default_factory=dict)

    def __call__(self, **kwargs: Any) -> None:
        endpoint: str = kwargs["subscription_info"]["endpoint"]
        if endpoint in self.failures:
            raise WebPushException("push failed", response=_Gone(self.failures[endpoint]))
        user = uuid.UUID(endpoint.removeprefix(ENDPOINT_PREFIX).split("/")[0])
        self.sent.append((user, json.loads(kwargs["data"])))

    def to(self, user_id: uuid.UUID) -> list[dict[str, Any]]:
        return [payload for user, payload in self.sent if user == user_id]

    @property
    def recipients(self) -> list[uuid.UUID]:
        return [user for user, _payload in self.sent]


@pytest.fixture
def push_spy(monkeypatch: pytest.MonkeyPatch) -> PushSpy:
    spy = PushSpy()
    public, private = generate_vapid_keys()
    settings = get_settings().model_copy(
        update={"vapid_public_key": public, "vapid_private_key": private}
    )
    monkeypatch.setattr(webpush, "transport", spy)
    monkeypatch.setattr(webpush, "get_settings", lambda: settings)
    return spy


def endpoint_for(user_id: uuid.UUID, device: str = "phone") -> str:
    return f"{ENDPOINT_PREFIX}{user_id}/{device}"


async def subscribe(
    db: async_sessionmaker[AsyncSession], *user_ids: uuid.UUID, device: str = "phone"
) -> None:
    async with db() as session:
        session.add_all(
            PushSubscription(user_id=uid, endpoint=endpoint_for(uid, device), p256dh="k", auth="a")
            for uid in user_ids
        )
        await session.commit()


TASKS = {fn.__name__: fn for fn in WorkerSettings.functions}


async def queued(pool: ArqRedis) -> list[tuple[str, tuple[Any, ...]]]:
    return [(job.function, job.args) for job in await pool.queued_jobs()]


async def run_jobs(
    pool: ArqRedis, db: async_sessionmaker[AsyncSession], redis: Redis, *only: str
) -> list[tuple[str, tuple[Any, ...]]]:
    """Run the queued jobs (only the named functions, if given) and empty the queue."""
    jobs = await queued(pool)
    ctx = {"sessionmaker": db, "app_redis": redis}
    for function, args in jobs:
        if not only or function in only:
            await TASKS[function](ctx, *args)
    for key in await pool.keys("arq:*"):
        await pool.delete(key)
    return jobs
