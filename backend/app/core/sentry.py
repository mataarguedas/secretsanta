"""Sentry setup. Only initialised when ``SENTRY_DSN`` is set."""

from typing import Any

import sentry_sdk

from app.core.config import Settings
from app.core.logging import redact


def scrub_event(event: Any, _hint: Any) -> Any:
    """``before_send``: apply the log redaction rules and drop raw request data."""
    request = event.get("request")
    if isinstance(request, dict):
        request.pop("data", None)
        request.pop("query_string", None)
        request.pop("cookies", None)
    return redact(event)


def scrub_breadcrumb(crumb: Any, _hint: Any) -> Any:
    return redact(crumb)


def init_sentry(settings: Settings, *, component: str, transport: Any = None) -> bool:
    """``component`` is ``api`` or ``worker``. The FastAPI and arq integrations switch on
    automatically, so failed worker jobs are reported too. ``transport`` is for tests."""
    if not settings.sentry_dsn:
        return False
    options: dict[str, Any] = {"transport": transport} if transport is not None else {}
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.env,
        send_default_pii=False,
        traces_sample_rate=0.0,
        max_request_body_size="never",
        # Stack-frame locals could hold a message body under any variable name.
        include_local_variables=False,
        before_send=scrub_event,
        before_breadcrumb=scrub_breadcrumb,
        **options,
    )
    # The global scope, so every job and request carries it, whatever scope it runs in.
    sentry_sdk.get_global_scope().set_tag("component", component)
    return True
