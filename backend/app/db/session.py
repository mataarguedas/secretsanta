from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker


def create_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    # expire_on_commit=False: objects stay usable for serialization after commit.
    return async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
