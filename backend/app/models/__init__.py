"""SQLAlchemy models, one module per aggregate.

Import every model module here so ``Base.metadata`` is complete for Alembic
autogenerate and for the test schema.
"""

from app.db.base import Base

__all__ = ["Base"]
