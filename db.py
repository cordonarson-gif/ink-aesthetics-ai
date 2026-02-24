from __future__ import annotations

import inspect
import json
import logging
import os
from functools import wraps
from typing import Any, Awaitable, Callable, Protocol, TypeVar

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Session
from sqlalchemy.sql.dml import Delete, Insert, Update
from sqlalchemy.sql.elements import ClauseElement

logger = logging.getLogger("inkai.db")


class Base(DeclarativeBase):
    pass


_WRITE_ENGINE: AsyncEngine | None = None
_READ_ENGINE: AsyncEngine | None = None


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw.strip())
    except Exception:
        return default


def make_engine(db_url: str) -> AsyncEngine:
    pool_pre_ping = True
    pool_recycle = max(60, _env_int("DB_POOL_RECYCLE_SECONDS", 1800))
    pool_size = max(1, _env_int("DB_POOL_SIZE", 8))
    max_overflow = max(0, _env_int("DB_MAX_OVERFLOW", 16))

    return create_async_engine(
        db_url,
        echo=False,
        future=True,
        pool_pre_ping=pool_pre_ping,
        pool_recycle=pool_recycle,
        pool_size=pool_size,
        max_overflow=max_overflow,
    )


class RoutingSession(Session):
    """Route writes to primary and reads to replica when available."""

    def get_bind(
        self,
        mapper: Any | None = None,
        clause: ClauseElement | None = None,
        **kwargs: Any,
    ) -> Any:
        if _WRITE_ENGINE is None:
            raise RuntimeError("write engine is not configured")

        read_engine = _READ_ENGINE or _WRITE_ENGINE

        if self._flushing:
            return _WRITE_ENGINE.sync_engine

        if isinstance(clause, (Insert, Update, Delete)):
            return _WRITE_ENGINE.sync_engine

        visit_name = getattr(clause, "__visit_name__", "") if clause is not None else ""
        if visit_name in {"insert", "update", "delete"}:
            return _WRITE_ENGINE.sync_engine

        return read_engine.sync_engine


def configure_engines(write_engine: AsyncEngine, read_engine: AsyncEngine | None = None) -> None:
    global _WRITE_ENGINE, _READ_ENGINE
    _WRITE_ENGINE = write_engine
    _READ_ENGINE = read_engine


def make_session(write_engine: AsyncEngine, read_engine: AsyncEngine | None = None):
    configure_engines(write_engine=write_engine, read_engine=read_engine)
    return async_sessionmaker(
        bind=write_engine,
        expire_on_commit=False,
        class_=AsyncSession,
        sync_session_class=RoutingSession,
    )


async def init_db(engine: AsyncEngine) -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


class RedisLike(Protocol):
    async def get(self, key: str) -> Any: ...

    async def set(self, key: str, value: Any, ex: int | None = None) -> Any: ...

    async def delete(self, *keys: str) -> Any: ...

    async def incrby(self, key: str, amount: int = 1) -> Any: ...

    async def expire(self, key: str, ttl_sec: int) -> Any: ...


RedisResolver = Callable[[], RedisLike | Awaitable[RedisLike | None] | None]
_REDIS_RESOLVER: RedisResolver | None = None


def set_redis_resolver(resolver: RedisResolver | None) -> None:
    global _REDIS_RESOLVER
    _REDIS_RESOLVER = resolver


async def get_redis_client() -> RedisLike | None:
    resolver = _REDIS_RESOLVER
    if resolver is None:
        return None
    candidate = resolver()
    if inspect.isawaitable(candidate):
        candidate = await candidate
    return candidate


def cache_key(namespace: str, *parts: Any) -> str:
    suffix = ":".join(str(x).strip() for x in parts if str(x).strip())
    if suffix:
        return f"inkai:{namespace}:{suffix}"
    return f"inkai:{namespace}"


async def redis_get_json(key: str) -> Any | None:
    client = await get_redis_client()
    if client is None:
        return None
    try:
        raw = await client.get(key)
        if raw is None:
            return None
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8", errors="ignore")
        if isinstance(raw, str):
            return json.loads(raw)
        return raw
    except Exception as exc:
        logger.warning("redis_get_json failed for %s: %s", key, exc)
        return None


async def redis_set_json(key: str, value: Any, ttl_sec: int | None = None) -> bool:
    client = await get_redis_client()
    if client is None:
        return False
    try:
        payload = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        await client.set(key, payload, ex=ttl_sec)
        return True
    except Exception as exc:
        logger.warning("redis_set_json failed for %s: %s", key, exc)
        return False


async def redis_delete(*keys: str) -> int:
    client = await get_redis_client()
    if client is None:
        return 0
    clean = [k for k in keys if k]
    if not clean:
        return 0
    try:
        deleted = await client.delete(*clean)
        return int(deleted or 0)
    except Exception as exc:
        logger.warning("redis_delete failed: %s", exc)
        return 0


async def redis_incr(key: str, amount: int = 1, ttl_sec: int | None = None) -> int:
    client = await get_redis_client()
    if client is None:
        return 0
    try:
        value = int(await client.incrby(key, int(amount)))
        if ttl_sec and ttl_sec > 0:
            await client.expire(key, int(ttl_sec))
        return value
    except Exception as exc:
        logger.warning("redis_incr failed for %s: %s", key, exc)
        return 0


FuncT = TypeVar("FuncT", bound=Callable[..., Awaitable[Any]])


def cached_query(key_builder: Callable[..., str], ttl_sec: int = 60):
    """Cache async query results in Redis with automatic db fallback."""

    def decorate(fn: FuncT) -> FuncT:
        @wraps(fn)
        async def wrapped(*args: Any, **kwargs: Any) -> Any:
            key = key_builder(*args, **kwargs)
            if key:
                hit = await redis_get_json(key)
                if hit is not None:
                    return hit

            result = await fn(*args, **kwargs)
            if key and result is not None:
                await redis_set_json(key, result, ttl_sec)
            return result

        return wrapped  # type: ignore[return-value]

    return decorate
