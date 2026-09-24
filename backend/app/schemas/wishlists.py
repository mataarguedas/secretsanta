"""Wishlist request/response models (PRD FR-WSH-2, §8)."""

import uuid
from typing import Annotated, Literal, Self
from urllib.parse import urlsplit

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    StringConstraints,
    field_validator,
    model_validator,
)

from app.schemas.events import MAX_CRC, UserPublic

TITLE_MAX = 120
NOTE_MAX = 1000
URL_MAX = 2048
MAX_ITEMS = 200  # per wishlist; also bounds the reorder body

Priority = Literal["low", "medium", "high"]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=TITLE_MAX)]
Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=NOTE_MAX)]
Crc = Annotated[StrictInt, Field(ge=0, le=MAX_CRC)]


def _store_link(value: str) -> str:
    """http(s) links only: ``javascript:``, ``data:``, ``file:`` and friends are refused,
    so a stored link can never run script when another participant clicks it."""
    if any(ch.isspace() or ord(ch) < 32 for ch in value):
        raise ValueError("the link must not contain spaces or control characters")
    parts = urlsplit(value)
    if parts.scheme.lower() not in ("http", "https") or not parts.hostname:
        raise ValueError("only http and https links are allowed")
    return value


StoreLink = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=URL_MAX),
    AfterValidator(_store_link),
]


def _blank_to_none(value: object) -> object:
    return None if isinstance(value, str) and not value.strip() else value


class ItemCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Title
    note: Note | None = None
    url: StoreLink | None = None
    price_crc: Crc | None = None
    priority: Priority = "medium"

    _blank = field_validator("note", "url", mode="before")(_blank_to_none)


class ItemUpdate(BaseModel):
    """PATCH: every field optional; title and priority may not be null."""

    model_config = ConfigDict(extra="forbid")

    title: Title | None = None
    note: Note | None = None
    url: StoreLink | None = None
    price_crc: Crc | None = None
    priority: Priority | None = None

    _blank = field_validator("note", "url", mode="before")(_blank_to_none)

    @model_validator(mode="after")
    def _no_null_for_required(self) -> Self:
        nulls = [
            f
            for f in ("title", "priority")
            if f in self.model_fields_set and getattr(self, f) is None
        ]
        if nulls:
            raise ValueError(f"must not be null: {', '.join(nulls)}")
        return self


class ItemOrder(BaseModel):
    """``PUT …/wishlist/order``: every one of the owner's item ids, in the new order."""

    model_config = ConfigDict(extra="forbid")

    item_ids: Annotated[list[uuid.UUID], Field(max_length=MAX_ITEMS)]

    @model_validator(mode="after")
    def _distinct(self) -> Self:
        if len(set(self.item_ids)) != len(self.item_ids):
            raise ValueError("item_ids must be distinct")
        return self


class PhotoOut(BaseModel):
    id: uuid.UUID
    url: str  # presigned, 1 h
    thumb_url: str
    width: int
    height: int


class ItemOut(BaseModel):
    id: uuid.UUID
    title: str
    note: str | None
    url: str | None
    price_crc: int | None
    priority: Priority
    position: int
    photos: list[PhotoOut]


class WishlistOut(BaseModel):
    owner: UserPublic
    is_self: bool
    items: list[ItemOut]
