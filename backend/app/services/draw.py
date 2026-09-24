"""The draw (PRD §6). PURE: no I/O, no DB, no logging — and never log what it returns.

A draw is a permutation ``s`` of the participants with ``s(i) != i`` and no excluded pair
in either direction. Seen as a bipartite graph "givers x receivers, edge when allowed", a
valid draw exists iff that graph has a perfect matching (Hopcroft-Karp).

The random draw walks the givers in shuffled order and gives each one a receiver picked in
shuffled order, but only commits a choice when the rest of the graph still has a perfect
matching. That check is incremental: we keep a perfect matching of the remaining graph and,
after tentatively taking ``giver → receiver``, look for one augmenting path to repair it.
So once feasibility is proven the walk cannot dead-end, and a draw of n = 200 costs a few
milliseconds. A single cycle is not required (PRD §6.3).

Everything runs on indices ``0..n-1`` in input order, so the result depends only on the
input order and the injected RNG (never on ``hash()`` of the ids).
"""

import random
from collections.abc import Hashable, Iterable, Sequence
from typing import Final

MIN_PARTICIPANTS: Final = 3
MAX_RESTARTS: Final = 1000


class DrawInfeasibleError(Exception):
    """No assignment satisfies the exclusions."""


def is_feasible[T: Hashable](participants: Sequence[T], exclusions: Iterable[tuple[T, T]]) -> bool:
    """Whether a valid assignment exists. Does not enforce the n ≥ 3 product rule.

    Raises ``ValueError`` on duplicate participants or exclusions naming a non-participant.
    """
    adj = _allowed_graph(participants, exclusions)
    size, _, _ = _hopcroft_karp(adj)
    return size == len(adj)


def draw[T: Hashable](
    participants: Sequence[T], exclusions: Iterable[tuple[T, T]], rng: random.Random
) -> dict[T, T]:
    """A random valid assignment ``{giver: receiver}``.

    Raises ``ValueError`` when there are fewer than 3 participants, duplicates, or exclusions
    naming a non-participant, and ``DrawInfeasibleError`` when no valid assignment exists.
    """
    if len(participants) < MIN_PARTICIPANTS:
        raise ValueError(f"a draw needs at least {MIN_PARTICIPANTS} participants")
    adj = _allowed_graph(participants, exclusions)
    size, match_l, match_r = _hopcroft_karp(adj)
    if size != len(adj):
        raise DrawInfeasibleError

    for _ in range(MAX_RESTARTS):
        result = _attempt(adj, list(match_l), list(match_r), rng)
        if result is not None:
            return {participants[g]: participants[r] for g, r in result.items()}
    # Unreachable once feasibility is proven; kept as the documented safety net.
    raise DrawInfeasibleError  # pragma: no cover


# ── Internals ────────────────────────────────────────────────────────────────


def _allowed_graph[T: Hashable](
    participants: Sequence[T], exclusions: Iterable[tuple[T, T]]
) -> list[list[int]]:
    """``adj[giver]`` = receivers the giver may draw, as ascending indices."""
    index: dict[T, int] = {}
    for i, p in enumerate(participants):
        if p in index:
            raise ValueError("duplicate participant id")
        index[p] = i

    n = len(participants)
    forbidden: list[set[int]] = [{i} for i in range(n)]
    for a, b in exclusions:
        ia, ib = index.get(a), index.get(b)
        if ia is None or ib is None:
            raise ValueError("exclusion names a non-participant")
        forbidden[ia].add(ib)
        forbidden[ib].add(ia)
    return [[j for j in range(n) if j not in forbidden[i]] for i in range(n)]


def _hopcroft_karp(adj: list[list[int]]) -> tuple[int, list[int], list[int]]:
    """Maximum matching of the square bipartite graph ``adj``.

    Returns ``(size, match_l, match_r)`` with ``-1`` for unmatched vertices. The DFS is
    iterative so large events can't hit the recursion limit.
    """
    n = len(adj)
    match_l = [-1] * n
    match_r = [-1] * n
    size = 0
    while True:
        # BFS: layer the free givers and everything reachable along alternating paths.
        dist = [-1] * n
        queue = [u for u in range(n) if match_l[u] == -1]
        for u in queue:
            dist[u] = 0
        found = False
        head = 0
        while head < len(queue):
            u = queue[head]
            head += 1
            for v in adj[u]:
                w = match_r[v]
                if w == -1:
                    found = True
                elif dist[w] == -1:
                    dist[w] = dist[u] + 1
                    queue.append(w)
        if not found:
            return size, match_l, match_r

        # DFS: vertex-disjoint augmenting paths along the layers.
        cursor = [0] * n
        for root in range(n):
            if match_l[root] != -1:
                continue
            stack = [root]  # givers on the path
            path: list[int] = []  # receivers on the path; path[k] follows stack[k]
            while stack:
                u = stack[-1]
                advanced = False
                while cursor[u] < len(adj[u]):
                    v = adj[u][cursor[u]]
                    cursor[u] += 1
                    w = match_r[v]
                    if w == -1:
                        path.append(v)
                        for x, y in zip(stack, path, strict=True):
                            match_l[x] = y
                            match_r[y] = x
                        size += 1
                        stack = []
                        advanced = True
                        break
                    if dist[w] == dist[u] + 1:
                        path.append(v)
                        stack.append(w)
                        advanced = True
                        break
                if not advanced:
                    dist[u] = -1  # dead end for this phase
                    stack.pop()
                    if path:
                        path.pop()


def _attempt(
    adj: list[list[int]], match_l: list[int], match_r: list[int], rng: random.Random
) -> dict[int, int] | None:
    """One randomized pass. ``match_l``/``match_r`` start as a perfect matching (mutated)."""
    n = len(adj)
    used_l = [False] * n
    used_r = [False] * n
    givers = list(range(n))
    rng.shuffle(givers)

    result: dict[int, int] = {}
    for g in givers:
        candidates = [r for r in adj[g] if not used_r[r]]
        rng.shuffle(candidates)
        for r in candidates:
            if _take(adj, match_l, match_r, used_l, used_r, g, r):
                result[g] = r
                break
        else:  # pragma: no cover - impossible while the matching invariant holds
            return None
    return result


def _take(
    adj: list[list[int]],
    match_l: list[int],
    match_r: list[int],
    used_l: list[bool],
    used_r: list[bool],
    g: int,
    r: int,
) -> bool:
    """Commit ``g → r`` if the remaining graph keeps a perfect matching; else change nothing.

    Invariant: ``match_l``/``match_r`` hold a perfect matching of the unused vertices.
    """
    if match_l[g] == r:
        used_l[g] = used_r[r] = True
        return True

    # Taking g → r frees g's old receiver r2 and r's old giver g2. The rest stays perfect
    # iff one augmenting path g2 ⇝ r2 exists that avoids the used vertices.
    g2, r2 = match_r[r], match_l[g]
    match_l[g], match_r[r] = r, g
    match_l[g2], match_r[r2] = -1, -1
    used_l[g] = used_r[r] = True

    parent = [-1] * len(adj)  # receiver → giver that reached it
    queue = [g2]
    head = 0
    while head < len(queue):
        u = queue[head]
        head += 1
        for v in adj[u]:
            if used_r[v] or parent[v] != -1:
                continue
            parent[v] = u
            if v == r2:  # the only free unused receiver: flip the path
                while True:
                    u = parent[v]
                    previous = match_l[u]
                    match_l[u], match_r[v] = v, u
                    if u == g2:
                        return True
                    v = previous
            queue.append(match_r[v])

    # No path: undo.
    used_l[g] = used_r[r] = False
    match_l[g], match_r[r2] = r2, g
    match_l[g2], match_r[r] = r, g2
    return False
