"""Application settings, loaded from the environment and ``infra/.env``.

Environment variables always win over the file. The file is optional, so CI
and production can rely on real environment variables only.
"""

from functools import lru_cache
from pathlib import Path
from typing import Literal, Self

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/app/core/config.py -> repo root is three levels above `app`.
REPO_ROOT = Path(__file__).resolve().parents[3]
ENV_FILE = REPO_ROOT / "infra" / ".env"

Environment = Literal["production", "development", "test"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    env: Environment = "development"
    app_base_url: str = "http://localhost:5173"
    app_domain: str = "localhost"

    database_url: str
    redis_url: str

    # Postgres container settings (only the compose files use these directly).
    postgres_password: str = ""
    postgres_host_port: int = 5432

    jwt_secret: str = ""
    google_client_id: str = ""
    google_client_secret: str = ""

    vapid_public_key: str = ""
    vapid_private_key: str = ""
    vapid_subject: str = "mailto:admin@example.com"

    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket: str = "secret-santa"
    s3_endpoint_url: str = ""
    # Optional: the storage address the *browser* uses, for presigned URLs only (dev:
    # http://localhost:9000). Empty = presign with the same endpoint the API uses.
    s3_public_endpoint_url: str = ""

    sentry_dsn: str = ""
    default_timezone: str = "America/Costa_Rica"
    log_level: str = "INFO"

    @model_validator(mode="after")
    def _require_production_secrets(self) -> Self:
        if self.env != "production":
            return self
        required = {
            "JWT_SECRET": self.jwt_secret,
            "GOOGLE_CLIENT_ID": self.google_client_id,
            "GOOGLE_CLIENT_SECRET": self.google_client_secret,
            "VAPID_PUBLIC_KEY": self.vapid_public_key,
            "VAPID_PRIVATE_KEY": self.vapid_private_key,
        }
        missing = sorted(name for name, value in required.items() if not value)
        if missing:
            raise ValueError(f"Missing required production settings: {', '.join(missing)}")
        return self

    @property
    def is_production(self) -> bool:
        return self.env == "production"

    @property
    def is_test(self) -> bool:
        return self.env == "test"

    @property
    def cookie_secure(self) -> bool:
        return self.is_production or self.app_base_url.lower().startswith("https://")

    @property
    def s3_endpoint(self) -> str | None:
        """Explicit ``S3_ENDPOINT_URL`` (MinIO in dev), else the R2 endpoint for the account."""
        if self.s3_endpoint_url:
            return self.s3_endpoint_url
        if self.r2_account_id:
            return f"https://{self.r2_account_id}.r2.cloudflarestorage.com"
        return None


@lru_cache
def get_settings() -> Settings:
    # Required fields (DATABASE_URL, REDIS_URL) come from the environment or infra/.env.
    return Settings()
