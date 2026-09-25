"""SQLAlchemy models, one module per aggregate.

Import every model module here so ``Base.metadata`` is complete for Alembic
autogenerate and for the test schema.
"""

from app.db.base import Base
from app.models.assignment import Assignment
from app.models.chat import Conversation, ConversationKind, ConversationMember, Message
from app.models.event import Event, EventParticipant, EventState
from app.models.exclusion import Exclusion
from app.models.notification_log import NotificationLog
from app.models.push import PushSubscription
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.models.wishlist import WishlistItem, WishlistPhoto

__all__ = [
    "Assignment",
    "Base",
    "Conversation",
    "ConversationKind",
    "ConversationMember",
    "Event",
    "EventParticipant",
    "EventState",
    "Exclusion",
    "Message",
    "NotificationLog",
    "PushSubscription",
    "RefreshToken",
    "User",
    "WishlistItem",
    "WishlistPhoto",
]
