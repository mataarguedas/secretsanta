"""WebSocket frames (PRD §8). Client frames are validated with Pydantic; server frames are
built here and only here, from ``MessagePublic`` and ids, so nothing viewer-specific or
secret (a user id behind an anonymous member, an assignment) can reach Redis or a socket.
"""

import uuid
from typing import Annotated, Any, Final, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from app.schemas.chat import CLIENT_ID_MAX, MessagePublic

MAX_FRAME_CHARS: Final = 16_384
MAX_SUBSCRIBE: Final = 500

ClientId = Annotated[str, Field(min_length=1, max_length=CLIENT_ID_MAX)]


# ── Client → server ──────────────────────────────────────────────────────────


class _Frame(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SubscribeFrame(_Frame):
    type: Literal["subscribe"]
    conversation_ids: Annotated[list[uuid.UUID], Field(max_length=MAX_SUBSCRIBE)]


class ActiveFrame(_Frame):
    type: Literal["active"]
    conversation_id: uuid.UUID | None


class SendFrame(_Frame):
    type: Literal["send"]
    conversation_id: uuid.UUID
    body: str  # trimmed and length-checked by MessageCreate, exactly like REST
    client_id: ClientId


class PingFrame(_Frame):
    type: Literal["ping"]


ClientFrame = Annotated[
    SubscribeFrame | ActiveFrame | SendFrame | PingFrame, Field(discriminator="type")
]
client_frame: TypeAdapter[ClientFrame] = TypeAdapter(ClientFrame)

# ── Server → client ──────────────────────────────────────────────────────────

SERVER_FRAME_TYPES: Final = frozenset(
    {"message", "message_deleted", "event_drawn", "conversation_created", "ack", "error", "pong"}
)


def message_frame(message: MessagePublic) -> dict[str, Any]:
    return {
        "type": "message",
        "conversation_id": str(message.conversation_id),
        "message": message.model_dump(mode="json"),
    }


def message_deleted_frame(conversation_id: uuid.UUID, message_id: uuid.UUID) -> dict[str, Any]:
    return {
        "type": "message_deleted",
        "conversation_id": str(conversation_id),
        "message_id": str(message_id),
    }


def event_drawn_frame(event_id: uuid.UUID) -> dict[str, Any]:
    """Only the id: each client fetches its own assignment over REST."""
    return {"type": "event_drawn", "event_id": str(event_id)}


def conversation_created_frame(conversation_id: uuid.UUID) -> dict[str, Any]:
    return {"type": "conversation_created", "conversation_id": str(conversation_id)}


def ack_frame(client_id: str, message_id: uuid.UUID) -> dict[str, Any]:
    return {"type": "ack", "client_id": client_id, "message_id": str(message_id)}


def error_frame(code: str, client_id: str | None = None) -> dict[str, Any]:
    return {"type": "error", "client_id": client_id, "code": code}


PONG: Final = {"type": "pong"}
