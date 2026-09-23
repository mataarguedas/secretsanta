import time
import uuid

import pytest

from app.db import uuid7 as uuid7_module
from app.db.uuid7 import uuid7, uuid7_timestamp_ms


def test_version_and_variant() -> None:
    value = uuid7()
    assert isinstance(value, uuid.UUID)
    assert value.version == 7
    assert value.variant == uuid.RFC_4122


def test_embeds_current_unix_ms() -> None:
    before = time.time_ns() // 1_000_000
    value = uuid7()
    after = time.time_ns() // 1_000_000
    # The counter may borrow a few ms under heavy load.
    assert before <= uuid7_timestamp_ms(value) <= after + 5


def test_strictly_time_ordered_and_unique() -> None:
    values = [uuid7() for _ in range(20_000)]
    assert values == sorted(values)
    assert len(set(values)) == len(values)
    # Also ordered as strings (how they sort in JSON and in Postgres).
    as_str = [str(v) for v in values]
    assert as_str == sorted(as_str)


def test_ordered_across_milliseconds() -> None:
    first = uuid7()
    time.sleep(0.005)
    second = uuid7()
    assert uuid7_timestamp_ms(second) > uuid7_timestamp_ms(first)
    assert second > first


def test_monotonic_when_clock_is_frozen_or_goes_backwards(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    frozen_ns = [time.time_ns() + 10_000_000_000]  # in the future, beyond any earlier id
    monkeypatch.setattr(uuid7_module.time, "time_ns", lambda: frozen_ns[0])

    # Enough ids in one "millisecond" to overflow the 12-bit counter several times.
    values = [uuid7() for _ in range(10_000)]
    frozen_ns[0] -= 5_000_000_000  # the clock steps back 5 s
    values += [uuid7() for _ in range(100)]

    assert values == sorted(values)
    assert len(set(values)) == len(values)
    assert all(v.version == 7 for v in values)
