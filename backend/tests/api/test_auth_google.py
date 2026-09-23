"""Google sign-in: /auth/google/login and /auth/google/callback with Google mocked."""

from collections.abc import Iterator
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.deps import get_google_oauth_client
from app.core.config import get_settings
from app.core.security import hash_token, verify_oauth_state
from app.models import RefreshToken, User
from app.services.google_oauth import GoogleOAuthClient, GoogleOAuthError, GoogleProfile
from tests.api.auth_helpers import cookie_attrs, cookie_value, set_cookies

BASE = "http://localhost:5173"
LOGIN = "/api/v1/auth/google/login"
CALLBACK = "/api/v1/auth/google/callback"
FAILED = f"{BASE}/?auth_error=AUTH_OAUTH_FAILED"

PROFILE = GoogleProfile(
    sub="google-sub-1",
    email="ana@example.com",
    email_verified=True,
    name="Ana Rojas",
    picture="https://lh3.googleusercontent.com/a/ana",
)


class FakeGoogle(GoogleOAuthClient):
    """Builds real authorization URLs; returns a canned profile instead of calling Google."""

    def __init__(self) -> None:
        super().__init__(get_settings())
        self.profile: GoogleProfile | Exception = PROFILE
        self.calls: list[dict[str, str]] = []

    async def fetch_profile(
        self, *, code: str, code_verifier: str, redirect_uri: str
    ) -> GoogleProfile:
        self.calls.append({"code": code, "verifier": code_verifier, "redirect_uri": redirect_uri})
        if isinstance(self.profile, Exception):
            raise self.profile
        return self.profile


@pytest.fixture
def google(app: FastAPI) -> Iterator[FakeGoogle]:
    fake = FakeGoogle()
    app.dependency_overrides[get_google_oauth_client] = lambda: fake
    yield fake
    app.dependency_overrides.clear()


async def start_login(client: httpx.AsyncClient, next_: str | None = "/profile") -> str:
    params = {"next": next_} if next_ is not None else {}
    response = await client.get(LOGIN, params=params)
    assert response.status_code == 302
    return parse_qs(urlsplit(response.headers["location"]).query)["state"][0]


async def test_login_redirects_to_google_with_pkce_and_sets_state_cookie(
    client: httpx.AsyncClient, google: FakeGoogle
) -> None:
    response = await client.get(LOGIN, params={"next": "/profile"})
    assert response.status_code == 302
    url = urlsplit(response.headers["location"])
    params = {k: v[0] for k, v in parse_qs(url.query).items()}
    assert url.netloc == "accounts.google.com"
    assert params["redirect_uri"] == f"{BASE}/api/v1/auth/google/callback"
    assert params["code_challenge_method"] == "S256"
    assert params["code_challenge"]

    attrs = cookie_attrs(response, "oauth_state")
    assert attrs["httponly"] is True
    assert str(attrs["samesite"]).lower() == "lax"
    assert attrs["path"] == "/api/v1/auth/google"
    claims = verify_oauth_state(cookie_value(response, "oauth_state"), get_settings())
    assert claims is not None
    assert claims["state"] == params["state"]
    assert claims["next"] == "/profile"
    assert params["code_challenge"] != claims["verifier"]


async def test_callback_creates_user_sets_cookies_and_redirects(
    client: httpx.AsyncClient,
    google: FakeGoogle,
    db: async_sessionmaker[AsyncSession],
) -> None:
    state = await start_login(client, "/profile")
    response = await client.get(
        CALLBACK,
        params={"code": "auth-code", "state": state},
        headers={"Accept-Language": "en-US,en;q=0.9,es;q=0.8", "User-Agent": "pytest-UA"},
    )
    assert response.status_code == 302
    assert response.headers["location"] == f"{BASE}/profile"

    access = cookie_attrs(response, "access_token")
    assert access["httponly"] is True
    assert str(access["samesite"]).lower() == "lax"
    assert access["path"] == "/"
    assert access["max-age"] == "900"
    refresh = cookie_attrs(response, "refresh_token")
    assert refresh["httponly"] is True
    assert str(refresh["samesite"]).lower() == "lax"
    assert refresh["path"] == "/api/v1/auth"
    # The state cookie is single-use.
    assert set_cookies(response)["oauth_state"]["oauth_state"]["max-age"] == "0"

    assert google.calls[0]["code"] == "auth-code"
    assert google.calls[0]["redirect_uri"] == f"{BASE}/api/v1/auth/google/callback"

    async with db() as session:
        user = await session.scalar(select(User))
        assert user is not None
        assert (user.google_sub, user.email, user.name) == (
            "google-sub-1",
            "ana@example.com",
            "Ana Rojas",
        )
        assert user.avatar_url == PROFILE.picture
        assert user.locale == "en"
        token = await session.scalar(select(RefreshToken))
        assert token is not None
        raw = cookie_value(response, "refresh_token")
        assert token.token_hash == hash_token(raw)
        assert token.token_hash != raw
        assert token.user_agent == "pytest-UA"
        assert token.revoked_at is None

    me = await client.get("/api/v1/me")
    assert me.status_code == 200
    assert me.json()["email"] == "ana@example.com"


@pytest.mark.parametrize(
    ("accept_language", "locale"),
    [("es-CR,es;q=0.9", "es"), ("fr-FR", "es"), (None, "es"), ("EN", "en")],
)
async def test_first_sign_in_locale_from_accept_language(
    client: httpx.AsyncClient,
    google: FakeGoogle,
    db: async_sessionmaker[AsyncSession],
    accept_language: str | None,
    locale: str,
) -> None:
    state = await start_login(client)
    headers = {"Accept-Language": accept_language} if accept_language else {}
    await client.get(CALLBACK, params={"code": "c", "state": state}, headers=headers)
    async with db() as session:
        assert await session.scalar(select(User.locale)) == locale


async def test_returning_user_keeps_locale_and_gets_fresh_profile(
    client: httpx.AsyncClient, google: FakeGoogle, db: async_sessionmaker[AsyncSession]
) -> None:
    state = await start_login(client)
    await client.get(CALLBACK, params={"code": "c", "state": state})  # es
    google.profile = GoogleProfile(
        sub=PROFILE.sub, email="ANA@example.com", email_verified=True, name="Ana R.", picture=None
    )
    state = await start_login(client)
    await client.get(
        CALLBACK, params={"code": "c", "state": state}, headers={"Accept-Language": "en"}
    )
    async with db() as session:
        users = (await session.scalars(select(User))).all()
        assert len(users) == 1
        assert users[0].locale == "es"
        assert users[0].name == "Ana R."
        assert users[0].avatar_url is None


@pytest.mark.parametrize(
    "next_", ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:x"]
)
async def test_malicious_next_lands_on_home(
    client: httpx.AsyncClient, google: FakeGoogle, next_: str
) -> None:
    state = await start_login(client, next_)
    response = await client.get(CALLBACK, params={"code": "c", "state": state})
    assert response.status_code == 302
    assert response.headers["location"] == f"{BASE}/"


async def assert_failed(response: httpx.Response, db: async_sessionmaker[AsyncSession]) -> None:
    assert response.status_code == 302
    assert response.headers["location"] == FAILED
    assert "access_token" not in set_cookies(response)
    assert "refresh_token" not in set_cookies(response)
    async with db() as session:
        assert await session.scalar(select(func.count()).select_from(User)) == 0


async def test_callback_rejects_state_mismatch(
    client: httpx.AsyncClient, google: FakeGoogle, db: async_sessionmaker[AsyncSession]
) -> None:
    await start_login(client)
    response = await client.get(CALLBACK, params={"code": "c", "state": "forged"})
    await assert_failed(response, db)
    assert google.calls == []


async def test_callback_rejects_missing_state_cookie(
    client: httpx.AsyncClient, google: FakeGoogle, db: async_sessionmaker[AsyncSession]
) -> None:
    state = await start_login(client)
    client.cookies.clear()
    await assert_failed(await client.get(CALLBACK, params={"code": "c", "state": state}), db)


async def test_callback_handles_user_denial(
    client: httpx.AsyncClient, google: FakeGoogle, db: async_sessionmaker[AsyncSession]
) -> None:
    state = await start_login(client)
    response = await client.get(CALLBACK, params={"error": "access_denied", "state": state})
    await assert_failed(response, db)


async def test_callback_rejects_unverified_email(
    client: httpx.AsyncClient, google: FakeGoogle, db: async_sessionmaker[AsyncSession]
) -> None:
    google.profile = GoogleProfile(
        sub="s", email="x@example.com", email_verified=False, name="X", picture=None
    )
    state = await start_login(client)
    await assert_failed(await client.get(CALLBACK, params={"code": "c", "state": state}), db)


async def test_callback_handles_exchange_failure(
    client: httpx.AsyncClient, google: FakeGoogle, db: async_sessionmaker[AsyncSession]
) -> None:
    google.profile = GoogleOAuthError("token exchange returned 400")
    state = await start_login(client)
    await assert_failed(await client.get(CALLBACK, params={"code": "c", "state": state}), db)


async def test_state_cookie_cannot_be_replayed_after_success(
    client: httpx.AsyncClient, google: FakeGoogle
) -> None:
    state = await start_login(client)
    first = await client.get(CALLBACK, params={"code": "c", "state": state})
    assert first.headers["location"] == f"{BASE}/profile"
    second = await client.get(CALLBACK, params={"code": "c", "state": state})
    assert second.headers["location"] == FAILED
