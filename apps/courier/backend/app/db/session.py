"""Async engine / session factory.

The courier module shares the platform's one PostgreSQL database.  Every
connection resolves unqualified table names in the courier schema first, then
`core` (the platform's accounts), so the queries throughout this package keep
saying ``orders`` and mean ``courier.orders``.
"""
from __future__ import annotations

from collections.abc import AsyncIterator
from functools import lru_cache
from typing import Any

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import get_settings


def connect_args() -> dict[str, Any]:
    """Server settings for every connection - shared with Alembic."""
    settings = get_settings()
    return {
        "server_settings": {
            "search_path": settings.search_path,
            "application_name": "courier-api",
        }
    }


@lru_cache(maxsize=1)
def get_engine() -> AsyncEngine:
    settings = get_settings()
    return create_async_engine(
        settings.database_url,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=20,
        future=True,
        connect_args=connect_args(),
    )


@lru_cache(maxsize=1)
def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(
        get_engine(), expire_on_commit=False, autoflush=False, class_=AsyncSession
    )


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency."""
    async with get_sessionmaker()() as session:
        yield session


async def dispose_engine() -> None:
    await get_engine().dispose()
