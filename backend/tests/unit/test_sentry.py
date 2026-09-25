"""Sentry in the worker (and the API): errors arrive tagged and scrubbed (CLAUDE.md §7)."""

import json
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
import sentry_sdk
from sentry_sdk.envelope import Envelope
from sentry_sdk.transport import Transport

from app.core.config import get_settings
from app.core.sentry import init_sentry


class CaptureTransport(Transport):
    def __init__(self) -> None:
        super().__init__()
        self.events: list[dict[str, Any]] = []

    def capture_envelope(self, envelope: Envelope) -> None:
        if (event := envelope.get_event()) is not None:
            self.events.append(event)


@pytest.fixture
def transport() -> Iterator[CaptureTransport]:
    capture = CaptureTransport()
    yield capture
    sentry_sdk.get_global_scope().remove_tag("component")
    sentry_sdk.init()  # no DSN: back to a client that sends nothing


def failing_job(message_text: str, access_token: str) -> None:
    raise RuntimeError("job failed")


def test_no_dsn_no_sentry() -> None:
    assert init_sentry(get_settings().model_copy(update={"sentry_dsn": ""}), component="x") is False


def test_worker_errors_are_tagged_and_scrubbed(transport: CaptureTransport) -> None:
    settings = get_settings().model_copy(update={"sentry_dsn": "https://key@sentry.invalid/1"})
    assert init_sentry(settings, component="worker", transport=transport)
    assert "arq" in sentry_sdk.get_client().integrations  # failed jobs are reported

    # Random runtime values: literals would show up in Sentry's source-context lines.
    body, token, giver, refresh = (uuid.uuid4().hex for _ in range(4))
    with sentry_sdk.new_scope() as scope:
        scope.set_extra("giver_id", giver)
        scope.set_context("job", {"refresh_token": refresh, "event_id": "e1"})
        try:
            failing_job(body, token)
        except RuntimeError:
            sentry_sdk.capture_exception()
    sentry_sdk.flush()

    (event,) = transport.events
    assert event["tags"]["component"] == "worker"
    raw = json.dumps(event)
    assert "job failed" in raw
    assert event["contexts"]["job"]["event_id"] == "e1"
    for secret in (body, token, giver, refresh):
        assert secret not in raw
