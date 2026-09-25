"""The lowest level of push delivery: encrypt and POST one payload to one subscription.

``send_raw`` never raises for a delivery failure. A 404/410 from the push service means
the subscription is gone for good (FR-NTF-9), so the row is deleted. The caller owns the
session and commits. Logs carry the subscription id and status only: the endpoint and keys
are capabilities, and the payload may hold a message preview.
"""

import asyncio
import json
from collections.abc import Callable, Mapping
from typing import Any, Final

from pywebpush import WebPushException, webpush
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.logging import get_logger
from app.db.mixins import utcnow
from app.models.push import PushSubscription

log = get_logger(__name__)

GONE_STATUSES: Final = frozenset({404, 410})
TTL_SECONDS: Final = 24 * 60 * 60  # a push service keeps an undelivered message a day
TIMEOUT_SECONDS: Final = 10

# pywebpush's blocking sender; tests swap it for a fake.
Transport = Callable[..., Any]
transport: Transport = webpush


def _deliver(subscription: PushSubscription, data: str, settings: Settings) -> None:
    transport(
        subscription_info={
            "endpoint": subscription.endpoint,
            "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
        },
        data=data,
        vapid_private_key=settings.vapid_private_key,
        vapid_claims={"sub": settings.vapid_subject},
        ttl=TTL_SECONDS,
        timeout=TIMEOUT_SECONDS,
    )


async def send_raw(
    session: AsyncSession,
    subscription: PushSubscription,
    payload: Mapping[str, Any],
    *,
    settings: Settings | None = None,
) -> bool:
    """Send ``payload`` (``{title, body, tag, url}``, read by ``sw.ts``). True if the push
    service accepted it; False otherwise, after deleting the subscription on 404/410."""
    settings = settings or get_settings()
    if not settings.vapid_private_key:
        log.warning("push_not_configured")
        return False
    data = json.dumps(payload, ensure_ascii=False)
    try:
        await asyncio.to_thread(_deliver, subscription, data, settings)
    except WebPushException as exc:
        status = getattr(exc.response, "status_code", None)
        if status in GONE_STATUSES:
            log.info("push_subscription_gone", subscription_id=str(subscription.id), status=status)
            await session.delete(subscription)
            await session.flush()
        else:
            log.warning("push_failed", subscription_id=str(subscription.id), status=status)
        return False
    except Exception as exc:  # network errors etc.: this device is skipped, not the batch
        log.warning("push_failed", subscription_id=str(subscription.id), error=type(exc).__name__)
        return False
    subscription.last_success_at = utcnow()
    await session.flush()
    return True
