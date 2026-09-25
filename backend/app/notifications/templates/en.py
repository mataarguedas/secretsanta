"""English push notification templates."""

from typing import Final

TEMPLATES: Final[dict[str, tuple[str, str]]] = {
    "test": ("Secret Santa", "Test notification: notifications are working."),
    # TODO(prompt 25): reveal, message, wishlist_updated, exchange_reminder.
}
