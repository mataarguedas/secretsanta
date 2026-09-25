"""Web Push: the VAPID key, my subscriptions (devices), and a dev-only test push.

``dev_router`` (``POST /push/test``) is mounted by ``create_app`` everywhere **except**
production, where the path doesn't exist.
"""

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_user, get_app_settings, get_db, require_own_push_subscription
from app.core.config import Settings
from app.core.errors import AppError
from app.models.push import PushSubscription
from app.models.user import User
from app.schemas.push import PushDevice, PushSubscriptionCreate, VapidPublicKey
from app.services.push import (
    delete_subscription,
    list_subscriptions,
    to_device,
    upsert_subscription,
)

router = APIRouter(prefix="/push", tags=["push"])
dev_router = APIRouter(prefix="/push", tags=["push"])


@router.get("/vapid-public-key", response_model=VapidPublicKey)
async def vapid_public_key(
    _user: User = Depends(current_user), settings: Settings = Depends(get_app_settings)
) -> VapidPublicKey:
    if not (settings.vapid_public_key and settings.vapid_private_key):
        raise AppError("PUSH_NOT_CONFIGURED", 503)
    return VapidPublicKey(public_key=settings.vapid_public_key)


@router.post("/subscriptions", response_model=PushDevice, status_code=status.HTTP_201_CREATED)
async def subscribe(
    body: PushSubscriptionCreate,
    request: Request,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_db),
) -> PushDevice:
    subscription = await upsert_subscription(session, user, body, request.headers.get("user-agent"))
    return to_device(subscription)


@router.get("/subscriptions", response_model=list[PushDevice])
async def my_devices(
    user: User = Depends(current_user), session: AsyncSession = Depends(get_db)
) -> list[PushDevice]:
    return [to_device(s) for s in await list_subscriptions(session, user)]


@router.delete("/subscriptions/{subscription_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_device(
    subscription: PushSubscription = Depends(require_own_push_subscription),
    session: AsyncSession = Depends(get_db),
) -> Response:
    await delete_subscription(session, subscription)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@dev_router.post("/test", status_code=status.HTTP_202_ACCEPTED)
async def send_test_push(request: Request, user: User = Depends(current_user)) -> Response:
    """Queue a "Test notification" to all my devices (sent by the worker, never inline)."""
    await request.app.state.arq.enqueue_job("send_test_notification", str(user.id))
    return Response(status_code=status.HTTP_202_ACCEPTED)
