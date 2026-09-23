from typing import Any

import pytest
from pydantic import ValidationError

from app.core.config import Settings

BASE: dict[str, Any] = {
    "database_url": "postgresql+asyncpg://u:p@h/db",
    "redis_url": "redis://h:6379/0",
}
PROD_SECRETS: dict[str, Any] = {
    "jwt_secret": "x",
    "google_client_id": "x",
    "google_client_secret": "x",
    "vapid_public_key": "x",
    "vapid_private_key": "x",
}


def make(**overrides: Any) -> Settings:
    return Settings(_env_file=None, **{**BASE, **overrides})


def test_cookie_secure_follows_base_url_scheme() -> None:
    assert make(app_base_url="http://localhost:5173").cookie_secure is False
    assert make(app_base_url="https://santa.example.com").cookie_secure is True


def test_cookie_secure_always_in_production() -> None:
    settings = make(env="production", app_base_url="http://weird", **PROD_SECRETS)
    assert settings.is_production
    assert settings.cookie_secure is True


def test_s3_endpoint_prefers_explicit_url() -> None:
    settings = make(s3_endpoint_url="http://localhost:9000", r2_account_id="acc")
    assert settings.s3_endpoint == "http://localhost:9000"


def test_s3_endpoint_derived_from_r2_account() -> None:
    settings = make(s3_endpoint_url="", r2_account_id="acc123")
    assert settings.s3_endpoint == "https://acc123.r2.cloudflarestorage.com"


def test_s3_endpoint_none_without_config() -> None:
    assert make(s3_endpoint_url="", r2_account_id="").s3_endpoint is None


def test_production_requires_secrets() -> None:
    # Explicit empties: conftest puts test secrets in the environment.
    missing = dict.fromkeys(PROD_SECRETS, "")
    with pytest.raises(ValidationError, match="JWT_SECRET"):
        make(env="production", **missing)


def test_env_must_be_known() -> None:
    with pytest.raises(ValidationError):
        make(env="staging")
