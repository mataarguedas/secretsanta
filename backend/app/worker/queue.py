"""Background jobs that must only run once the database change is durable.

``enqueue_after_commit(session, "delete_objects", keys)`` parks a job on the session. A
commit promotes it; a rollback throws it away. The request's DB dependency then sends the
committed jobs to arq (``flush_committed_jobs``). So an R2 object is never deleted for a
row that still exists, e.g. when a transaction fails half-way (CLAUDE.md §7).
"""

from typing import Any, Final

from arq.connections import ArqRedis
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session, SessionTransaction

from app.core.logging import get_logger

log = get_logger(__name__)

_PENDING: Final = "jobs_pending_commit"
_COMMITTED: Final = "jobs_committed"

Job = tuple[str, tuple[Any, ...]]


def enqueue_after_commit(session: AsyncSession, task: str, *args: Any) -> None:
    session.sync_session.info.setdefault(_PENDING, []).append((task, args))


def enqueue_committed(session: AsyncSession, task: str, *args: Any) -> None:
    """For hooks that run once their change is already committed (e.g. push tasks after a
    message is saved and published): queued for the same ``flush_committed_jobs``."""
    session.sync_session.info.setdefault(_COMMITTED, []).append((task, args))


@event.listens_for(Session, "after_commit")
def _promote(session: Session) -> None:
    pending: list[Job] = session.info.pop(_PENDING, [])
    if pending:
        session.info.setdefault(_COMMITTED, []).extend(pending)


@event.listens_for(Session, "after_soft_rollback")
def _discard(session: Session, _previous: SessionTransaction) -> None:
    session.info.pop(_PENDING, None)


def committed_jobs(session: AsyncSession) -> list[Job]:
    """Jobs whose transaction committed and that haven't been sent yet (for tests)."""
    return list(session.sync_session.info.get(_COMMITTED, []))


async def flush_committed_jobs(session: AsyncSession, pool: ArqRedis | None) -> int:
    """Send committed jobs to arq. Failures are logged, never raised: at worst an orphan
    object stays in storage or a push is missed, both harmless."""
    jobs: list[Job] = session.sync_session.info.pop(_COMMITTED, [])
    if not jobs:
        return 0
    if pool is None:
        log.warning("jobs_dropped_no_queue", count=len(jobs))
        return 0
    sent = 0
    for task, args in jobs:
        try:
            await pool.enqueue_job(task, *args)
            sent += 1
        except Exception:  # never fail the request over cleanup
            log.exception("job_enqueue_failed", task=task)
    return sent
