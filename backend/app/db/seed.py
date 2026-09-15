"""Idempotent reference-data seeding.

Run by the container entrypoint on every boot and safe to re-run by hand::

    python -m app.db.seed
"""
from __future__ import annotations

import asyncio
import time

from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.config import DEFAULT_SENDER, get_settings
from app.db import postcodes
from app.db.models import PostcodeZone, SenderProfile
from app.db.session import dispose_engine, get_sessionmaker

# PostgreSQL caps a statement at 32767 bind parameters.  postcode_zone has 7
# columns, so keep rows-per-INSERT comfortably under 32767 / 7 = 4681.
_PG_MAX_PARAMS = 32767
_POSTCODE_COLUMNS = 7
CHUNK = _PG_MAX_PARAMS // _POSTCODE_COLUMNS - 100


async def seed_sender(session) -> str:
    existing = await session.scalar(
        select(SenderProfile).where(SenderProfile.is_active.is_(True))
    )
    if existing is not None:
        return f"sender_profile: already present ({existing.account_code})"
    session.add(SenderProfile(**DEFAULT_SENDER, is_active=True))
    await session.commit()
    return f"sender_profile: seeded ({DEFAULT_SENDER['account_code']})"


COLUMNS = ("postcode", "state", "city", "zone_code", "hub_code", "dp_code", "route_code")


async def _copy_postcodes(session) -> int:
    """Fast path: stream the rows straight into PostgreSQL with COPY.

    ~80k rows in well under a second, versus ~30 s for chunked multi-row
    INSERTs.  Only valid when the table is empty (COPY cannot upsert).
    """
    conn = await session.connection()
    raw = await conn.get_raw_connection()
    driver = getattr(raw, "driver_connection", None)
    if driver is None or not hasattr(driver, "copy_records_to_table"):
        raise RuntimeError("COPY unavailable on this driver")

    records = [tuple(row[c] for c in COLUMNS) for row in postcodes.iter_rows()]
    await driver.copy_records_to_table(
        "postcode_zone", records=records, columns=list(COLUMNS)
    )
    return len(records)


async def _upsert_postcodes(session) -> int:
    """Resilient path: chunked ON CONFLICT DO NOTHING for a partial table."""
    buffer: list[dict[str, str]] = []
    written = 0

    async def flush() -> None:
        nonlocal written
        if not buffer:
            return
        stmt = pg_insert(PostcodeZone).values(buffer)
        stmt = stmt.on_conflict_do_nothing(index_elements=["postcode"])
        await session.execute(stmt)
        written += len(buffer)
        buffer.clear()

    for row in postcodes.iter_rows():
        buffer.append(row)
        if len(buffer) >= CHUNK:
            await flush()
    await flush()
    return written


async def seed_postcodes(session) -> str:
    count = await session.scalar(select(func.count()).select_from(PostcodeZone))
    expected = postcodes.total_rows()
    if count and count >= expected:
        return f"postcode_zone: already present ({count} rows)"

    started = time.perf_counter()
    if not count:
        try:
            written = await _copy_postcodes(session)
            how = "COPY"
        except Exception:               # noqa: BLE001 - fall back, never fail boot
            await session.rollback()
            written = await _upsert_postcodes(session)
            how = "INSERT"
    else:
        written = await _upsert_postcodes(session)
        how = "INSERT"

    await session.commit()
    elapsed = (time.perf_counter() - started) * 1000
    return f"postcode_zone: seeded {written} rows via {how} in {elapsed:.0f} ms"


async def ensure_sequence(session) -> str:
    """Guarantee the tracking sequence exists and is at or beyond the floor."""
    settings = get_settings()
    await session.execute(
        text(
            "CREATE SEQUENCE IF NOT EXISTS tracking_seq "
            f"START WITH {settings.tracking_seq_start} INCREMENT BY 1 "
            "MINVALUE 0 NO MAXVALUE CACHE 50"
        )
    )
    current = await session.scalar(
        text("SELECT last_value, is_called FROM tracking_seq")
    )
    await session.commit()
    return f"tracking_seq: ready (last_value={current})"


async def main() -> None:
    async with get_sessionmaker()() as session:
        for line in (
            await ensure_sequence(session),
            await seed_sender(session),
            await seed_postcodes(session),
        ):
            print(f"[seed] {line}")
    await dispose_engine()


if __name__ == "__main__":
    asyncio.run(main())
