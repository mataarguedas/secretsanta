"""Users (PRD §7). Created on first Google sign-in."""

from typing import Final

from sqlalchemy import Boolean, CheckConstraint, Text, false, true
from sqlalchemy.dialects.postgresql import CITEXT
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TimestampMixin, UUIDPrimaryKeyMixin

SUPPORTED_LOCALES: Final[tuple[str, ...]] = ("es", "en")
DEFAULT_LOCALE: Final = "es"


class User(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "users"
    __table_args__ = (CheckConstraint("locale IN ('es', 'en')", name="locale_supported"),)

    google_sub: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    email: Mapped[str] = mapped_column(CITEXT, unique=True, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    # Set once the user picks their own name (Profile): sign-in then stops overwriting it
    # with the Google name, e.g. a parent's account used for their baby.
    name_customized: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    locale: Mapped[str] = mapped_column(
        Text, nullable=False, default=DEFAULT_LOCALE, server_default=DEFAULT_LOCALE
    )
    notify_message: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=true()
    )
    notify_wishlist: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=true()
    )
    notify_reminder: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=true()
    )

    def __repr__(self) -> str:  # never include email/name: reprs end up in logs
        return f"<User {self.id}>"
