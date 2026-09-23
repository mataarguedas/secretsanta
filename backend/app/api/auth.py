"""Google sign-in and cookie sessions (FR-AUTH-1…5). Routes stay thin: rules live in
``services/auth.py`` and ``services/google_oauth.py``."""

from typing import Final
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse, RedirectResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.cookies import (
    OAUTH_STATE_COOKIE,
    REFRESH_COOKIE,
    clear_oauth_state_cookie,
    clear_session_cookies,
    set_oauth_state_cookie,
    set_session_cookies,
)
from app.api.deps import get_app_settings, get_db, get_google_oauth_client
from app.api.paths import GOOGLE_CALLBACK_PATH
from app.core.config import Settings
from app.core.errors import error_response
from app.core.logging import get_logger
from app.core.rate_limit import auth_rate_limit
from app.core.security import safe_next, sign_oauth_state, tokens_match, verify_oauth_state
from app.schemas.auth import RefreshResponse
from app.services import auth as auth_service
from app.services.google_oauth import (
    GoogleOAuthClient,
    GoogleOAuthError,
    new_code_verifier,
    new_state,
)

log = get_logger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])

OAUTH_FAILED: Final = "AUTH_OAUTH_FAILED"


def _base(settings: Settings) -> str:
    return settings.app_base_url.rstrip("/")


def _redirect_uri(settings: Settings) -> str:
    return f"{_base(settings)}{GOOGLE_CALLBACK_PATH}"


def _failure_redirect(settings: Settings, reason: str) -> RedirectResponse:
    """Back to the landing page with a translatable code; the reason is only logged."""
    log.warning("oauth_failed", reason=reason)
    response = RedirectResponse(
        f"{_base(settings)}/?{urlencode({'auth_error': OAUTH_FAILED})}", status_code=302
    )
    clear_oauth_state_cookie(response, settings)
    return response


@router.get("/google/login")
@auth_rate_limit
async def google_login(
    request: Request,
    next: str | None = Query(default=None, max_length=4096),
    settings: Settings = Depends(get_app_settings),
    google: GoogleOAuthClient = Depends(get_google_oauth_client),
) -> RedirectResponse:
    if not google.configured:
        return _failure_redirect(settings, "not_configured")
    state, verifier = new_state(), new_code_verifier()
    response = RedirectResponse(
        google.authorization_url(
            state=state, code_verifier=verifier, redirect_uri=_redirect_uri(settings)
        ),
        status_code=302,
    )
    signed = sign_oauth_state(
        {"state": state, "verifier": verifier, "next": safe_next(next)}, settings
    )
    set_oauth_state_cookie(response, signed, settings)
    return response


@router.get("/google/callback")
@auth_rate_limit
async def google_callback(
    request: Request,
    code: str | None = Query(default=None, max_length=2048),
    state: str | None = Query(default=None, max_length=512),
    error: str | None = Query(default=None, max_length=256),
    settings: Settings = Depends(get_app_settings),
    session: AsyncSession = Depends(get_db),
    google: GoogleOAuthClient = Depends(get_google_oauth_client),
) -> RedirectResponse:
    if error:
        return _failure_redirect(settings, "denied_by_user")
    cookie = request.cookies.get(OAUTH_STATE_COOKIE)
    saved = verify_oauth_state(cookie, settings) if cookie else None
    if (
        not saved
        or not code
        or not state
        or not isinstance(saved.get("state"), str)
        or not tokens_match(saved["state"], state)
    ):
        return _failure_redirect(settings, "state_mismatch")

    try:
        profile = await google.fetch_profile(
            code=code,
            code_verifier=str(saved.get("verifier", "")),
            redirect_uri=_redirect_uri(settings),
        )
    except GoogleOAuthError as exc:
        return _failure_redirect(settings, f"exchange:{exc}")
    if not profile.email_verified:
        return _failure_redirect(settings, "email_unverified")

    user = await auth_service.upsert_google_user(
        session, profile, request.headers.get("accept-language")
    )
    tokens, _ = await auth_service.issue_session(
        session, user.id, settings, request.headers.get("user-agent")
    )
    await session.commit()
    log.info("login", user_id=str(user.id), provider="google")

    response = RedirectResponse(
        f"{_base(settings)}{safe_next(str(saved.get('next', '/')))}", status_code=302
    )
    clear_oauth_state_cookie(response, settings)
    set_session_cookies(response, tokens, settings)
    return response


@router.post("/refresh", response_model=RefreshResponse)
@auth_rate_limit
async def refresh(
    request: Request,
    settings: Settings = Depends(get_app_settings),
    session: AsyncSession = Depends(get_db),
) -> Response:
    outcome = await auth_service.rotate_refresh_token(
        session,
        request.cookies.get(REFRESH_COOKIE),
        settings,
        request.headers.get("user-agent"),
    )
    if outcome.status == "invalid":
        failed = error_response("AUTH_REFRESH_INVALID", 401)
        clear_session_cookies(failed, settings)
        return failed
    response = JSONResponse(RefreshResponse().model_dump())
    # No tokens for "concurrent": the browser already holds the pair from the parallel refresh.
    if outcome.tokens is not None:
        set_session_cookies(response, outcome.tokens, settings)
    return response


@router.post("/logout", status_code=204)
@auth_rate_limit
async def logout(
    request: Request,
    settings: Settings = Depends(get_app_settings),
    session: AsyncSession = Depends(get_db),
) -> Response:
    await auth_service.revoke_refresh_token(session, request.cookies.get(REFRESH_COOKIE))
    response = Response(status_code=204)
    clear_session_cookies(response, settings)
    return response
