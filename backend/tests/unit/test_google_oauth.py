from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from authlib.oauth2.rfc7636 import create_s256_code_challenge

from app.core.config import get_settings
from app.services.google_oauth import (
    TOKEN_URL,
    USERINFO_URL,
    GoogleOAuthClient,
    GoogleOAuthError,
    new_code_verifier,
)

REDIRECT = "http://localhost:5173/api/v1/auth/google/callback"


def test_authorization_url_uses_code_flow_with_pkce_s256() -> None:
    client = GoogleOAuthClient(get_settings())
    verifier = new_code_verifier()
    url = urlsplit(
        client.authorization_url(state="st", code_verifier=verifier, redirect_uri=REDIRECT)
    )
    params = {k: v[0] for k, v in parse_qs(url.query).items()}
    assert url.netloc == "accounts.google.com"
    assert params["response_type"] == "code"
    assert params["client_id"] == get_settings().google_client_id
    assert params["redirect_uri"] == REDIRECT
    assert params["scope"] == "openid email profile"
    assert params["state"] == "st"
    assert params["code_challenge_method"] == "S256"
    assert params["code_challenge"] == create_s256_code_challenge(verifier)
    assert verifier not in url.query  # only the challenge leaves the server
    assert "client_secret" not in url.query


def test_code_verifier_length_is_valid() -> None:
    assert 43 <= len(new_code_verifier()) <= 128


def _client(handler: httpx.MockTransport) -> GoogleOAuthClient:
    return GoogleOAuthClient(get_settings(), http=httpx.AsyncClient(transport=handler))


USERINFO = {
    "sub": "g-123",
    "email": "ana@example.com",
    "email_verified": True,
    "name": "Ana Rojas",
    "picture": "https://lh3.googleusercontent.com/a/x",
}


async def test_fetch_profile_exchanges_code_with_verifier() -> None:
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url) == TOKEN_URL:
            seen.update({k: v[0] for k, v in parse_qs(request.content.decode()).items()})
            return httpx.Response(200, json={"access_token": "ya29.token", "id_token": "x"})
        if str(request.url) == USERINFO_URL:
            assert request.headers["Authorization"] == "Bearer ya29.token"
            return httpx.Response(200, json=USERINFO)
        return httpx.Response(404)

    profile = await _client(httpx.MockTransport(handler)).fetch_profile(
        code="c0de", code_verifier="v" * 64, redirect_uri=REDIRECT
    )
    assert profile.sub == "g-123"
    assert profile.email == "ana@example.com"
    assert profile.email_verified is True
    assert profile.name == "Ana Rojas"
    assert profile.picture == USERINFO["picture"]
    assert seen["grant_type"] == "authorization_code"
    assert seen["code"] == "c0de"
    assert seen["code_verifier"] == "v" * 64
    assert seen["redirect_uri"] == REDIRECT


async def test_missing_name_falls_back_to_email_local_part() -> None:
    info = {**USERINFO, "name": "  ", "picture": ""}

    def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url) == TOKEN_URL:
            return httpx.Response(200, json={"access_token": "t"})
        return httpx.Response(200, json=info)

    profile = await _client(httpx.MockTransport(handler)).fetch_profile(
        code="c", code_verifier="v" * 64, redirect_uri=REDIRECT
    )
    assert profile.name == "ana"
    assert profile.picture is None


@pytest.mark.parametrize(
    ("token_status", "token_json", "info_status", "info_json"),
    [
        (400, {"error": "invalid_grant"}, 200, USERINFO),
        (200, {"no": "token"}, 200, USERINFO),
        (200, {"access_token": "t"}, 401, {}),
        (200, {"access_token": "t"}, 200, {"email": "a@b.c"}),  # no sub
        (200, {"access_token": "t"}, 200, ["not", "an", "object"]),
    ],
)
async def test_fetch_profile_failures_raise(
    token_status: int, token_json: object, info_status: int, info_json: object
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url) == TOKEN_URL:
            return httpx.Response(token_status, json=token_json)
        return httpx.Response(info_status, json=info_json)

    with pytest.raises(GoogleOAuthError) as exc_info:
        await _client(httpx.MockTransport(handler)).fetch_profile(
            code="c", code_verifier="v" * 64, redirect_uri=REDIRECT
        )
    assert get_settings().google_client_secret not in str(exc_info.value)


async def test_network_errors_become_google_oauth_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom", request=request)

    with pytest.raises(GoogleOAuthError, match="ConnectError"):
        await _client(httpx.MockTransport(handler)).fetch_profile(
            code="c", code_verifier="v" * 64, redirect_uri=REDIRECT
        )
