"""require_event_state maps each disallowed state to its specific 409 code."""

import uuid

import pytest

from app.api.deps import EventAccess, require_event_state
from app.core.errors import AppError
from app.models import Event, EventState, User


def access(state: EventState) -> EventAccess:
    user = User(id=uuid.uuid4(), google_sub="s", email="a@b.c", name="A")
    event = Event(id=uuid.uuid4(), host_id=user.id, state=state)
    return EventAccess(event=event, user=user)


@pytest.mark.parametrize(
    ("allowed", "actual", "code"),
    [
        ((EventState.OPEN,), EventState.DRAWN, "EVENT_ALREADY_DRAWN"),
        ((EventState.OPEN,), EventState.ARCHIVED, "EVENT_ARCHIVED"),
        ((EventState.OPEN, EventState.DRAWN), EventState.ARCHIVED, "EVENT_ARCHIVED"),
        ((EventState.DRAWN,), EventState.OPEN, "EVENT_NOT_DRAWN"),
    ],
)
async def test_wrong_state_is_a_specific_409(
    allowed: tuple[EventState, ...], actual: EventState, code: str
) -> None:
    with pytest.raises(AppError) as exc_info:
        await require_event_state(*allowed)(access(actual))
    assert exc_info.value.http_status == 409
    assert exc_info.value.code == code


async def test_allowed_state_passes_through() -> None:
    given = access(EventState.DRAWN)
    assert await require_event_state(EventState.OPEN, EventState.DRAWN)(given) is given


def test_host_flag() -> None:
    given = access(EventState.OPEN)
    assert given.is_host
    other = EventAccess(event=given.event, user=User(id=uuid.uuid4()))
    assert not other.is_host


@pytest.mark.parametrize("actual", [EventState.DRAWN, EventState.ARCHIVED])
async def test_roster_mode_reports_every_frozen_state_as_already_drawn(
    actual: EventState,
) -> None:
    with pytest.raises(AppError) as exc_info:
        await require_event_state(EventState.OPEN, roster=True)(access(actual))
    assert exc_info.value.code == "EVENT_ALREADY_DRAWN"
