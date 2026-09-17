"""Shared fixtures.

Tests that need PostgreSQL are marked ``db`` and skip themselves - with a clear
reason - when their database is not available, so ``pytest`` is green on a
laptop with nothing running and exercises the full stack in CI.

The database tests TRUNCATE the order tables, so they run against their own
database (``jt_test`` by default, or ``JT_TEST_DATABASE_URL``) and NEVER the
one in ``.env``.  Running them against the live database once wiped real
orders; the guard below makes that impossible.
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

import pytest

BACKEND = Path(__file__).resolve().parent.parent
REPO = BACKEND.parent

# Tests create real orders.  With WhatsApp enabled in .env, every one of them
# would be queued - and the running service would post them into the real
# group.  Environment variables beat .env, and this runs before the settings
# are first loaded, so no test can ever queue a job.
os.environ["JT_WHATSAPP_ENABLED"] = "false"


def _db_name(url: str | None) -> str:
    return urlparse((url or "").replace("postgresql+asyncpg", "postgresql")).path.lstrip("/")


def _live_database_url() -> str | None:
    from dotenv import dotenv_values

    for env_file in (REPO / ".env", BACKEND / ".env"):
        value = dotenv_values(env_file).get("JT_DATABASE_URL") if env_file.exists() else None
        if value:
            return value
    return os.environ.get("JT_DATABASE_URL")


TEST_DATABASE_URL = os.environ.get(
    "JT_TEST_DATABASE_URL", "postgresql+asyncpg://jt:jt@localhost:5432/jt_test"
)
_live = _live_database_url()
if _live and _db_name(_live) == _db_name(TEST_DATABASE_URL):
    raise pytest.UsageError(
        f"Refusing to run: the test database '{_db_name(TEST_DATABASE_URL)}' is the "
        "live database from .env, and the tests TRUNCATE its orders. Point "
        "JT_TEST_DATABASE_URL at a separate database."
    )
os.environ["JT_DATABASE_URL"] = TEST_DATABASE_URL

if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.config import get_settings  # noqa: E402


def _database_ready(timeout: float = 3.0) -> bool:
    """The test database exists, accepts our login, and has been migrated."""
    import asyncpg

    async def probe() -> bool:
        dsn = get_settings().database_url.replace("postgresql+asyncpg", "postgresql")
        conn = await asyncpg.connect(dsn, timeout=timeout)
        try:
            return bool(await conn.fetchval("select to_regclass('public.orders') is not null"))
        finally:
            await conn.close()

    try:
        return asyncio.run(probe())
    except Exception:                               # noqa: BLE001
        return False


DB_AVAILABLE = _database_ready()
requires_db = pytest.mark.skipif(
    not DB_AVAILABLE,
    reason=(
        f"test database not ready at {get_settings().database_url} - create and "
        "migrate a separate 'jt_test' database to run these (never the live one)"
    ),
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


@pytest.fixture
def logged_in_admin():
    """API calls in a test run as the admin, without going through /auth/login."""
    from app.api.auth import current_user
    from app.db.models import User
    from app.main import app

    admin = User(
        id=1, username="admin", name="Administrator", role="admin", status="active",
        password_hash="not-used",
    )
    app.dependency_overrides[current_user] = lambda: admin
    yield admin
    app.dependency_overrides.pop(current_user, None)
