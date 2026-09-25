import uuid
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, StrictBool, model_validator

Locale = Literal["es", "en"]


class MeResponse(BaseModel):
    """The signed-in user's own profile. Only ever returned to that user."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    email: str
    avatar_url: str | None
    locale: Locale
    notify_message: bool
    notify_wishlist: bool
    notify_reminder: bool


class MeUpdate(BaseModel):
    """PATCH /me. Every field is optional, but none may be null; unknown fields are rejected."""

    model_config = ConfigDict(extra="forbid")

    locale: Locale | None = None
    notify_message: StrictBool | None = None
    notify_wishlist: StrictBool | None = None
    notify_reminder: StrictBool | None = None

    @model_validator(mode="after")
    def _no_explicit_nulls(self) -> Self:
        nulls = [f for f in self.model_fields_set if getattr(self, f) is None]
        if nulls:
            raise ValueError(f"must not be null: {', '.join(sorted(nulls))}")
        return self


class EventRefOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str


class HostedEventRefOut(EventRefOut):
    participant_count: int


class DeletionPreviewOut(BaseModel):
    """``GET /me/deletion-preview``: what ``DELETE /me`` would do (FR-ACC-3)."""

    model_config = ConfigDict(from_attributes=True)

    blocked: bool
    # DRAWN events the user is in: deletion is refused until they are archived.
    blocking_events: list[EventRefOut]
    # OPEN events the user hosts: deleted together with the account.
    hosted_open_events: list[HostedEventRefOut]
