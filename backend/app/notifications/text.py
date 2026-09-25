"""Text helpers shared by the push templates."""

from typing import Final

PREVIEW_CHARS: Final = 80
NO_BREAK_SPACE: Final = "\u00a0"  # what Intl uses between groups in es-CR


def format_crc(amount: int) -> str:
    """``₡25 000``: es-CR grouping with a no-break space, no decimals (PRD FR-I18N-3)."""
    return "₡" + f"{amount:,}".replace(",", NO_BREAK_SPACE)


def preview(text: str, limit: int = PREVIEW_CHARS) -> str:
    """The first ``limit`` characters of a message, with an ellipsis if cut (FR-NTF-5)."""
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"
