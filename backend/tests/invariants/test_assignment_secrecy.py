"""Invariant 1 — assignment secrecy (CLAUDE.md §2.1, PRD FR-DRW-5, §13.3).

Every GET route is discovered from the app. A route this test doesn't know how to call
fails the test, so a new endpoint can't ship without being checked here. Each route is
called as the host and as every participant; the only assignment data allowed anywhere
is the caller's own, at ``my_assignment.receiver``.
"""

import json
import uuid
from collections.abc import Callable, Iterator
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from tests.api.auth_helpers import login_as
from tests.invariants.drawn import PEOPLE, DrawnEvent, drawn_event

API = "/api/v1"

# Path template → concrete URLs to call for this event. `None` = not data (docs/schema).
RouteCalls = Callable[[DrawnEvent], list[str]] | None
GET_ROUTES: dict[str, RouteCalls] = {
    f"{API}/openapi.json": None,
    f"{API}/docs": None,
    "/docs/oauth2-redirect": None,
    f"{API}/health": lambda d: [f"{API}/health"],
    f"{API}/auth/google/login": lambda d: [f"{API}/auth/google/login"],
    f"{API}/auth/google/callback": lambda d: [f"{API}/auth/google/callback"],
    f"{API}/me": lambda d: [f"{API}/me"],
    f"{API}/events": lambda d: [
        f"{API}/events?section={section}" for section in ("hosting", "participating", "past")
    ],
    f"{API}/events/{{event_id}}": lambda d: [f"{API}/events/{d.id}"],
    f"{API}/events/{{event_id}}/participants": lambda d: [f"{API}/events/{d.id}/participants"],
    f"{API}/events/{{event_id}}/exclusions": lambda d: [f"{API}/events/{d.id}/exclusions"],
    f"{API}/invites/{{token}}": lambda d: [f"{API}/invites/{d.invite_token}"],
    f"{API}/events/{{event_id}}/wishlists/{{user_id}}": lambda d: [
        f"{API}/events/{d.id}/wishlists/{uid}" for uid in d.receiver_of
    ],
    f"{API}/events/{{event_id}}/wishlist/copy-sources": lambda d: [
        f"{API}/events/{d.id}/wishlist/copy-sources"
    ],
    f"{API}/conversations": lambda d: [
        f"{API}/conversations",
        f"{API}/conversations?event_id={d.id}",
    ],
    f"{API}/conversations/{{conversation_id}}": lambda d: [
        f"{API}/conversations/{d.group_conversation_id}"
    ],
    f"{API}/conversations/{{conversation_id}}/messages": lambda d: [
        f"{API}/conversations/{d.group_conversation_id}/messages"
    ],
}

# Keys that carry draw data. Only `my_assignment` (top level) → `receiver` is allowed.
DRAW_KEYS = {"receiver", "giver", "receiver_id", "giver_id", "pairs"}


def get_routes(app: FastAPI) -> set[str]:
    """Every GET path, including routes of nested included routers."""

    def walk(routes: list[Any], prefix: str = "") -> Iterator[str]:
        for route in routes:
            if hasattr(route, "original_router"):  # FastAPI's included-router wrapper
                inner_prefix = getattr(route.include_context, "prefix", "") or ""
                yield from walk(route.original_router.routes, prefix + inner_prefix)
            elif "GET" in (getattr(route, "methods", None) or ()):
                yield prefix + route.path

    return set(walk(app.routes))


def leaks(value: Any, path: tuple[str, ...] = ()) -> Iterator[str]:
    """Draw data anywhere except ``my_assignment.receiver`` (and its fields)."""
    if isinstance(value, dict):
        for key, child in value.items():
            here = (*path, key)
            allowed = here == ("my_assignment",) or here[:2] == ("my_assignment", "receiver")
            if not allowed and (key in DRAW_KEYS or "assignment" in key.lower()):
                yield ".".join(here)
            if not allowed or here == ("my_assignment",):
                yield from leaks(child, here)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            if isinstance(child, dict) and ({"giver", "receiver"} & child.keys()):
                yield f"{'.'.join(path)}[{index}] is an assignment list"
            yield from leaks(child, (*path, str(index)))


def body(response: httpx.Response) -> Any:
    try:
        return response.json()
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None


def test_every_get_route_is_covered(app: FastAPI) -> None:
    routes = get_routes(app)
    unknown = routes - GET_ROUTES.keys()
    assert not unknown, (
        f"GET routes not covered by the secrecy test: {sorted(unknown)}. Add them to "
        "GET_ROUTES in tests/invariants/test_assignment_secrecy.py."
    )
    stale = GET_ROUTES.keys() - routes
    assert not stale, f"GET_ROUTES lists routes that no longer exist: {sorted(stale)}"


def test_leak_detector_catches_other_pairs() -> None:
    """The detector itself: it must flag draw data anywhere but the caller's own slot."""
    ok = {"my_assignment": {"receiver": {"user_id": "r", "name": "R", "avatar_url": None}}}
    assert list(leaks(ok)) == []
    assert list(leaks({"items": [{"giver": {}, "receiver": {}}]}))
    assert list(leaks({"participants": [{"user_id": "x", "receiver_id": "y"}]}))
    assert list(leaks({"assignments": []}))
    assert list(leaks({"my_assignment": {"receiver": {}, "giver": {}}}))
    assert list(leaks({"host": {"my_assignment": {"receiver": {}}}}))


@pytest.mark.parametrize("caller", [p[0] for p in PEOPLE])
async def test_no_route_exposes_another_givers_pair(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    app: FastAPI,
    caller: str,
) -> None:
    drawn = await drawn_event(client, db)
    me = drawn.ids[caller]
    await login_as(client, caller, dict(PEOPLE)[caller])

    checked = 0
    for template in sorted(get_routes(app)):
        calls = GET_ROUTES[template]
        if calls is None:
            continue
        for url in calls(drawn):
            response = await client.get(url, follow_redirects=False)
            data = body(response)
            assert not list(leaks(data)), f"{caller} GET {template}: {list(leaks(data))}"
            _assert_no_foreign_pair(response.text, drawn, me, f"{caller} GET {template}")
            checked += 1

            if template == f"{API}/events/{{event_id}}":
                real = drawn.receiver_of[me]
                assert data["my_assignment"]["receiver"]["user_id"] == str(real)
    assert checked >= 10


def _assert_no_foreign_pair(text: str, drawn: DrawnEvent, me: uuid.UUID, where: str) -> None:
    """Belt and braces: no other giver's receiver id sits in the same JSON object as that
    giver's id (the participant list holds everyone, but as separate objects)."""
    data = body_from_text(text)
    for giver, receiver in drawn.receiver_of.items():
        if giver == me:
            continue
        for obj in objects(data):
            values = json.dumps(obj)
            nested = any(isinstance(v, dict | list) for v in obj.values())
            if not nested and str(giver) in values and str(receiver) in values:
                pytest.fail(f"{where}: an object ties {giver} to their receiver: {obj}")


def body_from_text(text: str) -> Any:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


def objects(value: Any) -> Iterator[dict[str, Any]]:
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from objects(child)
    elif isinstance(value, list):
        for child in value:
            yield from objects(child)
