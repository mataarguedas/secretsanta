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
    # Presigned (1 h) or null; cards show the thumbnail.
    cover_url: str | None = None
    cover_thumb_url: str | None = None


class EventPage(BaseModel):
    items: list[EventSummary]
    next_cursor: str | None


class AssignmentReceiver(BaseModel):
    user_id: uuid.UUID
    name: str
    avatar_url: str | None


class MyAssignment(BaseModel):
    """FR-DRW-4: who the *requesting* giver gives to. There is no other view of a draw."""

    receiver: AssignmentReceiver


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
    # Presigned (1 h) GET URLs, or null without a cover (PRD §8 Photo URLs).
    cover_url: str | None = None
    cover_thumb_url: str | None = None
    my_role: Literal["host", "participant"]
    # The caller's own receiver once drawn; never anyone else's (CLAUDE.md §2.1).
    my_assignment: MyAssignment | None = None


class DrawResult(BaseModel):
    """``POST /events/{id}/draw``: the new state and nothing else (never a pair)."""

    state: Literal["drawn"]


class DrawReadiness(BaseModel):
    """Host only: whether the reveal can run (FR-DRW-1, FR-EXC-4)."""

    participant_count: int
    feasible: bool
    can_draw: bool


class HostEventDetail(EventDetail):
    """The host's view adds the invite token (NULL when the link is disabled) and whether
    the draw can run."""

    invite_token: str | None
    draw_readiness: DrawReadiness


class ParticipantPublic(BaseModel):
    """A roster row. Any participant may see it, so never the email."""

    user_id: uuid.UUID
    name: str
    avatar_url: str | None
    is_host: bool
    is_self: bool
    joined_at: datetime
