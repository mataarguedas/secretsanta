"""Push subscriptions: upsert by endpoint, list my devices, remove one (FR-NTF-10, FR-ACC-2)."""

import re
from typing import Final

from sqlalchemy import case, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.uuid7 import uuid7
from app.models.push import PushSubscription
from app.models.user import User
from app.schemas.push import PushDevice, PushSubscriptionCreate

# First match wins, so the more specific tokens come first: Edge, Samsung and Opera all
# also say "Chrome", and every iOS browser says "Safari".
_BROWSERS: Final[tuple[tuple[str, str], ...]] = (
    (r"EdgA?/|EdgiOS/", "Edge"),
    (r"SamsungBrowser/", "Samsung Internet"),
    (r"OPR/|Opera", "Opera"),
    (r"Firefox/|FxiOS/", "Firefox"),
    (r"Chrome/|CriOS/|Chromium/", "Chrome"),
    (r"Safari/", "Safari"),
)
_SYSTEMS: Final[tuple[tuple[str, str], ...]] = (
    (r"iPhone", "iPhone"),
    (r"iPad", "iPad"),
    (r"Android", "Android"),
    (r"Windows", "Windows"),
    (r"CrOS", "ChromeOS"),
    (r"Macintosh|Mac OS X", "macOS"),
    (r"Linux", "Linux"),
)


def _first(patterns: tuple[tuple[str, str], ...], user_agent: str) -> str | None:
    return next((name for pattern, name in patterns if re.search(pattern, user_agent)), None)


def describe_user_agent(user_agent: str | None) -> tuple[str | None, str | None]:
    """``(browser, os)``, e.g. ``("Chrome", "Windows")``; ``None`` for what isn't recognized."""
    if not user_agent:
        return None, None
    return _first(_BROWSERS, user_agent), _first(_SYSTEMS, user_agent)


def to_device(subscription: PushSubscription) -> PushDevice:
    browser, system = describe_user_agent(subscription.user_agent)
    return PushDevice(
        id=subscription.id,
        browser=browser,
        os=system,
        created_at=subscription.created_at,
        last_success_at=subscription.last_success_at,
    )


async def upsert_subscription(
    session: AsyncSession, user: User, data: PushSubscriptionCreate, fallback_user_agent: str | None
) -> PushSubscription:
    """Store the subscription, or take over the existing row for the same endpoint: the
    browser is now this user's device (e.g. after signing in with another account)."""
    table = PushSubscription.__table__
    values = {
        "user_id": user.id,
        "endpoint": data.endpoint,
        "p256dh": data.keys.p256dh,
        "auth": data.keys.auth,
        "user_agent": (data.user_agent or fallback_user_agent or "")[:512] or None,
    }
    stmt = insert(PushSubscription).values(id=uuid7(), **values)
    upsert = stmt.on_conflict_do_update(
        index_elements=[table.c.endpoint],
        set_={
            **{key: stmt.excluded[key] for key in ("user_id", "p256dh", "auth", "user_agent")},
            # A device that changes hands starts without the old owner's delivery history.
            "last_success_at": case(
                (table.c.user_id == stmt.excluded.user_id, table.c.last_success_at), else_=None
            ),
            "updated_at": func.now(),
        },
    ).returning(PushSubscription.id)
    subscription_id = await session.scalar(upsert)
    await session.commit()
    subscription = await session.get(PushSubscription, subscription_id, populate_existing=True)
    assert subscription is not None  # noqa: S101 - just upserted
    return subscription


async def list_subscriptions(session: AsyncSession, user: User) -> list[PushSubscription]:
    rows = await session.scalars(
        select(PushSubscription)
        .where(PushSubscription.user_id == user.id)
        .order_by(PushSubscription.created_at.desc(), PushSubscription.id.desc())
    )
    return list(rows)


async def delete_subscription(session: AsyncSession, subscription: PushSubscription) -> None:
    await session.delete(subscription)
    await session.commit()
