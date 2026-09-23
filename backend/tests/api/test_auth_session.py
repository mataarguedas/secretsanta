"""Refresh rotation, reuse detection and logout."""

from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.security import hash_token
from app.models import RefreshToken
from tests.api.auth_helpers import CSRF, cookie_attrs, cookie_value, login_as, set_cookies

REFRESH = "/api/v1/auth/refresh"
LOGOUT = "/api/v1/auth/logout"


async def counts(db: async_sessionmaker[AsyncSession]) -> tuple[int, int]:
    """(total refresh tokens, revoked refresh tokens)."""
    async with db() as session:
        total = await session.scalar(select(func.count()).select_from(RefreshToken))
        revoked = await session.scalar(
            select(func.count())
            .select_from(RefreshToken)
            .where(RefreshToken.revoked_at.isnot(None))
        )
    return total or 0, revoked or 0


async def age_revocations(db: async_sessionmaker[AsyncSession], seconds: int) -> None:
    async with db() as session:
        await session.execute(
            update(RefreshToken)
            .where(RefreshToken.revoked_at.isnot(None))
            .values(revoked_at=datetime.now(UTC) - timedelta(seconds=seconds))
        )
        await session.commit()


def with_refresh(token: str) -> dict[str, str]:
    """Present a specific refresh token (an explicit Cookie header wins over the jar)."""
    return {**CSRF, "Cookie": f"refresh_token={token}"}


async def test_refresh_rotates_the_pair(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    login = await login_as(client)
    old_refresh = cookie_value(login, "refresh_token")
    old_access = cookie_value(login, "access_token")

    response = await client.post(REFRESH, headers=CSRF)
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    new_refresh = cookie_value(response, "refresh_token")
    assert new_refresh != old_refresh
    assert cookie_value(response, "access_token") != old_access
    assert cookie_attrs(response, "refresh_token")["path"] == "/api/v1/auth"
    assert await counts(db) == (2, 1)

    async with db() as session:
        old_row = await session.scalar(
            select(RefreshToken).where(RefreshToken.token_hash == hash_token(old_refresh))
        )
        new_row = await session.scalar(
            select(RefreshToken).where(RefreshToken.token_hash == hash_token(new_refresh))
        )
        assert old_row is not None
        assert new_row is not None
        assert old_row.revoked_at is not None
        assert old_row.replaced_by_id == new_row.id
        assert new_row.revoked_at is None

    # The new pair keeps working.
    assert (await client.get("/api/v1/me")).status_code == 200
    assert (await client.post(REFRESH, headers=CSRF)).status_code == 200


async def test_reused_refresh_token_revokes_every_session(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    first = await login_as(client)
    stolen = cookie_value(first, "refresh_token")
    await login_as(client)  # a second device of the same user
    assert (await client.post(REFRESH, headers=with_refresh(stolen))).status_code == 200
    await age_revocations(db, 120)  # well past the multi-tab grace window

    replay = await client.post(REFRESH, headers=with_refresh(stolen))
    assert replay.status_code == 401
    assert replay.json()["error"]["code"] == "AUTH_REFRESH_INVALID"
    assert cookie_attrs(replay, "refresh_token")["max-age"] == "0"
    assert cookie_attrs(replay, "access_token")["max-age"] == "0"
    total, revoked = await counts(db)
    assert total == revoked == 3  # both devices and the rotated replacement

    # The legitimate replacement no longer works either.
    assert (await client.post(REFRESH, headers=CSRF)).status_code == 401


async def test_parallel_refresh_from_another_tab_is_not_treated_as_theft(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    login = await login_as(client)
    old = cookie_value(login, "refresh_token")
    assert (await client.post(REFRESH, headers=with_refresh(old))).status_code == 200

    # Same old cookie a moment later (the other tab's request).
    parallel = await client.post(REFRESH, headers=with_refresh(old))
    assert parallel.status_code == 200
    assert "refresh_token" not in set_cookies(parallel)  # no second pair is minted
    assert await counts(db) == (2, 1)  # the replacement stays valid


async def test_expired_refresh_token_is_rejected(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    await login_as(client)
    async with db() as session:
        await session.execute(
            update(RefreshToken).values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
        )
        await session.commit()
    response = await client.post(REFRESH, headers=CSRF)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REFRESH_INVALID"


async def test_refresh_without_or_with_unknown_cookie_is_401(client: httpx.AsyncClient) -> None:
    for headers in (CSRF, with_refresh("not-a-real-token")):
        response = await client.post(REFRESH, headers=headers)
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "AUTH_REFRESH_INVALID"


async def test_refresh_requires_the_csrf_header(client: httpx.AsyncClient) -> None:
    await login_as(client)
    response = await client.post(REFRESH)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "CSRF_HEADER_MISSING"


async def test_logout_revokes_and_clears_cookies(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    await login_as(client)
    response = await client.post(LOGOUT, headers=CSRF)
    assert response.status_code == 204
    assert cookie_attrs(response, "access_token")["max-age"] == "0"
    assert cookie_attrs(response, "access_token")["path"] == "/"
    assert cookie_attrs(response, "refresh_token")["max-age"] == "0"
    assert cookie_attrs(response, "refresh_token")["path"] == "/api/v1/auth"
    assert await counts(db) == (1, 1)

    me = await client.get("/api/v1/me")
    assert me.status_code == 401
    assert me.json()["error"]["code"] == "AUTH_REQUIRED"


async def test_logout_without_session_is_harmless(client: httpx.AsyncClient) -> None:
    assert (await client.post(LOGOUT, headers=CSRF)).status_code == 204


async def test_a_logged_out_token_replayed_later_counts_as_reuse(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    login = await login_as(client)
    token = cookie_value(login, "refresh_token")
    other = await login_as(client)  # another device stays signed in…
    other_token = cookie_value(other, "refresh_token")
    await client.post(LOGOUT, headers=with_refresh(token))

    replay = await client.post(REFRESH, headers=with_refresh(token))
    assert replay.status_code == 401
    # …until the logged-out token is replayed: then every session ends.
    assert (await client.post(REFRESH, headers=with_refresh(other_token))).status_code == 401
