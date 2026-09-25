"""Push text per locale (FR-NTF-7): ``render(kind, locale, **params)`` → title and body.

Each locale module maps a kind to ``(title, body)`` format strings. Spanish is the
fallback for an unknown locale, like the UI.
"""

from dataclasses import dataclass
from typing import Any, Final

from app.notifications.templates import en, es

_LOCALES: Final[dict[str, dict[str, tuple[str, str]]]] = {"es": es.TEMPLATES, "en": en.TEMPLATES}
DEFAULT_LOCALE: Final = "es"


@dataclass(frozen=True, slots=True)
class Rendered:
    title: str
    body: str


def render(kind: str, locale: str, **params: Any) -> Rendered:
    templates = _LOCALES.get(locale, _LOCALES[DEFAULT_LOCALE])
    title, body = templates[kind]
    return Rendered(title=title.format(**params), body=body.format(**params))
