"""SQLAlchemy models, one module per aggregate.

Import every model module here so ``Base.metadata`` is complete for Alembic
autogenerate and for the test schema.
"""

from app.db.base import Base
from app.models.assignment import Assignment
from app.models.event import Event, EventParticipant, EventState
from app.models.exclusion import Exclusion
from app.models.refresh_token import RefreshToken
from app.models.user import User

__all__ = [
    "Assignment",
    "Base",
    "Event",
    "EventParticipant",
    "EventState",
    "Exclusion",
    "RefreshToken",
    "User",
]
