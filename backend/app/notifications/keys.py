"""Redis keys of the notify pipeline, shared by the API (which sets them) and the worker."""

import uuid
from typing import Final

WISHLIST_DEBOUNCE_SECONDS: Final = 600  # FR-WSH-7: one push per 10 minutes per wishlist


def wishlist_debounce_key(event_id: uuid.UUID, owner_id: uuid.UUID) -> str:
    """``wl_debounce:{event}:{owner}`` (CLAUDE.md §7 Notifications)."""
    return f"wl_debounce:{event_id}:{owner_id}"
