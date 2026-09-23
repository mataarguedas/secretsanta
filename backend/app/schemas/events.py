"""Event request/response models (PRD FR-EVT-1, §8)."""

import uuid
from datetime import UTC, datetime
from typing import Annotated, Literal, Self

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictInt,
    StringConstraints,
    field_validator,
    model_validator,
)

# Postgres INTEGER; anything larger is a typo, not a budget.
MAX_CRC = 2_000_000_000

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=80)]
Description = Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)]
Location = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]
Crc = Annotated[StrictInt, Field(ge=0, le=MAX_CRC)]

EventStateName = Literal["open", "drawn", "archived"]
Section = Literal["hosting", "participating", "past"]


def _blank_to_none(value: str | None) -> str | None:
    return value or None


class EventCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    description: Description | None = None
    budget_crc: Crc
    exchange_at: AwareDatetime
    join_deadline: AwareDatetime | None = None
    location: Location | None = None
    is_online: StrictBool = False
    group_chat_enabled: StrictBool = True

    _blank = field_validator("description", "location")(_blank_to_none)

    @model_validator(mode="after")
    def _rules(self) -> Self:
        if self.exchange_at <= datetime.now(UTC):
            raise ValueError("exchange_at must be in the future")
        if self.join_deadline is not None and self.join_deadline >= self.exchange_at:
            raise ValueError("join_deadline must be before exchange_at")
        if self.is_online and self.location:
            raise ValueError("an online event has no location")
        return self


class EventUpdate(BaseModel):
    """PATCH: every field optional. Required columns may not be set to null."""

    model_config = ConfigDict(extra="forbid")

    name: Name | None = None
    description: Description | None = None
    budget_crc: Crc | None = None
    exchange_at: AwareDatetime | None = None
    join_deadline: AwareDatetime | None = None
    location: Location | None = None
    is_online: StrictBool | None = None
    group_chat_enabled: StrictBool | None = None

    _blank = field_validator("description", "location")(_blank_to_none)

    @model_validator(mode="after")
    def _no_null_for_required(self) -> Self:
        required = ("name", "budget_crc", "exchange_at", "is_online", "group_chat_enabled")
        nulls = [f for f in required if f in self.model_fields_set and getattr(self, f) is None]
        if nulls:
            raise ValueError(f"must not be null: {', '.join(nulls)}")
        return self


class UserPublic(BaseModel):
    """What any participant may see about another user. Never the email."""

    id: uuid.UUID
    name: str
    avatar_url: str | None


class EventSummary(BaseModel):
    """A dashboard card."""

    id: uuid.UUID
    name: str
    state: EventStateName
    participant_count: int
    exchange_at: datetime
    budget_crc: int
    is_host: bool


class EventPage(BaseModel):
    items: list[EventSummary]
    next_cursor: str | None


class EventDetail(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    budget_crc: int
    exchange_at: datetime
    join_deadline: datetime | None
    location: str | None
    is_online: bool
    group_chat_enabled: bool
    state: EventStateName
    drawn_at: datetime | None
    archived_at: datetime | None
    host: UserPublic
    participant_count: int
    my_role: Literal["host", "participant"]
    # TODO(prompt 16): the caller's own receiver once drawn; never anyone else's.
    my_assignment: None = None


class HostEventDetail(EventDetail):
    """The host's view adds the invite token (NULL when the link is disabled)."""

    invite_token: str | None
