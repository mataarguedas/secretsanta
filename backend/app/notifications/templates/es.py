"""Plantillas de notificaciones push en español (es-CR)."""

from typing import Final

TEMPLATES: Final[dict[str, tuple[str, str]]] = {
    "test": ("Secret Santa", "Notificación de prueba: las notificaciones funcionan."),
    # TODO(prompt 25): reveal, message, wishlist_updated, exchange_reminder.
}
