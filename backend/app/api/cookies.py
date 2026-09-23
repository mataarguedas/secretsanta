"""Session cookies (FR-AUTH-3): httpOnly, SameSite=Lax, Secure whenever the app is on HTTPS.

- ``access_token``: path ``/`` so every API call and the WebSocket get it.
- ``refresh_token``: path ``/api/v1/auth`` so it only travels to refresh/logout.
- ``oauth_state``: path ``/api/v1/auth/google``, lives only between login and callback.
"""

from typing import Final

from starlette.responses import Response

from app.api.paths import AUTH_PREFIX
from app.core.config import Settings
from app.core.security import ACCESS_TOKEN_TTL, OAUTH_STATE_TTL, REFRESH_TOKEN_TTL
from app.services.auth import SessionTokens

ACCESS_COOKIE: Final = "access_token"
REFRESH_COOKIE: Final = "refresh_token"
OAUTH_STATE_COOKIE: Final = "oauth_state"

ACCESS_PATH: Final = "/"
REFRESH_PATH: Final = AUTH_PREFIX
OAUTH_STATE_PATH: Final = f"{AUTH_PREFIX}/google"


def _set(
    response: Response, key: str, value: str, *, path: str, max_age: int, settings: Settings
) -> None:
    response.set_cookie(
        key,
        value,
        max_age=max_age,
        path=path,
        secure=settings.cookie_secure,
        httponly=True,
        samesite="lax",
    )


def _delete(response: Response, key: str, *, path: str, settings: Settings) -> None:
    response.delete_cookie(
        key, path=path, secure=settings.cookie_secure, httponly=True, samesite="lax"
    )


def set_session_cookies(response: Response, tokens: SessionTokens, settings: Settings) -> None:
    _set(
        response,
        ACCESS_COOKIE,
        tokens.access_token,
        path=ACCESS_PATH,
        max_age=int(ACCESS_TOKEN_TTL.total_seconds()),
        settings=settings,
    )
    _set(
        response,
        REFRESH_COOKIE,
        tokens.refresh_token,
        path=REFRESH_PATH,
        max_age=int(REFRESH_TOKEN_TTL.total_seconds()),
        settings=settings,
    )


def clear_session_cookies(response: Response, settings: Settings) -> None:
    _delete(response, ACCESS_COOKIE, path=ACCESS_PATH, settings=settings)
    _delete(response, REFRESH_COOKIE, path=REFRESH_PATH, settings=settings)


def set_oauth_state_cookie(response: Response, value: str, settings: Settings) -> None:
    _set(
        response,
        OAUTH_STATE_COOKIE,
        value,
        path=OAUTH_STATE_PATH,
        max_age=int(OAUTH_STATE_TTL.total_seconds()),
        settings=settings,
    )


def clear_oauth_state_cookie(response: Response, settings: Settings) -> None:
    _delete(response, OAUTH_STATE_COOKIE, path=OAUTH_STATE_PATH, settings=settings)
