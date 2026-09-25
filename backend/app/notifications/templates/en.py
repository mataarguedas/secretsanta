"""English push notification templates."""

from collections.abc import Callable, Mapping
from typing import Any, Final

from app.notifications.text import format_crc

ELF_ALIAS: Final = "Secret Elf #{n}"
FORMER_MEMBER: Final = "Former participant"


def _reminder(p: Mapping[str, Any]) -> tuple[str, str]:
    days = int(p["days"])
    when = "1 day" if days == 1 else f"{days} days"
    return p["event"], f"{when} until {p['event']} — budget {format_crc(p['budget_crc'])}"


TEMPLATES: Final[dict[str, tuple[str, str] | Callable[[Mapping[str, Any]], tuple[str, str]]]] = {
    "test": ("Secret Santa", "Test notification: notifications are working."),
    "reveal": ("Secret Santa", "The draw for {event} is done — see who you're giving to!"),
    "message": ("{event}", "{sender}: {preview}"),
    # Never the owner's name: that would reveal the assignment on a lock screen (FR-NTF-4).
    "wishlist_updated": ("{event}", "The person you're giving to updated their wishlist"),
    "exchange_reminder": _reminder,
}
