import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest

from app.core.config import get_settings
from app.core.security import (
    ACCESS_TOKEN_TTL,
    JWT_ALGORITHM,
    create_access_token,
    decode_access_token,
    hash_token,
    new_refresh_token,
    safe_next,
    sign_oauth_state,
    verify_oauth_state,
)

SETTINGS = get_settings()


@pytest.mark.parametrize(
    "value",
    [
        "/",
        "/profile",
        "/events/0193d1c2-aaaa-7bbb-8ccc-123456789abc/wishlists",
        "/join/abc_DEF-123",
        "/chats?x=1#top",
        "/@evil.example",  # a path on *our* origin
        "/%2F%2Fevil.example",  # percent-encoded stays a path
    ],
)
def test_safe_next_allows_same_origin_paths(value: str) -> None:
    assert safe_next(value) == value


@pytest.mark.parametrize(
    "value",
    [
        None,
        "",
        "profile",
        "https://evil.example",
        "http://evil.example/profile",
        "//evil.example",
        "//evil.example/profile",
        "///evil.example",
        "/\\evil.example",
        "\\\\evil.example",
        "/\\/evil.example",
        "javascript:alert(1)",
        "JaVaScRiPt:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        " /profile",
        "/\t/evil.example",
        "/\n/evil.example",
        "/\r\nLocation: https://evil.example",
        "/\x00",
        "/\x7f",
        "/\x85evil",
        "/" + "a" * 3000,
    ],
)
def test_safe_next_rejects_malicious_values(value: str | None) -> None:
    assert safe_next(value) == "/"


def test_access_token_round_trip() -> None:
    user_id = uuid.uuid4()
    token = create_access_token(user_id, SETTINGS)
    assert decode_access_token(token, SETTINGS) == user_id
    claims = jwt.decode(token, options={"verify_signature": False})
    assert claims["sub"] == str(user_id)
    assert claims["exp"] - claims["iat"] == ACCESS_TOKEN_TTL.total_seconds()


def test_access_token_expires_after_15_minutes() -> None:
    issued = datetime.now(UTC) - ACCESS_TOKEN_TTL - timedelta(seconds=1)
    assert (
        decode_access_token(create_access_token(uuid.uuid4(), SETTINGS, issued), SETTINGS) is None
    )


@pytest.mark.parametrize(
    "token",
    [
        "garbage",
        "",
        # alg=none
        jwt.encode({"sub": str(uuid.uuid4()), "aud": "santa:access"}, key="", algorithm="none"),
        # wrong key
        jwt.encode(
            {
                "sub": str(uuid.uuid4()),
                "aud": "santa:access",
                "iat": datetime.now(UTC),
                "exp": datetime.now(UTC) + timedelta(minutes=5),
            },
            "another-secret-that-is-long-enough-for-hs256",
            algorithm=JWT_ALGORITHM,
        ),
    ],
)
def test_invalid_access_tokens_are_rejected(token: str) -> None:
    assert decode_access_token(token, SETTINGS) is None


def test_oauth_state_token_is_not_an_access_token() -> None:
    state = sign_oauth_state({"state": "s", "verifier": "v", "next": "/"}, SETTINGS)
    assert decode_access_token(state, SETTINGS) is None
    access = create_access_token(uuid.uuid4(), SETTINGS)
    assert verify_oauth_state(access, SETTINGS) is None


def test_oauth_state_round_trip_and_expiry() -> None:
    claims = verify_oauth_state(
        sign_oauth_state({"state": "s", "verifier": "v", "next": "/x"}, SETTINGS), SETTINGS
    )
    assert claims is not None
    assert (claims["state"], claims["verifier"], claims["next"]) == ("s", "v", "/x")
    old = sign_oauth_state({"state": "s"}, SETTINGS, datetime.now(UTC) - timedelta(minutes=11))
    assert verify_oauth_state(old, SETTINGS) is None


def test_refresh_tokens_are_random_and_only_hashes_are_comparable() -> None:
    a, b = new_refresh_token(), new_refresh_token()
    assert a != b
    assert len(a) >= 43
    assert hash_token(a) == hash_token(a)
    assert hash_token(a) != a
    assert len(hash_token(a)) == 64
