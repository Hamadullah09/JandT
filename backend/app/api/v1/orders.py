"""Normal Order creation and order listing."""
from __future__ import annotations

import math

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import active_sender, resolve_output_dir
from app.api.errors import Problem
from app.api.schemas import (
    NormalOrderIn,
    OrderCreatedOut,
    OrderOut,
    OrderPage,
    QuoteIn,
    QuoteOut,
)
from app.core.pricing import fee_breakdown, freight_fee
from app.core.sortation import service_scope
from app.core.weights import ceil_to_tenth, chargeable_weight, volumetric_weight
from app.csv_engine.pipeline import create_single
from app.db.models import Order, PostcodeZone
from app.db.session import get_session

router = APIRouter(prefix="/orders", tags=["orders"])


def _payload(body: NormalOrderIn) -> dict:
    """Map the form onto the keys :func:`enrich` expects."""
    return {
        "order_no": body.customer_order_no.strip(),
        "receiver_name": body.receiver_name.strip(),
        "receiver_phone": body.receiver_phone.strip(),
        "receiver_postcode": body.receiver_postcode.strip(),
        "receiver_city": body.receiver_city.strip(),
        "receiver_state": body.receiver_state.strip(),
        "receiver_address": body.receiver_address.strip(),
        "address_type": body.address_type,
        "goods_name": body.goods_name.strip(),
        "item_variant": body.item_variant.strip(),
        "quantity": body.quantity,
        "items": [
            {
                "name": item.goods_name.strip(),
                "variant": item.item_variant.strip(),
                "quantity": item.quantity,
            }
            for item in body.items
        ],
        "actual_weight": body.actual_weight,
        "length": body.length_cm,
        "width": body.width_cm,
        "height": body.height_cm,
        "payment_type": body.order_payment_type,
        "cod_amount": body.cod_amount,
        "order_value": body.order_value,
        "service_mode": body.service_mode,
        "remark": body.remark.strip(),
    }


@router.post("", response_model=OrderCreatedOut, status_code=201)
async def create_order(
    body: NormalOrderIn, session: AsyncSession = Depends(get_session)
) -> OrderCreatedOut:
    """Create one order, render its waybill, return the carrier identifiers."""
    sender = await active_sender(session)
    output_dir = resolve_output_dir(body.output_dir)

    overrides: dict = {"goods_type": body.goods_type}
    if body.chargeable_weight is not None:
        overrides["chargeable_weight"] = ceil_to_tenth(body.chargeable_weight)

    row = await create_single(
        session,
        payload=_payload(body),
        output_dir=output_dir,
        sender=sender,
        overrides=overrides,
    )

    if row.status == "duplicate":
        raise Problem(
            status=409,
            title="Duplicate order number",
            detail=row.error_message,
            type_="urn:jt:duplicate-order",
        )
    if row.status != "created":
        raise Problem(
            status=422,
            title="Order rejected",
            detail=row.error_message or "The order could not be created.",
            row_errors=[
                {
                    "row_no": 0,
                    "status": "error",
                    "field": row.error_field,
                    "message": row.error_message,
                }
            ],
        )

    order = await session.scalar(
        select(Order).where(Order.tracking_no == row.tracking_no)
    )
    out = OrderOut.model_validate(order)
    return OrderCreatedOut(
        tracking_no=out.tracking_no,
        sortation_code=out.sortation_code,
        route_code=out.route_code,
        waybill_url=out.waybill_url,
        freight_fee=out.freight_fee,
        order=out,
    )


@router.post("/quote", response_model=QuoteOut)
async def quote(
    body: QuoteIn, session: AsyncSession = Depends(get_session)
) -> QuoteOut:
    """Price a draft parcel without creating anything.

    The Normal Order footer calls this so its totals come from the same rate
    card the order will actually be charged against - no pricing logic is
    duplicated in the browser.
    """
    sender = await active_sender(session)

    state = body.receiver_state
    if not state and body.receiver_postcode:
        zone = await session.get(PostcodeZone, body.receiver_postcode)
        state = zone.state if zone else ""

    volumetric = volumetric_weight(body.length_cm, body.width_cm, body.height_cm)
    chargeable = (
        ceil_to_tenth(body.chargeable_weight)
        if body.chargeable_weight is not None
        else chargeable_weight(
            body.actual_weight, body.length_cm, body.width_cm, body.height_cm
        )
    )
    scope = service_scope(sender.state, state) if state else "WEST"
    breakdown = fee_breakdown(
        scope,
        chargeable,
        goods_type=body.goods_type,
        cod_amount=body.cod_amount,
        item_value=body.item_value,
    )
    return QuoteOut(
        volumetric_weight=volumetric,
        chargeable_weight=chargeable,
        service_scope=scope,
        freight_fee=freight_fee(
            scope, chargeable, goods_type=body.goods_type, cod_amount=body.cod_amount
        ),
        **{name: getattr(breakdown, name) for name in breakdown.__dataclass_fields__},
    )


@router.get("", response_model=OrderPage)
async def list_orders(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
    q: str | None = Query(None, description="tracking no, order no or receiver name"),
    batch_id: int | None = Query(None),
    session: AsyncSession = Depends(get_session),
) -> OrderPage:
    stmt = select(Order)
    count_stmt = select(func.count()).select_from(Order)

    if q:
        needle = f"%{q.strip()}%"
        clause = or_(
            Order.tracking_no.ilike(needle),
            Order.customer_order_no.ilike(needle),
            Order.receiver_name.ilike(needle),
        )
        stmt = stmt.where(clause)
        count_stmt = count_stmt.where(clause)
    if batch_id is not None:
        stmt = stmt.where(Order.batch_id == batch_id)
        count_stmt = count_stmt.where(Order.batch_id == batch_id)

    total = int(await session.scalar(count_stmt) or 0)
    rows = await session.scalars(
        stmt.order_by(Order.id.desc()).offset((page - 1) * size).limit(size)
    )
    return OrderPage(
        items=[OrderOut.model_validate(r) for r in rows],
        page=page,
        size=size,
        total=total,
        pages=max(1, math.ceil(total / size)),
    )


@router.get("/{tracking_no}", response_model=OrderOut)
async def get_order(
    tracking_no: str, session: AsyncSession = Depends(get_session)
) -> OrderOut:
    order = await session.scalar(select(Order).where(Order.tracking_no == tracking_no))
    if order is None:
        raise Problem(status=404, title="Order not found", detail=tracking_no)
    return OrderOut.model_validate(order)
