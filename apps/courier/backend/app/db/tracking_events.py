"""Reading and recording tracking events, and keeping orders.tracking_status right."""
from __future__ import annotations

from collections.abc import Iterable, Sequence
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import trace
from app.db.models import Order, TrackingEvent


async def events_by_order(
    session: AsyncSession, order_ids: Iterable[int]
) -> dict[int, list[TrackingEvent]]:
    """Each order's events, oldest first."""
    ids = list(set(order_ids))
    found: dict[int, list[TrackingEvent]] = {order_id: [] for order_id in ids}
    if not ids:
        return found
    rows = await session.scalars(
        select(TrackingEvent)
        .where(TrackingEvent.order_id.in_(ids))
        .order_by(TrackingEvent.occurred_at, TrackingEvent.id)
    )
    for event in rows:
        found[event.order_id].append(event)
    return found


def status_from(events: Sequence[TrackingEvent]) -> tuple[str, datetime | None]:
    scans = [trace.Scan(e.id, e.event_type, e.occurred_at) for e in events]
    last = trace.latest(scans)
    return trace.status_of(scans), (last.occurred_at if last else None)


async def refresh_status(session: AsyncSession, orders: Iterable[Order]) -> None:
    """Set each order's tracking_status from its events."""
    orders = list(orders)
    events = await events_by_order(session, (order.id for order in orders))
    for order in orders:
        order.tracking_status, order.tracking_updated_at = status_from(events[order.id])


async def record(
    session: AsyncSession,
    orders: Sequence[Order],
    *,
    code: str,
    location: str = "",
    description: str = "",
    occurred_at: datetime | None = None,
) -> None:
    """Add the same scan to every order, then update their statuses."""
    trace.event_type(code)                        # raises TraceError when unknown
    place = location.strip()
    text = description.strip() or trace.describe(code, place)
    moment = trace.as_myt(occurred_at) if occurred_at else datetime.now(timezone.utc)
    for order in orders:
        session.add(
            TrackingEvent(
                order_id=order.id,
                event_type=code,
                location=place,
                description=text,
                occurred_at=moment,
            )
        )
    await session.flush()
    await refresh_status(session, orders)


def timeline(order: Order, events: Sequence[TrackingEvent]) -> list[dict]:
    """Every line of the tracking page, newest first; the last is the order itself."""
    lines = [
        {
            "id": event.id,
            "event_type": event.event_type,
            "label": trace.EVENT_TYPES[event.event_type].label
            if event.event_type in trace.EVENT_TYPES
            else event.event_type,
            "location": event.location,
            "description": event.description,
            "occurred_at": event.occurred_at,
        }
        for event in events
    ]
    lines.sort(key=lambda line: (line["occurred_at"], line["id"]), reverse=True)
    lines.append(
        {
            "id": None,
            "event_type": trace.CREATED,
            "label": trace.CREATED_LABEL,
            "location": "",
            "description": trace.CREATED_DESCRIPTION,
            "occurred_at": order.created_at,
        }
    )
    for line in lines:
        line["date_label"] = trace.date_label(line["occurred_at"])
        line["time_label"] = trace.time_label(line["occurred_at"])
    return lines
