"""The signed-in user's profile, settings and account deletion (FR-ACC-1/2/3)."""

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.cookies import clear_session_cookies
from app.api.deps import current_user, get_app_settings, get_db
from app.core.config import Settings
from app.models.user import User
from app.schemas.me import DeletionPreviewOut, MeResponse, MeUpdate
from app.services import account as account_service
from app.services.account import DeletionPreview
from app.services.users import update_me

router = APIRouter(prefix="/me", tags=["me"])


@router.get("", response_model=MeResponse)
async def get_me(user: User = Depends(current_user)) -> User:
    return user


@router.patch("", response_model=MeResponse)
async def patch_me(
    changes: MeUpdate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_db),
) -> User:
    return await update_me(session, user, changes)


@router.get("/deletion-preview", response_model=DeletionPreviewOut)
async def deletion_preview(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_db),
) -> DeletionPreview:
    """What ``DELETE /me`` would do: blocked by DRAWN events, or which hosted OPEN events
    go with the account."""
    return await account_service.deletion_preview(session, user)


@router.delete("", status_code=204)
async def delete_me(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
) -> Response:
    """FR-ACC-3: 409 ``ACCOUNT_IN_ACTIVE_DRAW`` while in a DRAWN event; otherwise the
    account and its data go in one transaction, and the session cookies are cleared."""
    await account_service.delete_account(session, user)
    response = Response(status_code=204)
    clear_session_cookies(response, settings)
    return response
