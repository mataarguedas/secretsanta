"""Web Push request/response models (PRD §8: /push/*)."""

import uuid
from datetime import datetime
from typing import Annotated, Final
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

# The browsers' push services (FCM for Chrome, Samsung and Opera; Mozilla; WNS for Edge;
# Apple). The worker POSTs to whatever endpoint is stored, so anything else is refused:
# a subscription must not turn the worker into a request proxy for internal addresses.
PUSH_SERVICE_HOSTS: Final[tuple[str, ...]] = (
    "fcm.googleapis.com",
    "push.services.mozilla.com",
    "notify.windows.com",
    "push.apple.com",
)

# RFC 8291 keys, base64url: p256dh is a 65-byte point (87 chars), auth 16 bytes (22 chars).
Base64Url = Annotated[
    str, StringConstraints(pattern=r"^[A-Za-z0-9_-]+={0,2}$", min_length=16, max_length=128)
]


def is_push_service_url(url: str) -> bool:
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    return parts.scheme == "https" and any(
        host == allowed or host.endswith("." + allowed) for allowed in PUSH_SERVICE_HOSTS
    )


class VapidPublicKey(BaseModel):
    public_key: str


class PushKeys(BaseModel):
    model_config = ConfigDict(extra="forbid")

    p256dh: Base64Url
    auth: Base64Url


class PushSubscriptionCreate(BaseModel):
    """``PushSubscription.toJSON()`` from the browser, plus its user agent."""

    model_config = ConfigDict(extra="ignore")  # toJSON() also has expirationTime

    endpoint: Annotated[str, Field(max_length=2048)]
    keys: PushKeys
    user_agent: Annotated[str | None, Field(max_length=512)] = None

    @field_validator("endpoint")
    @classmethod
    def _push_service_only(cls, value: str) -> str:
        if not is_push_service_url(value):
            raise ValueError("endpoint must be an https URL of a browser push service")
        return value


class PushDevice(BaseModel):
    """One of my devices. ``browser``/``os`` come from the user agent; the client words the
    friendly name ("Chrome on Windows") in the viewer's language. Never the endpoint/keys."""

    id: uuid.UUID
    browser: str | None
    os: str | None
    created_at: datetime
    last_success_at: datetime | None
