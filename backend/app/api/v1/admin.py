"""Admin portal: every order with its tracking status, and the CSV export."""
from __future__ import annotations

import math
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy import Select, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import Problem
from app.api.schemas import (
    AdminLastEventOut,
    AdminOrderDetailOut,
    AdminOrderOut,
    AdminOrderPage,
    CalendarDayOut,
    CalendarOut,
    SourceCountOut,
    TrackingEventOut,
)
from app.config import get_settings
from app.core import trace
from app.core.export import ExportOrder, orders_csv
from app.core.items import items_of, supplier_ships, total_quantity
from app.core.sources import ordered
from app.db import tracking_events
from app.db.models import Order, TrackingEvent
from app.db.session import get_session

router = APIRouter(prefix="/admin", tags=["admin"])

Period = Literal["today", "7d", "30d", "all"]
_DAYS = {"today": 1, "7d": 7, "30d": 30}
#: the PostgreSQL time zone name for Malaysia, to group timestamps by local date
MY_ZONE = "Asia/Kuala_Lumpur"


def period_start(period: Period, now: datetime | None = None) -> datetime | None:
    """Midnight Malaysia time at the start of the period; None for all time."""
    days = _DAYS.get(period)
    if days is None:
        return None
    local = trace.as_myt(now or datetime.now(trace.MYT))
    midnight = local.replace(hour=0, minute=0, second=0, microsecond=0)
    return midnight - timedelta(days=days - 1)


def day_bounds(day: date) -> tuple[datetime, datetime]:
    """Midnight to midnight of *day*, Malaysia time."""
    start = datetime.combine(day, time(), tzinfo=trace.MYT)
    return start, start + timedelta(days=1)


def month_bounds(month: str) -> tuple[datetime, datetime]:
    """``"2026-09"`` -> midnight on 1 September and on 1 October, Malaysia time."""
    try:
        year, number = (int(part) for part in month.split("-"))
        start = datetime(year, number, 1, tzinfo=trace.MYT)
    except (TypeError, ValueError):
        raise Problem(status=422, title="Unknown month", detail="Use YYYY-MM, e.g. 2026-09.") from None
    end = datetime(year + (number == 12), number % 12 + 1, 1, tzinfo=trace.MYT)
    return start, end


def _local_day(column):
    return func.date(func.timezone(MY_ZONE, column))


def _filtered(
    stmt: Select,
    q: str | None,
    period: Period,
    *,
    status: str | None = None,
    source: str | None = None,
    day: date | None = None,
) -> Select:
    if q and q.strip():
        needle = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                Order.tracking_no.ilike(needle),
                Order.customer_order_no.ilike(needle),
                Order.receiver_name.ilike(needle),
                Order.receiver_phone.ilike(needle),
            )
        )
    start = period_start(period)
    if start is not None:
        stmt = stmt.where(Order.created_at >= start)
    if status:
        stmt = stmt.where(Order.tracking_status == status)
    if source:
        stmt = stmt.where(Order.source == source)
    if day is not None:
        start, end = day_bounds(day)
        stmt = stmt.where(Order.created_at >= start, Order.created_at < end)
    return stmt


def admin_order(order: Order, last: TrackingEvent | None) -> AdminOrderOut:
    fields = {
        "items": order.items,
        "goods_name": order.goods_name,
        "item_variant": order.item_variant,
        "quantity": order.quantity,
    }
    items = items_of(fields)
    settings = get_settings()
    return AdminOrderOut(
        id=order.id,
        tracking_no=order.tracking_no,
        customer_order_no=order.customer_order_no,
        created_at=order.created_at,
        receiver_name=order.receiver_name,
        receiver_phone=order.receiver_phone,
        receiver_postcode=order.receiver_postcode,
        receiver_city=order.receiver_city,
        receiver_state=order.receiver_state,
        receiver_address=order.receiver_address,
        items=items,
        pieces=total_quantity(items),
        order_payment_type=order.order_payment_type,
        cod_amount=order.cod_amount,
        order_value=order.order_value,
        freight_fee=order.freight_fee,
        chargeable_weight=order.chargeable_weight,
        supplier_ships=supplier_ships(items, order.order_payment_type),
        source=order.source,
        tracking_status=order.tracking_status,
        status_label=trace.STATUS_LABELS.get(order.tracking_status, order.tracking_status),
        tracking_updated_at=order.tracking_updated_at,
        last_event=AdminLastEventOut(
            label=trace.EVENT_TYPES[last.event_type].label
            if last.event_type in trace.EVENT_TYPES
            else last.event_type,
            location=last.location,
            occurred_at=last.occurred_at,
        )
        if last
        else None,
        tracking_url=settings.tracking_url(order.tracking_no),
        waybill_url=f"/api/v1/waybills/{order.tracking_no}.pdf",
    )


#: by the order's date - the Date column people read - not by when its row was
#: inserted: an order can be entered after a later one, e.g. dated back a few days
NEWEST_FIRST = (Order.created_at.desc(), Order.id.desc())


@router.get("/orders", response_model=AdminOrderPage)
async def list_orders(
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    status: str | None = Query(None, description="a tracking status, e.g. IN_TRANSIT"),
    q: str | None = Query(None, description="tracking no, order no, receiver name or phone"),
    period: Period = Query("all"),
    source: str | None = Query(None, description="where the orders came from, e.g. Daraz"),
    day: date | None = Query(None, description="only orders created that day (Malaysia time)"),
    session: AsyncSession = Depends(get_session),
) -> AdminOrderPage:
    """Newest first, with the count per status and per source for the filters."""
    if status and status not in trace.STATUSES:
        raise Problem(status=422, title="Unknown status", detail=status)

    # each filter's counts follow the other filters, not its own choice
    counted = _filtered(
        select(Order.tracking_status, func.count()).group_by(Order.tracking_status),
        q, period, source=source, day=day,
    )
    counts = {name: 0 for name in trace.STATUSES}
    for name, number in (await session.execute(counted)).all():
        counts[name] = number

    per_source = dict(
        (await session.execute(
            _filtered(
                select(Order.source, func.count()).group_by(Order.source),
                q, period, status=status, day=day,
            )
        )).all()
    )
    sources = [
        SourceCountOut(name=name, count=int(per_source.get(name, 0)))
        for name in ordered(set(per_source))
    ]

    stmt = _filtered(select(Order), q, period, status=status, source=source, day=day)
    total = counts[status] if status else sum(counts.values())
    orders = list(
        await session.scalars(stmt.order_by(*NEWEST_FIRST).offset((page - 1) * size).limit(size))
    )

    events = await tracking_events.events_by_order(session, (o.id for o in orders))
    today_start = period_start("today")
    today = await session.scalar(
        select(func.count()).select_from(Order).where(Order.created_at >= today_start)
    )
    newest = await session.scalar(select(func.max(Order.id)))

    return AdminOrderPage(
        items=[
            admin_order(order, tracking_events_latest(events[order.id])) for order in orders
        ],
        page=page,
        size=size,
        total=total,
        pages=max(1, math.ceil(total / size)),
        counts=counts,
        sources=sources,
        today=int(today or 0),
        newest_id=int(newest or 0),
    )


def tracking_events_latest(events: list[TrackingEvent]) -> TrackingEvent | None:
    return max(events, key=lambda e: (e.occurred_at, e.id), default=None)


@router.get("/orders/export.csv")
async def export_orders(
    status: str | None = Query(None),
    q: str | None = Query(None),
    period: Period = Query("all"),
    source: str | None = Query(None),
    day: date | None = Query(None),
    session: AsyncSession = Depends(get_session),
) -> Response:
    """Every matching order, one row each, the tracking number linked to its page.

    Newest first, like the dashboard.
    """
    stmt = _filtered(select(Order), q, period, status=status, source=source, day=day)
    orders = list(await session.scalars(stmt.order_by(*NEWEST_FIRST)))
    body = orders_csv((ExportOrder.of(o) for o in orders), get_settings().tracking_url)
    stamp = datetime.now(trace.MYT).strftime("%Y-%m-%d_%H%M")
    return Response(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="orders_{stamp}.csv"'},
    )


@router.get("/calendar", response_model=CalendarOut)
async def calendar(
    month: str | None = Query(None, pattern=r"^\d{4}-\d{2}$", description="YYYY-MM; this month when blank"),
    source: str | None = Query(None),
    session: AsyncSession = Depends(get_session),
) -> CalendarOut:
    """A month of orders by day (Malaysia time): new orders, deliveries, returns."""
    today = datetime.now(trace.MYT).date()
    month = month or f"{today:%Y-%m}"
    start, end = month_bounds(month)

    created_day = _local_day(Order.created_at).label("day")
    cod = func.coalesce(
        func.sum(case((Order.order_payment_type == "COD", Order.cod_amount), else_=0)), 0
    )
    created = (
        select(created_day, Order.tracking_status, func.count(), cod)
        .where(Order.created_at >= start, Order.created_at < end)
        .group_by(created_day, Order.tracking_status)
    )
    if source:
        created = created.where(Order.source == source)
    per_day: dict[date, dict] = {}
    for day_value, status, number, cod_total in (await session.execute(created)).all():
        entry = per_day.setdefault(day_value, {"orders": 0, "statuses": {}, "cod": Decimal("0")})
        entry["orders"] += number
        entry["statuses"][status] = number
        entry["cod"] += Decimal(cod_total)

    scan_day = _local_day(TrackingEvent.occurred_at).label("day")
    scans = (
        select(scan_day, TrackingEvent.event_type, func.count(func.distinct(TrackingEvent.order_id)))
        .where(
            TrackingEvent.event_type.in_(["DELIVERED", "RETURNED"]),
            TrackingEvent.occurred_at >= start,
            TrackingEvent.occurred_at < end,
        )
        .group_by(scan_day, TrackingEvent.event_type)
    )
    if source:
        scans = scans.join(Order, Order.id == TrackingEvent.order_id).where(Order.source == source)
    finished: dict[tuple[date, str], int] = {
        (day_value, code): number for day_value, code, number in (await session.execute(scans)).all()
    }

    per_source = dict(
        (await session.execute(
            select(Order.source, func.count())
            .where(Order.created_at >= start, Order.created_at < end)
            .group_by(Order.source)
        )).all()
    )

    first = start.date()
    days = []
    for offset in range((end.date() - first).days):
        current = first + timedelta(days=offset)
        entry = per_day.get(current, {"orders": 0, "statuses": {}, "cod": Decimal("0")})
        days.append(
            CalendarDayOut(
                day=current,
                orders=entry["orders"],
                statuses=entry["statuses"],
                cod_amount=entry["cod"],
                delivered=finished.get((current, "DELIVERED"), 0),
                returned=finished.get((current, "RETURNED"), 0),
            )
        )
    return CalendarOut(
        month=month,
        today=today,
        days=days,
        total_orders=sum(d.orders for d in days),
        total_delivered=sum(d.delivered for d in days),
        total_returned=sum(d.returned for d in days),
        sources=[
            SourceCountOut(name=name, count=int(per_source.get(name, 0)))
            for name in ordered(set(per_source))
        ],
    )


@router.get("/orders/{tracking_no}", response_model=AdminOrderDetailOut)
async def order_detail(
    tracking_no: str, session: AsyncSession = Depends(get_session)
) -> AdminOrderDetailOut:
    order = await session.scalar(select(Order).where(Order.tracking_no == tracking_no))
    if order is None:
        raise Problem(status=404, title="Order not found", detail=tracking_no)
    events = (await tracking_events.events_by_order(session, [order.id]))[order.id]
    return AdminOrderDetailOut(
        order=admin_order(order, tracking_events_latest(events)),
        events=[TrackingEventOut(**line) for line in tracking_events.timeline(order, events)],
    )
