"""Invite preview and join (PRD §4.3)."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.schemas.events import UserPublic

# Why a valid link can't be used right now; the frontend translates these codes.
JoinBlockReason = Literal["EVENT_ALREADY_DRAWN", "JOIN_DEADLINE_PASSED", "ALREADY_PARTICIPANT"]


class InvitePreview(BaseModel):
    """What the join screen shows (FR-INV-3). ``event_id`` only for existing participants."""

    event_name: str
    host: UserPublic
    budget_crc: int
    exchange_at: datetime
    participant_count: int
    already_participant: bool
    event_id: uuid.UUID | None
    joinable: bool
    reason: JoinBlockReason | None


class JoinResult(BaseModel):
    event_id: uuid.UUID
