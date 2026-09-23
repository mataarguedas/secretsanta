"""Every registered error code is translated in both frontend locales (PROMPTS.md rule 5).

The frontend maps ``error.code`` to ``t("errors.<CODE>")``; a missing key would show the
generic fallback instead of a real message, so a new code without translations fails here.
"""

import json
from pathlib import Path
from typing import Any

import pytest

from app.core.errors import ERROR_REGISTRY

I18N_DIR = Path(__file__).resolve().parents[3] / "frontend" / "src" / "i18n"
LOCALES = ("es", "en")
# Client-side codes the frontend raises itself; UNKNOWN_ERROR is the generic fallback.
CLIENT_CODES = ("NETWORK_ERROR", "UNKNOWN_ERROR", "UNAUTHENTICATED")


def load_errors(locale: str) -> dict[str, Any]:
    data = json.loads((I18N_DIR / f"{locale}.json").read_text(encoding="utf-8"))
    errors = data.get("errors")
    assert isinstance(errors, dict), f"{locale}.json has no 'errors' object"
    return errors


@pytest.mark.parametrize("locale", LOCALES)
def test_every_registered_error_code_is_translated(locale: str) -> None:
    errors = load_errors(locale)
    missing = [
        code
        for code in (*ERROR_REGISTRY, *CLIENT_CODES)
        if not isinstance(errors.get(code), str) or not errors[code].strip()
    ]
    assert not missing, f"{locale}.json is missing errors.{{{', '.join(missing)}}}"


def test_registry_codes_are_screaming_snake() -> None:
    for code in ERROR_REGISTRY:
        assert code.isupper()
        assert code.replace("_", "").isalnum()
