"""Push text per locale (FR-NTF-7): ``render(kind, locale, **params)`` → title and body.

Each locale module maps a kind to ``(title, body)`` format strings, or to a function of the
params for text that needs grammar (plurals). Spanish is the fallback for an unknown
locale, like the UI. Money is ``format_crc`` (``₡25 000``, PRD FR-I18N-3).

Sender names in message pushes are localized here too: pass ``anon_number`` for an
anonymous sender ("Elfo secreto #N" / "Secret Elf #N"), ``former=True`` for someone who
left, else ``sender``.
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any, Final

from app.notifications.templates import en, es
from app.notifications.text import format_crc, preview

__all__ = ["Rendered", "format_crc", "preview", "render", "sender_label"]

Template = tuple[str, str] | Callable[[Mapping[str, Any]], tuple[str, str]]

_LOCALES: Final[dict[str, Any]] = {"es": es, "en": en}
DEFAULT_LOCALE: Final = "es"


@dataclass(frozen=True, slots=True)
class Rendered:
    title: str
    body: str


def _locale(locale: str) -> Any:
    return _LOCALES.get(locale, _LOCALES[DEFAULT_LOCALE])


def sender_label(
    locale: str, *, sender: str | None = None, anon_number: int | None = None, former: bool = False
) -> str:
    module = _locale(locale)
    if anon_number is not None:
        return str(module.ELF_ALIAS.format(n=anon_number))
    if former or not sender:
        return str(module.FORMER_MEMBER)
    return sender


def render(kind: str, locale: str, **params: Any) -> Rendered:
    template: Template = _locale(locale).TEMPLATES[kind]
    if callable(template):
        title, body = template(params)
    else:
        title, body = (part.format(**params) for part in template)
    return Rendered(title=title, body=body)
