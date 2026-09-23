"""The UUIDv7 and timestamp mixins against real Postgres."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import String, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class MixinProbe(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "test_mixin_probe"
    name: Mapped[str] = mapped_column(String(20))


async def test_mixins_generate_uuid7_and_utc_timestamps(db_session: AsyncSession) -> None:
    db_session.add(MixinProbe(name="a"))
    await db_session.flush()

    loaded = (await db_session.execute(select(MixinProbe))).scalar_one()
    assert loaded.id.version == 7
    assert loaded.created_at.utcoffset() == timedelta(0)
    assert abs(datetime.now(UTC) - loaded.created_at) < timedelta(minutes=1)
    assert loaded.updated_at >= loaded.created_at
