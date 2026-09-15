"""Shared fixtures.

Tests that need PostgreSQL are marked ``db`` and skip themselves - with a clear
reason - when no database is reachable, so ``pytest`` is green on a laptop with
nothing running and exercises the full stack in CI.
"""
from __future__ import annotations

import asyncio
import socket
import sys
from pathlib import Path
from urllib.parse import urlparse

import pytest

BACKEND = Path(__file__).resolve().parent.parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.config import get_settings  # noqa: E402


def _database_reachable(timeout: float = 1.0) -> bool:
    url = urlparse(get_settings().database_url.replace("postgresql+asyncpg", "postgresql"))
    host, port = url.hostname or "localhost", url.port or 5432
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


DB_AVAILABLE = _database_reachable()
requires_db = pytest.mark.skipif(
    not DB_AVAILABLE,
    reason=f"PostgreSQL not reachable at {get_settings().database_url}",
)


@pytest.fixture(scope="session")
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
def tmp_out(tmp_path: Path) -> Path:
    out = tmp_path / "waybills"
    out.mkdir(parents=True, exist_ok=True)
    return out


@pytest.fixture(scope="session")
def samples_dir() -> Path:
    return BACKEND / "samples"


@pytest.fixture
async def session():
    """A live AsyncSession against an empty orders/batch schema.

    The engine is disposed on teardown: pytest-asyncio gives every test its own
    event loop, and asyncpg connections are bound to the loop that opened them,
    so a pooled connection carried into the next test fails with
    ``coroutine 'Connection._cancel' was never awaited``.
    """
    from sqlalchemy import text

    from app.db.session import dispose_engine, get_sessionmaker

    async with get_sessionmaker()() as s:
        await s.execute(
            text("TRUNCATE orders, import_row, import_batch RESTART IDENTITY CASCADE")
        )
        await s.commit()
        try:
            yield s
        finally:
            await s.close()
    await dispose_engine()


@pytest.fixture
async def sender(session):
    from sqlalchemy import select

    from app.db.models import SenderProfile

    profile = await session.scalar(
        select(SenderProfile).where(SenderProfile.is_active.is_(True))
    )
    if profile is None:
        pytest.skip("no sender profile seeded - run `python -m app.db.seed`")
    return profile
