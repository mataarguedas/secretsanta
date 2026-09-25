"""Plantillas de notificaciones push en español (es-CR). Tuteo, como la app."""

from collections.abc import Callable, Mapping
from typing import Any, Final

from app.notifications.text import format_crc

ELF_ALIAS: Final = "Elfo secreto #{n}"
FORMER_MEMBER: Final = "Ex participante"


def _reminder(p: Mapping[str, Any]) -> tuple[str, str]:
    days = int(p["days"])
    when = "Falta 1 día" if days == 1 else f"Faltan {days} días"
    return p["event"], f"{when} para «{p['event']}» — presupuesto {format_crc(p['budget_crc'])}"


TEMPLATES: Final[dict[str, tuple[str, str] | Callable[[Mapping[str, Any]], tuple[str, str]]]] = {
    "test": ("Secret Santa", "Notificación de prueba: las notificaciones funcionan."),
    "reveal": (
        "Secret Santa",
        "Ya se hizo el sorteo de «{event}»: ¡descubre a quién le regalas!",
    ),
    "message": ("{event}", "{sender}: {preview}"),
    # Never the owner's name: that would reveal the assignment on a lock screen (FR-NTF-4).
    "wishlist_updated": ("{event}", "La persona a quien le regalas actualizó su lista de deseos."),
    "exchange_reminder": _reminder,
}
