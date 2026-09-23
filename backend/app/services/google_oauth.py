"""Google OAuth 2.0: Authorization Code + PKCE (S256), server-side (FR-AUTH-1).

Authlib provides the PKCE and token primitives; the two HTTP calls (code exchange and
OpenID userinfo) go through httpx. The profile comes from the userinfo endpoint over TLS
with the fresh access token, so no ID-token signature check is needed.
"""

from dataclasses import dataclass
from typing import Any, Final

import httpx
from authlib.common.security import generate_token
from authlib.common.urls import add_params_to_uri
from authlib.oauth2.rfc7636 import create_s256_code_challenge

from app.core.config import Settings

AUTHORIZE_URL: Final = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL: Final = "https://oauth2.googleapis.com/token"  # noqa: S105 (a URL, not a secret)
USERINFO_URL: Final = "https://openidconnect.googleapis.com/v1/userinfo"
SCOPE: Final = "openid email profile"
HTTP_TIMEOUT: Final = 10.0


class GoogleOAuthError(Exception):
    """The exchange or profile fetch failed. The message never contains secrets."""


@dataclass(frozen=True)
class GoogleProfile:
    sub: str
    email: str
    email_verified: bool
    name: str
    picture: str | None


def new_state() -> str:
    return str(generate_token(32))


def new_code_verifier() -> str:
    # RFC 7636: 43 to 128 characters from the unreserved set.
    return str(generate_token(64))


class GoogleOAuthClient:
    def __init__(self, settings: Settings, http: httpx.AsyncClient | None = None) -> None:
        self._client_id = settings.google_client_id
        self._client_secret = settings.google_client_secret
        self._http = http

    @property
    def configured(self) -> bool:
        return bool(self._client_id and self._client_secret)

    def authorization_url(self, *, state: str, code_verifier: str, redirect_uri: str) -> str:
        return str(
            add_params_to_uri(
                AUTHORIZE_URL,
                [
                    ("response_type", "code"),
                    ("client_id", self._client_id),
                    ("redirect_uri", redirect_uri),
                    ("scope", SCOPE),
                    ("state", state),
                    ("code_challenge", create_s256_code_challenge(code_verifier)),
                    ("code_challenge_method", "S256"),
                    # Several Google accounts per browser is common (test users A/B/C).
                    ("prompt", "select_account"),
                ],
            )
        )

    async def fetch_profile(
        self, *, code: str, code_verifier: str, redirect_uri: str
    ) -> GoogleProfile:
        if self._http is not None:
            return await self._fetch_profile(self._http, code, code_verifier, redirect_uri)
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as http:
            return await self._fetch_profile(http, code, code_verifier, redirect_uri)

    async def _fetch_profile(
        self, http: httpx.AsyncClient, code: str, code_verifier: str, redirect_uri: str
    ) -> GoogleProfile:
        try:
            token_response = await http.post(
                TOKEN_URL,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "code_verifier": code_verifier,
                    "redirect_uri": redirect_uri,
                    "client_id": self._client_id,
                    "client_secret": self._client_secret,
                },
                headers={"Accept": "application/json"},
            )
            if token_response.status_code != 200:
                raise GoogleOAuthError(f"token exchange returned {token_response.status_code}")
            access_token = token_response.json().get("access_token")
            if not isinstance(access_token, str):
                raise GoogleOAuthError("token response has no access_token")

            info_response = await http.get(
                USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"}
            )
            if info_response.status_code != 200:
                raise GoogleOAuthError(f"userinfo returned {info_response.status_code}")
            return _profile_from(info_response.json())
        except httpx.HTTPError as exc:
            raise GoogleOAuthError(type(exc).__name__) from exc
        except ValueError as exc:  # invalid JSON
            raise GoogleOAuthError("invalid JSON from Google") from exc


def _profile_from(data: Any) -> GoogleProfile:
    if not isinstance(data, dict):
        raise GoogleOAuthError("userinfo is not an object")
    sub, email = data.get("sub"), data.get("email")
    if not isinstance(sub, str) or not sub or not isinstance(email, str) or not email:
        raise GoogleOAuthError("userinfo lacks sub/email")
    name = data.get("name")
    picture = data.get("picture")
    return GoogleProfile(
        sub=sub,
        email=email,
        email_verified=data.get("email_verified") is True,
        name=name.strip() if isinstance(name, str) and name.strip() else email.split("@")[0],
        picture=picture if isinstance(picture, str) and picture else None,
    )
