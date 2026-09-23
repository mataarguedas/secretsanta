"""Profile settings (FR-ACC-2)."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.schemas.me import MeUpdate


async def update_me(session: AsyncSession, user: User, changes: MeUpdate) -> User:
    for field, value in changes.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    await session.commit()
    return user
