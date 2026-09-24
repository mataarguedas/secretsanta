"""Exclusion request/response models (PRD FR-EXC, §8). Host-only data."""

import uuid
from typing import Annotated, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.events import UserPublic

# The group helper creates n·(n-1)/2 pairs; no real family needs more than this.
MAX_GROUP = 50


class ExclusionCreate(BaseModel):
    """2 ids = one pair; 3 or more = the group helper (every pair among them)."""

    model_config = ConfigDict(extra="forbid")

    user_ids: Annotated[list[uuid.UUID], Field(min_length=2, max_length=MAX_GROUP)]

    @model_validator(mode="after")
    def _distinct(self) -> Self:
        if len(set(self.user_ids)) != len(self.user_ids):
            raise ValueError("user_ids must be distinct")
        return self


class ExclusionOut(BaseModel):
    id: uuid.UUID
    user_a: UserPublic
    user_b: UserPublic


class ExclusionList(BaseModel):
    """Every exclusions response carries the live feasibility check (FR-EXC-4)."""

    items: list[ExclusionOut]
    feasible: bool
