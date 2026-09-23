"""Invite preview and join by token (PRD §4.3, §8)."""

from typing import Annotated

from fastapi import APIRouter, Depends, Path
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_user, get_db
from app.models.user import User
from app.schemas.invites import InvitePreview, JoinResult
from app.services import invites as service

router = APIRouter(prefix="/invites", tags=["invites"])

Token = Annotated[str, Path(max_length=service.MAX_TOKEN_LENGTH)]


@router.get("/{token}", response_model=InvitePreview)
async def preview_invite(
    token: Token,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_db),
) -> InvitePreview:
    return await service.preview_invite(session, token, user)


@router.post("/{token}/join", response_model=JoinResult)
async def join_event(
    token: Token,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_db),
) -> JoinResult:
    return await service.join_event(session, token, user)
