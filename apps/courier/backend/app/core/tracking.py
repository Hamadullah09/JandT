"""Tracking number generation (spec section 8.1).

Observed format on ``OrderNo_12808.pdf``::

    632158571544        # 12 digits, prefix "63"

    tracking_no = prefix + zero_pad(sequence_value, 12 - len(prefix))

``SEQUENCE`` mode (the default) draws from a native PostgreSQL sequence, so
allocation is collision-free under concurrency and N numbers cost exactly one
round trip.  ``RANDOM`` mode draws cryptographically random digits and retries
against the unique index.  Both modes are backstopped by
``uq_orders_tracking_no`` - the database, not application hope, guarantees H5.
"""
from __future__ import annotations

import secrets

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.models import TRACKING_SEQ

TRACKING_LEN = 12


class TrackingError(RuntimeError):
    pass


def format_tracking(sequence_value: int, prefix: str | None = None) -> str:
    """``2158571544`` -> ``"632158571544"``.

    Asserts the 12-digit contract before the value can ever reach the database.
    """
    pfx = prefix if prefix is not None else get_settings().tracking_prefix
    width = TRACKING_LEN - len(pfx)
    if sequence_value < 0:
        raise TrackingError(f"sequence value must be non-negative: {sequence_value}")
    if sequence_value >= 10**width:
        raise TrackingError(
            f"sequence value {sequence_value} overflows {width} digits"
        )
    value = f"{pfx}{sequence_value:0{width}d}"
    if len(value) != TRACKING_LEN or not value.isdigit():
        raise TrackingError(f"malformed tracking number: {value!r}")
    return value


def random_tracking(prefix: str | None = None) -> str:
    """``63`` + 10 cryptographically random digits."""
    pfx = prefix if prefix is not None else get_settings().tracking_prefix
    width = TRACKING_LEN - len(pfx)
    return format_tracking(secrets.randbelow(10**width), pfx)


async def allocate_sequence(session: AsyncSession, count: int) -> list[int]:
    """Reserve *count* sequence values in a single round trip."""
    if count <= 0:
        return []
    result = await session.execute(
        text(
            f"SELECT nextval('{TRACKING_SEQ}') FROM generate_series(1, :n)"
        ),
        {"n": count},
    )
    return [int(row[0]) for row in result]


async def allocate(session: AsyncSession, count: int) -> list[str]:
    """Return *count* unique, unused tracking numbers.

    ``SEQUENCE`` mode never collides.  ``RANDOM`` mode checks the candidates
    against ``orders`` and retries (max 5 attempts) before giving up loudly.
    """
    if count <= 0:
        return []

    settings = get_settings()
    if settings.tracking_mode == "SEQUENCE":
        values = await allocate_sequence(session, count)
        return [format_tracking(v) for v in values]

    chosen: list[str] = []
    seen: set[str] = set()
    for _attempt in range(5):
        need = count - len(chosen)
        if need <= 0:
            break
        candidates = {random_tracking() for _ in range(need * 2)} - seen
        if not candidates:
            continue
        rows = await session.execute(
            text("SELECT tracking_no FROM orders WHERE tracking_no = ANY(:c)"),
            {"c": list(candidates)},
        )
        taken = {r[0] for r in rows}
        for candidate in sorted(candidates - taken):
            if len(chosen) >= count:
                break
            chosen.append(candidate)
            seen.add(candidate)

    if len(chosen) != count:
        raise TrackingError(
            f"could not allocate {count} unique random tracking numbers "
            f"after 5 attempts (got {len(chosen)})"
        )
    return chosen
