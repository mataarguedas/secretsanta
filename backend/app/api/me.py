"""The signed-in user's profile and settings (FR-ACC-1/2). ``DELETE /me`` arrives in Prompt 28."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_user, get_db
from app.models.user import User
from app.schemas.me import MeResponse, MeUpdate
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
