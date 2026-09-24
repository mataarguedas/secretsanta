"""Logs and error reports never carry assignment pairs (CLAUDE.md §2.1, §7 Logging)."""

import json
import logging
import re

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from structlog.testing import capture_logs

from app.core.logging import REDACTED
from app.core.sentry import scrub_breadcrumb, scrub_event
from tests.api.auth_helpers import CSRF
from tests.api.event_helpers import EVENTS
from tests.invariants.drawn import open_event

ROLE_WORDS = re.compile(r"receiver|giver", re.IGNORECASE)


async def test_a_draw_logs_no_pairs(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    caplog: pytest.LogCaptureFixture,
) -> None:
    event, ids = await open_event(client, db)
    people = {str(uid) for uid in ids.values()}

    caplog.set_level(logging.DEBUG)
    with capture_logs() as structured:
        drawn = await client.post(f"{EVENTS}/{event['id']}/draw", headers=CSRF)
        again = await client.post(f"{EVENTS}/{event['id']}/draw", headers=CSRF)  # 409 path
    assert (drawn.status_code, again.status_code) == (200, 409)

    lines = [str(vars(record)) for record in caplog.records]
    lines += [json.dumps(entry, default=str) for entry in structured]
    assert lines, "expected the request log at least"
    for line in lines:
        present = {uid for uid in people if uid in line}
        assert len(present) < 2, f"a log line holds two participant ids: {line}"
        assert not (present and ROLE_WORDS.search(line)), f"ids next to giver/receiver: {line}"


def test_sql_logging_stays_off_even_at_debug() -> None:
    """SQL echo would print the INSERT parameters, i.e. the whole draw."""
    for name in ("sqlalchemy.engine", "sqlalchemy.engine.Engine", "sqlalchemy.pool"):
        assert logging.getLogger(name).getEffectiveLevel() >= logging.WARNING, name


def test_sentry_scrubber_drops_assignment_and_token_fields() -> None:
    event = {
        "extra": {
            "my_assignment": {"receiver": {"user_id": "rid-1", "name": "Carla"}},
            "assignments": [{"giver_id": "gid-2", "receiver_id": "rid-2"}],
            "receiver": "rid-3",
            "giver": "gid-3",
            "pairs": {"gid-4": "rid-4"},
            "access_token": "tok-1",
            "refresh_token": "tok-2",
            "event_id": "keep-me",
        },
        "request": {"headers": {"Cookie": "access_token=tok-3"}, "cookies": {"a": "tok-4"}},
    }
    out = json.dumps(scrub_event(event, None))
    for secret in ("rid-1", "Carla", "gid-2", "rid-2", "rid-3", "gid-3", "rid-4", "tok-"):
        assert secret not in out
    assert "keep-me" in out
    crumb = scrub_breadcrumb({"data": {"receiver_id": "r", "giver_id": "g", "path": "/x"}}, None)
    assert crumb == {"data": {"receiver_id": REDACTED, "giver_id": REDACTED, "path": "/x"}}
