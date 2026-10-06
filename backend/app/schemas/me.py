import re
import unicodedata
import uuid
from typing import Annotated, Final, Literal, Self

from pydantic import AfterValidator, BaseModel, ConfigDict, StrictBool, model_validator

Locale = Literal["es", "en"]

NAME_MAX: Final = 60
# Words that would pass a named member off as an anonymous one ("Secret Elf #3") or as a
# placeholder the app shows for people who are gone. Compared without case or accents.
_RESERVED_NAME_PARTS: Final = ("secret elf", "elfo secreto")
_RESERVED_NAMES: Final = frozenset(
    {"deleted user", "usuario eliminado", "former participant", "ex participante"}
)


def _fold(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value.casefold())
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def _clean_name(value: str) -> str:
    """The display name the user picks in Profile (FR-ACC-1): spaces collapsed, 1-60
    characters, no control or invisible formatting characters, nothing reserved."""
    if any(unicodedata.category(c) in ("Cc", "Cf") for c in value):
        raise ValueError("the name must not contain control characters")
    name = re.sub(r"\s+", " ", value).strip()
    if not 1 <= len(name) <= NAME_MAX:
        raise ValueError(f"the name must be 1-{NAME_MAX} characters")
    folded = " ".join(_fold(name).split())
    if folded in _RESERVED_NAMES or any(part in folded for part in _RESERVED_NAME_PARTS):
        raise ValueError("this name is reserved")
    return name


DisplayName = Annotated[str, AfterValidator(_clean_name)]


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

    name: DisplayName | None = None
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
