"""The pure draw module (PRD §6, CLAUDE.md §7 Draw)."""

import itertools
import random
import secrets
import time
from collections import Counter
from collections.abc import Hashable, Iterable, Sequence

import pytest
from hypothesis import assume, given, settings
from hypothesis import strategies as st

from app.services.draw import DrawInfeasibleError, draw, is_feasible


def assert_valid[T: Hashable](
    result: dict[T, T], participants: Sequence[T], exclusions: Iterable[tuple[T, T]]
) -> None:
    # Bijection: every participant gives once and receives once.
    assert set(result) == set(participants)
    assert sorted(map(repr, result.values())) == sorted(map(repr, participants))
    for giver, receiver in result.items():
        assert giver != receiver
    for a, b in exclusions:
        assert result[a] != b
        assert result[b] != a


def brute_force_feasible(n: int, exclusions: set[tuple[int, int]]) -> bool:
    forbidden = exclusions | {(b, a) for a, b in exclusions}
    return any(
        all(p[i] != i and (i, p[i]) not in forbidden for i in range(n))
        for p in itertools.permutations(range(n))
    )


@st.composite
def events(
    draw_: st.DrawFn, min_n: int = 3, max_n: int = 40
) -> tuple[list[str], list[tuple[str, str]]]:
    n = draw_(st.integers(min_n, max_n))
    people = [f"user-{i}" for i in range(n)]
    pairs = draw_(
        st.lists(
            st.tuples(st.integers(0, n - 1), st.integers(0, n - 1)),
            max_size=n * (n - 1) // 4,
        )
    )
    return people, [(people[a], people[b]) for a, b in pairs]


# ── Properties ───────────────────────────────────────────────────────────────


@settings(max_examples=300, deadline=None)
@given(event=events(), seed=st.integers())
def test_feasible_draws_are_valid(
    event: tuple[list[str], list[tuple[str, str]]], seed: int
) -> None:
    people, exclusions = event
    assume(is_feasible(people, exclusions))
    assert_valid(draw(people, exclusions, random.Random(seed)), people, exclusions)


@settings(max_examples=300, deadline=None)
@given(event=events(max_n=8), seed=st.integers())
def test_draw_raises_exactly_when_infeasible(
    event: tuple[list[str], list[tuple[str, str]]], seed: int
) -> None:
    people, exclusions = event
    if is_feasible(people, exclusions):
        assert_valid(draw(people, exclusions, random.Random(seed)), people, exclusions)
    else:
        with pytest.raises(DrawInfeasibleError):
            draw(people, exclusions, random.Random(seed))


@settings(max_examples=300, deadline=None)
@given(
    n=st.integers(1, 7),
    pairs=st.sets(st.tuples(st.integers(0, 6), st.integers(0, 6)), max_size=15),
)
def test_hopcroft_karp_matches_brute_force(n: int, pairs: set[tuple[int, int]]) -> None:
    exclusions = {(a, b) for a, b in pairs if a < n and b < n}
    assert is_feasible(list(range(n)), exclusions) == brute_force_feasible(n, exclusions)


# ── Fixtures from the PRD ────────────────────────────────────────────────────


def test_one_person_excluded_from_both_others_is_infeasible() -> None:
    people = ["a", "b", "c"]
    exclusions = [("a", "b"), ("a", "c")]
    assert not is_feasible(people, exclusions)
    with pytest.raises(DrawInfeasibleError):
        draw(people, exclusions, random.Random(1))


def test_nuclear_family() -> None:
    family = ["mom", "dad", "kid1", "kid2"]
    others = ["ana", "beto", "caro", "dani"]
    exclusions = list(itertools.combinations(family, 2))
    people = family + others
    assert is_feasible(people, exclusions)
    for seed in range(200):
        result = draw(people, exclusions, random.Random(seed))
        assert_valid(result, people, exclusions)
        # With 4 of 8 mutually excluded, every family member gives outside the family.
        assert all(result[f] in others for f in family)


def test_exclusions_are_symmetric_and_self_pairs_are_harmless() -> None:
    people = ["a", "b", "c"]
    # Only the two 3-cycles exist; one uses a→b, the other b→a. A symmetric exclusion kills
    # both, whichever order the pair is given in.
    for exclusions in ([("a", "b")], [("b", "a")]):
        assert not is_feasible(people, exclusions)
    assert is_feasible(people, [("a", "a")])


def test_accepts_non_string_ids_and_system_random() -> None:
    people = [10, 20, 30, 40]
    result = draw(people, [(10, 20)], secrets.SystemRandom())
    assert_valid(result, people, [(10, 20)])


# ── Input validation ─────────────────────────────────────────────────────────


@pytest.mark.parametrize("people", [[], ["a"], ["a", "b"]])
def test_fewer_than_three_participants(people: list[str]) -> None:
    with pytest.raises(ValueError, match="at least 3"):
        draw(people, [], random.Random(0))


def test_duplicate_ids() -> None:
    with pytest.raises(ValueError, match="duplicate"):
        draw(["a", "b", "a", "c"], [], random.Random(0))
    with pytest.raises(ValueError, match="duplicate"):
        is_feasible(["a", "a", "b"], [])


def test_exclusion_with_unknown_participant() -> None:
    with pytest.raises(ValueError, match="non-participant"):
        is_feasible(["a", "b", "c"], [("a", "z")])


def test_small_events_feasibility_is_mathematical() -> None:
    # The n ≥ 3 rule belongs to the draw; is_feasible answers the graph question only.
    assert is_feasible([], [])
    assert not is_feasible(["a"], [])
    assert is_feasible(["a", "b"], [])


def test_does_not_consume_or_mutate_inputs() -> None:
    people = ["a", "b", "c", "d"]
    exclusions = [("a", "b")]
    draw(people, exclusions, random.Random(0))
    assert people == ["a", "b", "c", "d"]
    assert exclusions == [("a", "b")]


# ── Determinism, performance, distribution ───────────────────────────────────


def test_same_seed_same_result() -> None:
    people = [f"p{i}" for i in range(30)]
    exclusions = [("p0", "p1"), ("p2", "p3"), ("p4", "p5"), ("p0", "p6")]
    first = draw(people, exclusions, random.Random(42))
    assert all(draw(people, exclusions, random.Random(42)) == first for _ in range(5))
    assert any(draw(people, exclusions, random.Random(s)) != first for s in range(1, 6))


def test_large_event_is_fast() -> None:
    setup = random.Random(7)
    people = list(range(200))
    exclusions = [pair for pair in itertools.combinations(people, 2) if setup.random() < 0.3]
    start = time.perf_counter()
    assert is_feasible(people, exclusions)
    result = draw(people, exclusions, random.Random(1))
    elapsed = time.perf_counter() - start
    assert_valid(result, people, exclusions)
    assert elapsed < 1.0, f"took {elapsed:.3f}s"


def test_every_derangement_of_four_appears() -> None:
    people = ["a", "b", "c", "d"]
    derangements = {
        p
        for p in itertools.permutations(people)
        if all(x != y for x, y in zip(people, p, strict=True))
    }
    assert len(derangements) == 9
    rng = random.Random(2024)
    counts = Counter(
        tuple(result[p] for p in people) for result in (draw(people, [], rng) for _ in range(2000))
    )
    assert set(counts) == derangements
    # Rough fairness: uniform would be ~222 each; nothing should be starved.
    assert min(counts.values()) > 100, counts
