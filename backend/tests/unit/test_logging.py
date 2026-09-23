import json
import logging

import pytest
import structlog

from app.core.logging import REDACTED, configure_logging, get_logger, redact, redact_processor
from app.core.sentry import scrub_breadcrumb, scrub_event


@pytest.mark.parametrize(
    "key",
    [
        "token",
        "access_token",
        "refresh_token",
        "invite_token",
        "cookie",
        "Cookie",
        "set-cookie",
        "cookies",
        "authorization",
        "Authorization",
        "body",
        "message_body",
        "giver_id",
        "receiver_id",
        "assignment",
        "assignments",
        "anon_user_id",
        "initiator_user_id",
        "member_user_map",
        "jwt_secret",
        "password",
    ],
)
def test_processor_masks_sensitive_top_level_keys(key: str) -> None:
    out = redact_processor(None, "info", {"event": "x", key: "sensitive-value"})
    assert out[key] == REDACTED
    assert out["event"] == "x"


def test_processor_keeps_safe_keys() -> None:
    event = {"event": "request", "method": "GET", "path": "/api/v1/health", "status": 200}
    assert redact_processor(None, "info", dict(event)) == event


def test_processor_masks_nested_values() -> None:
    event = {
        "event": "x",
        "headers": {"Authorization": "Bearer abc", "Accept": "json"},
        "items": [{"giver_id": "g", "receiver_id": "r", "event_id": "e"}],
        "ctx": ({"message_body": "hola"},),
    }
    out = redact_processor(None, "info", event)
    assert out["headers"] == {"Authorization": REDACTED, "Accept": "json"}
    assert out["items"] == [{"giver_id": REDACTED, "receiver_id": REDACTED, "event_id": "e"}]
    assert out["ctx"] == ({"message_body": REDACTED},)


def test_redact_does_not_mutate_input() -> None:
    original = {"a": {"token": "t"}}
    redact(original)
    assert original == {"a": {"token": "t"}}


def test_configured_logger_emits_redacted_json(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging("INFO")
    try:
        get_logger("test").info(
            "chat_message", conversation_id="c1", body="secret text", access_token="abc"
        )
        logging.getLogger("uvicorn.error").info("stdlib line")
        out = capsys.readouterr().out
    finally:
        structlog.reset_defaults()

    lines = [json.loads(line) for line in out.strip().splitlines()]
    first = lines[0]
    assert first["event"] == "chat_message"
    assert first["conversation_id"] == "c1"
    assert first["body"] == REDACTED
    assert first["access_token"] == REDACTED
    assert first["level"] == "info"
    assert "timestamp" in first
    assert "secret text" not in out
    assert lines[1]["event"] == "stdlib line"


def test_sentry_scrubber_removes_sensitive_data() -> None:
    event = {
        "request": {
            "url": "http://x/api/v1/me",
            "headers": {"Cookie": "access_token=abc", "User-Agent": "ua"},
            "cookies": {"access_token": "abc"},
            "data": {"body": "hello"},
            "query_string": "token=abc",
        },
        "extra": {"giver_id": "gid", "receiver_id": "rid", "event_id": "e"},
        "breadcrumbs": {"values": [{"data": {"refresh_token": "rt"}}]},
    }
    out = scrub_event(event, None)
    serialized = json.dumps(out)
    for secret in ("abc", "hello", "gid", "rid", "rt"):
        assert secret not in serialized
    assert out["request"]["headers"]["User-Agent"] == "ua"
    assert out["extra"]["event_id"] == "e"
    assert scrub_breadcrumb({"data": {"body": "hi"}}, None) == {"data": {"body": REDACTED}}
