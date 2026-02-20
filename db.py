from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


def make_engine(db_url: str):
    return create_async_engine(db_url, echo=False, future=True)


async def init_db(engine):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


def make_session(engine):
    return async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
