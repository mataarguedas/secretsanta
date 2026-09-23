"""Tokens and redirect safety.

- Access token: a 15-minute HS256 JWT whose ``sub`` is the user id.
- Refresh token: 32 random bytes (URL-safe); only its SHA-256 hash is stored.
- OAuth state: a short-lived signed JWT (its own audience) holding state, PKCE verifier and
  ``next`` between ``/auth/google/login`` and the callback.
- ``safe_next``: open-redirect guard for post-login redirects.

Never log the raw tokens (the log redactor masks any ``*token*`` key as a backstop).
"""

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Final
from urllib.parse import urlsplit

import jwt

from app.core.config import Settings

JWT_ALGORITHM: Final = "HS256"
ACCESS_TOKEN_TTL: Final = timedelta(minutes=15)
REFRESH_TOKEN_TTL: Final = timedelta(days=30)
OAUTH_STATE_TTL: Final = timedelta(minutes=10)

# Distinct audiences so one kind of signed token can never be replayed as another.
ACCESS_AUDIENCE: Final = "santa:access"
OAUTH_STATE_AUDIENCE: Final = "santa:oauth-state"

MAX_NEXT_LENGTH: Final = 2048


def _secret(settings: Settings) -> str:
    if not settings.jwt_secret:
        raise RuntimeError("JWT_SECRET is not configured")
    return settings.jwt_secret


def _now(now: datetime | None) -> datetime:
    return now or datetime.now(UTC)


# ── Access token ──────────────────────────────────────────────────────────────


def create_access_token(user_id: uuid.UUID, settings: Settings, now: datetime | None = None) -> str:
    issued = _now(now)
    claims = {
        "sub": str(user_id),
        "aud": ACCESS_AUDIENCE,
        "jti": secrets.token_hex(8),  # unique even when issued within the same second
        "iat": issued,
        "exp": issued + ACCESS_TOKEN_TTL,
    }
    return jwt.encode(claims, _secret(settings), algorithm=JWT_ALGORITHM)


def decode_access_token(token: str, settings: Settings) -> uuid.UUID | None:
    """The user id from a valid, unexpired access token; ``None`` for anything else."""
    try:
        claims = jwt.decode(
            token,
            _secret(settings),
            algorithms=[JWT_ALGORITHM],
            audience=ACCESS_AUDIENCE,
            options={"require": ["sub", "exp", "iat", "aud"]},
        )
        return uuid.UUID(str(claims["sub"]))
    except (jwt.PyJWTError, ValueError):
        return None


# ── Refresh token ─────────────────────────────────────────────────────────────


def new_refresh_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """SHA-256 hex digest. Refresh tokens are high-entropy, so no salt/KDF is needed."""
    return hashlib.sha256(token.encode()).hexdigest()


# ── OAuth state ───────────────────────────────────────────────────────────────


def sign_oauth_state(
    payload: dict[str, str], settings: Settings, now: datetime | None = None
) -> str:
    issued = _now(now)
    claims: dict[str, Any] = {
        **payload,
        "aud": OAUTH_STATE_AUDIENCE,
        "iat": issued,
        "exp": issued + OAUTH_STATE_TTL,
    }
    return jwt.encode(claims, _secret(settings), algorithm=JWT_ALGORITHM)


def verify_oauth_state(token: str, settings: Settings) -> dict[str, Any] | None:
    try:
        claims: dict[str, Any] = jwt.decode(
            token,
            _secret(settings),
            algorithms=[JWT_ALGORITHM],
            audience=OAUTH_STATE_AUDIENCE,
            options={"require": ["exp", "aud"]},
        )
    except jwt.PyJWTError:
        return None
    return claims


def tokens_match(a: str, b: str) -> bool:
    return secrets.compare_digest(a.encode(), b.encode())


# ── Redirect safety ───────────────────────────────────────────────────────────


def _is_control(ch: str) -> bool:
    code = ord(ch)
    return code < 0x20 or 0x7F <= code <= 0x9F


def safe_next(value: str | None) -> str:
    """Return ``value`` only if it's a same-origin relative path, else ``"/"``.

    Allowed: a single leading ``/`` followed by a path (and optional query/fragment).
    Rejected: ``//host``, schemes (``https:``, ``javascript:``), backslashes (browsers treat
    ``/\\host`` like ``//host``), control characters (``/\\t/host``), and anything very long.
    """
    if not value or len(value) > MAX_NEXT_LENGTH:
        return "/"
    if not value.startswith("/") or value.startswith("//"):
        return "/"
    if "\\" in value or any(_is_control(ch) for ch in value):
        return "/"
    parts = urlsplit(value)
    if parts.scheme or parts.netloc:
        return "/"
    return value
