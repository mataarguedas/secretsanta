"""URL prefixes shared by routers, cookies and redirects."""

from typing import Final

API_PREFIX: Final = "/api/v1"
AUTH_PREFIX: Final = f"{API_PREFIX}/auth"
GOOGLE_CALLBACK_PATH: Final = f"{AUTH_PREFIX}/google/callback"
