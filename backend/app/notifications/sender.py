"""``notify(session, user_ids, kind, context)``: the one way a product push goes out.

Called from arq tasks only, never inline in a request (CLAUDE.md §7). For each recipient:
check the preference for ``kind``, render the text in **their** locale, send to every one
of their subscriptions (``send_raw`` deletes 404/410 ones and stamps ``last_success_at``),
then commit. Logs carry the kind and counts only: never bodies, titles, user ids or
anything about an anonymous sender.
"""

import uuid
from collections import Counter
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from typing import Any, Final, Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.logging import get_logger
from app.models.push import PushSubscription
from app.models.user import User
from app.notifications.templates import render
from app.notifications.webpush import send_raw

log = get_logger(__name__)

Kind = Literal["test", "reveal", "message", "wishlist_updated", "exchange_reminder"]

# The user preference that gates each kind; None = always on (FR-NTF-3).
PREFERENCES: Final[dict[str, str | None]] = {
    "test": None,
    "reveal": None,
    "message": "notify_message",
    "wishlist_updated": "notify_wishlist",
    "exchange_reminder": "notify_reminder",
}

# ``context`` keys that shape the payload rather than the text.
URL: Final = "url"
TAG: Final = "tag"

Context = Mapping[str, Any]


@dataclass(frozen=True, slots=True)
class NotifyResult:
    recipients: int = 0  # users with the preference on
    opted_out: int = 0
    sent: int = 0  # subscriptions that accepted the push
    failed: int = 0


def wants(user: User, kind: str) -> bool:
    preference = PREFERENCES[kind]
    return preference is None or bool(getattr(user, preference))


def build_payload(kind: str, user: User, context: Context) -> dict[str, Any]:
    """``{title, body, tag?, url}`` for ``sw.ts``, in the recipient's locale."""
    params = {k: v for k, v in context.items() if k not in (URL, TAG)}
    text = render(kind, user.locale, **params)
    payload: dict[str, Any] = {"title": text.title, "body": text.body, "url": context[URL]}
    if context.get(TAG):
        payload["tag"] = context[TAG]
    return payload


async def notify(
    session: AsyncSession,
    user_ids: Iterable[uuid.UUID],
    kind: Kind,
    context: Context | Callable[[User], Context],
    *,
    settings: Settings | None = None,
) -> NotifyResult:
    """``context`` holds the template params plus ``url`` (and optional ``tag``), or is a
    function of the recipient when their text differs (e.g. a per-viewer sender name)."""
    ids = set(user_ids)
    if not ids:
        return NotifyResult()
    users = list(await session.scalars(select(User).where(User.id.in_(ids))))
    wanted = [u for u in users if wants(u, kind)]
    by_user: dict[uuid.UUID, list[PushSubscription]] = {u.id: [] for u in wanted}
    if wanted:
        for subscription in await session.scalars(
            select(PushSubscription).where(PushSubscription.user_id.in_(by_user))
        ):
            by_user[subscription.user_id].append(subscription)

    outcomes: Counter[bool] = Counter()
    for user in wanted:
        if not by_user[user.id]:
            continue
        payload = build_payload(kind, user, context(user) if callable(context) else context)
        for subscription in by_user[user.id]:
            outcomes[await send_raw(session, subscription, payload, settings=settings)] += 1
    await session.commit()

    result = NotifyResult(
        recipients=len(wanted),
        opted_out=len(users) - len(wanted),
        sent=outcomes[True],
        failed=outcomes[False],
    )
    log.info(
        "notify",
        kind=kind,
        recipients=result.recipients,
        opted_out=result.opted_out,
        sent=result.sent,
        failed=result.failed,
    )
    return result
