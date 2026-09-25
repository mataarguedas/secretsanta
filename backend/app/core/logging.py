"""Structured JSON logging with redaction of sensitive fields.

The same redaction rules back the Sentry ``before_send`` scrubber
(see ``app/core/sentry.py``), so logs and error reports never contain
tokens, cookies, message bodies, assignment pairs or anonymous-member mappings.
"""

import logging
import sys
from collections.abc import Mapping, MutableMapping
from typing import Any

import structlog

REDACTED = "[REDACTED]"

# Keys that are redacted when they match exactly (case-insensitive).
SENSITIVE_KEYS: frozenset[str] = frozenset(
    {
        "body",
        "message_body",
        "giver_id",
        "receiver_id",
        "giver",
        "receiver",
        "pairs",
        # anonymous conversation member → user mappings
        "anon_user_id",
        "anonymous_user_id",
        "initiator_user_id",
        "anon_member_map",
        "member_user_map",
        "anon_mapping",
        # Web Push: the endpoint is a capability URL, the keys encrypt the payload
        "endpoint",
        "p256dh",
        "auth",
    }
)

# Keys that are redacted when they contain any of these fragments (case-insensitive),
# e.g. ``access_token``, ``refresh_token``, ``Set-Cookie``, ``cookies``, ``assignments``.
SENSITIVE_FRAGMENTS: tuple[str, ...] = (
    "token",
    "cookie",
    "authorization",
    "password",
    "secret",
    "assignment",
)


def is_sensitive_key(key: object) -> bool:
    if not isinstance(key, str):
        return False
    lowered = key.lower()
    return lowered in SENSITIVE_KEYS or any(frag in lowered for frag in SENSITIVE_FRAGMENTS)


def redact(value: Any) -> Any:
    """Return a copy of ``value`` with sensitive keys masked, recursing into containers."""
    if isinstance(value, Mapping):
        return {k: (REDACTED if is_sensitive_key(k) else redact(v)) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return type(value)(redact(v) for v in value)
    return value


def redact_processor(
    _logger: Any, _method_name: str, event_dict: MutableMapping[str, Any]
) -> MutableMapping[str, Any]:
    """structlog processor: mask sensitive keys anywhere in the event."""
    for key in list(event_dict.keys()):
        if key == "event":
            continue
        event_dict[key] = REDACTED if is_sensitive_key(key) else redact(event_dict[key])
    return event_dict


def _shared_processors() -> list[structlog.types.Processor]:
    return [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        redact_processor,
    ]


def configure_logging(level: str = "INFO") -> None:
    """Route both structlog and stdlib logging (uvicorn, arq, sqlalchemy) to one JSON stream."""
    shared = _shared_processors()

    structlog.configure(
        processors=[
            *shared,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    formatter = structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=shared,
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            structlog.processors.dict_tracebacks,
            structlog.processors.JSONRenderer(),
        ],
    )
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level.upper())

    # Uvicorn installs its own handlers; send its lifecycle logs through ours.
    for name in ("uvicorn", "uvicorn.error"):
        uv_logger = logging.getLogger(name)
        uv_logger.handlers.clear()
        uv_logger.propagate = True
    # Our access-log middleware replaces uvicorn's (which prints raw paths and query strings).
    access = logging.getLogger("uvicorn.access")
    access.handlers.clear()
    access.propagate = False
    access.disabled = True
    # SQL logging would print statement parameters, e.g. the assignment INSERTs (the whole
    # draw). Pin it off whatever LOG_LEVEL says (CLAUDE.md §7 Logging).
    for name in ("sqlalchemy", "sqlalchemy.engine", "sqlalchemy.pool"):
        logging.getLogger(name).setLevel(logging.WARNING)


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    logger: structlog.stdlib.BoundLogger = structlog.stdlib.get_logger(name)
    return logger
