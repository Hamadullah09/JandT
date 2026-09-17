"""Track & trace: the public tracking page's data, and recording status updates."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import require_admin
from app.api.errors import Problem
from app.api.schemas import (
    EventTypeOut,
    TrackingDayOut,
    TrackingEventOut,
    TrackingOut,
    TrackingStepOut,
    TrackingUpdateIn,
    TrackingUpdateOut,
)
from app.core import trace
from app.db import tracking_events
from app.db.models import Order, TrackingEvent
from app.db.session import get_session

router = APIRouter(prefix="/tracking", tags=["tracking"])

#: jtexpress.my takes up to 10 waybills at once
MAX_WAYBILLS = 10


def split_waybills(raw: str) -> list[str]:
    """``"632158579194, 632158579195"`` -> both, duplicates and blanks dropped."""
    seen: dict[str, None] = {}
    for part in raw.replace("\n", ",").replace(" ", ",").split(","):
        part = part.strip()
        if part:
            seen.setdefault(part, None)
    return list(seen)


def tracking_out(order: Order | None, tracking_no: str, events: list[TrackingEvent]) -> TrackingOut:
    if order is None:
        return TrackingOut(tracking_no=tracking_no, found=False)
    status, _ = tracking_events.status_from(events)
    days: list[TrackingDayOut] = []
    for line in tracking_events.timeline(order, events):
        event = TrackingEventOut(**line)
        if not days or days[-1].date_label != event.date_label:
            days.append(TrackingDayOut(date_label=event.date_label, events=[]))
        days[-1].events.append(event)
    return TrackingOut(
        tracking_no=order.tracking_no,
        found=True,
        status=status,
        status_label=trace.STATUS_LABELS[status],
        steps=[TrackingStepOut(key=s.key, label=s.label, reached=s.reached) for s in trace.steps(status)],
        days=days,
    )


@router.get("", response_model=list[TrackingOut])
async def track(
    awb: str = Query("", description="tracking numbers, separated by commas"),
    session: AsyncSession = Depends(get_session),
) -> list[TrackingOut]:
    """What jtexpress.my/tracking shows, for up to 10 waybills."""
    wanted = split_waybills(awb)
    if len(wanted) > MAX_WAYBILLS:
        raise Problem(
            status=400,
            title="Too many waybills",
            detail=f"Track up to {MAX_WAYBILLS} waybills at once.",
        )
    if not wanted:
        return []
    orders = {
        order.tracking_no: order
        for order in await session.scalars(select(Order).where(Order.tracking_no.in_(wanted)))
    }
    events = await tracking_events.events_by_order(session, (o.id for o in orders.values()))
    return [
        tracking_out(orders.get(no), no, events.get(orders[no].id, []) if no in orders else [])
        for no in wanted
    ]


@router.get(
    "/event-types", response_model=list[EventTypeOut], dependencies=[Depends(require_admin)]
)
async def event_types() -> list[EventTypeOut]:
    return [
        EventTypeOut(
            code=e.code,
            label=e.label,
            status=e.status,
            template=e.template,
            without_location=e.without_location,
        )
        for e in trace.EVENT_TYPES.values()
    ]


@router.post(
    "/events", response_model=TrackingUpdateOut, dependencies=[Depends(require_admin)]
)
async def add_events(
    body: TrackingUpdateIn, session: AsyncSession = Depends(get_session)
) -> TrackingUpdateOut:
    """Record one status update on one or several parcels."""
    if body.event_type not in trace.EVENT_TYPES:
        raise Problem(
            status=422,
            title="Unknown status",
            detail=f"Use one of: {', '.join(trace.EVENT_TYPES)}.",
        )
    wanted = list(dict.fromkeys(no.strip() for no in body.tracking_nos if no.strip()))
    orders = list(await session.scalars(select(Order).where(Order.tracking_no.in_(wanted))))
    found = {order.tracking_no for order in orders}
    if orders:
        await tracking_events.record(
            session,
            orders,
            code=body.event_type,
            location=body.location,
            description=body.description,
            occurred_at=body.occurred_at,
        )
        await session.commit()
    return TrackingUpdateOut(
        updated=len(orders), not_found=[no for no in wanted if no not in found]
    )


@router.delete("/events/{event_id}", status_code=204, dependencies=[Depends(require_admin)])
async def delete_event(event_id: int, session: AsyncSession = Depends(get_session)) -> None:
    """Remove a status update entered by mistake."""
    event = await session.get(TrackingEvent, event_id)
    if event is None:
        raise Problem(status=404, title="Status update not found", detail=str(event_id))
    order = await session.get(Order, event.order_id)
    await session.delete(event)
    await session.flush()
    if order is not None:
        await tracking_events.refresh_status(session, [order])
    await session.commit()
