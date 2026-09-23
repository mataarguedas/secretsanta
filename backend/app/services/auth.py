"""Sign-in and session business rules (PRD §4.1, CLAUDE.md §7 Auth)."""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Final, Literal

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.logging import get_logger
from app.core.security import (
    REFRESH_TOKEN_TTL,
    create_access_token,
    hash_token,
    new_refresh_token,
)
from app.models.refresh_token import RefreshToken
from app.models.user import DEFAULT_LOCALE, User
from app.services.google_oauth import GoogleProfile

log = get_logger(__name__)

# A token rotated this recently may be presented once more by a parallel request from another
# tab (both sent the old cookie). That is answered without new tokens instead of being
# treated as theft; the browser already holds the replacement from the first response.
ROTATION_GRACE: Final = timedelta(seconds=30)
USER_AGENT_MAX: Final = 512


@dataclass(frozen=True)
class SessionTokens:
    access_token: str
    refresh_token: str


@dataclass(frozen=True)
class RefreshOutcome:
    status: Literal["rotated", "concurrent", "invalid"]
    tokens: SessionTokens | None = None


def locale_from_accept_language(header: str | None) -> str:
    """First sign-in locale (FR-AUTH-2): ``en`` if the header starts with ``en``, else ``es``."""
    return "en" if (header or "").strip().lower().startswith("en") else DEFAULT_LOCALE


async def upsert_google_user(
    session: AsyncSession, profile: GoogleProfile, accept_language: str | None
) -> User:
    """Find the user by Google ``sub`` (or, failing that, by verified email) and refresh the
    profile fields; create it on first sign-in. The locale is only set on creation."""
    user = await session.scalar(select(User).where(User.google_sub == profile.sub))
    if user is None:
        # Same verified address, new sub (e.g. a test-login user): link instead of failing
        # on the unique email. Google has verified the address, so it proves ownership.
        user = await session.scalar(select(User).where(User.email == profile.email))
    if user is None:
        user = User(
            google_sub=profile.sub,
            email=profile.email,
            name=profile.name,
            avatar_url=profile.picture,
            locale=locale_from_accept_language(accept_language),
        )
        session.add(user)
        log.info("user_created", provider="google")
    else:
        user.google_sub = profile.sub
        user.email = profile.email
        user.name = profile.name
        user.avatar_url = profile.picture
    await session.flush()
    return user


async def issue_session(
    session: AsyncSession,
    user_id: uuid.UUID,
    settings: Settings,
    user_agent: str | None,
    now: datetime | None = None,
) -> tuple[SessionTokens, RefreshToken]:
    """Create a refresh-token row and a matching access token. The caller commits."""
    now = now or datetime.now(UTC)
    raw = new_refresh_token()
    row = RefreshToken(
        user_id=user_id,
        token_hash=hash_token(raw),
        expires_at=now + REFRESH_TOKEN_TTL,
        user_agent=(user_agent or "")[:USER_AGENT_MAX] or None,
    )
    session.add(row)
    await session.flush()
    tokens = SessionTokens(
        access_token=create_access_token(user_id, settings, now), refresh_token=raw
    )
    return tokens, row


async def _revoke_all(session: AsyncSession, user_id: uuid.UUID, now: datetime) -> None:
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=now)
    )


async def rotate_refresh_token(
    session: AsyncSession,
    raw_token: str | None,
    settings: Settings,
    user_agent: str | None,
    now: datetime | None = None,
) -> RefreshOutcome:
    """Refresh rotation with reuse detection. Commits its own changes."""
    now = now or datetime.now(UTC)
    if not raw_token:
        return RefreshOutcome("invalid")

    # Row lock: two refreshes with the same token serialize here, so only one rotates.
    row = await session.scalar(
        select(RefreshToken)
        .where(RefreshToken.token_hash == hash_token(raw_token))
        .with_for_update()
    )
    if row is None:
        return RefreshOutcome("invalid")

    if row.revoked_at is not None:
        if row.replaced_by_id is not None and now - row.revoked_at <= ROTATION_GRACE:
            return RefreshOutcome("concurrent")
        # A revoked token came back: assume it was stolen and end every session of this user.
        await _revoke_all(session, row.user_id, now)
        await session.commit()
        log.warning("refresh_token_reuse_detected", user_id=str(row.user_id))
        return RefreshOutcome("invalid")

    if row.expires_at <= now:
        return RefreshOutcome("invalid")

    tokens, replacement = await issue_session(session, row.user_id, settings, user_agent, now)
    row.revoked_at = now
    row.replaced_by_id = replacement.id
    await session.commit()
    return RefreshOutcome("rotated", tokens)


async def revoke_refresh_token(
    session: AsyncSession, raw_token: str | None, now: datetime | None = None
) -> None:
    """Logout (FR-AUTH-4). Unknown or already-revoked tokens are ignored."""
    if not raw_token:
        return
    await session.execute(
        update(RefreshToken)
        .where(
            RefreshToken.token_hash == hash_token(raw_token),
            RefreshToken.revoked_at.is_(None),
        )
        .values(revoked_at=now or datetime.now(UTC))
    )
    await session.commit()
