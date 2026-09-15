"""Waybill delivery: one PDF, or a whole batch as a zip."""
from __future__ import annotations

import io
import zipfile
from pathlib import Path

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import resolve_output_dir
from app.api.errors import Problem
from app.db.models import Order
from app.db.session import get_session
from app.waybill.renderer import render_waybill

router = APIRouter(prefix="/waybills", tags=["waybills"])


async def _order_or_404(session: AsyncSession, tracking_no: str) -> Order:
    order = await session.scalar(select(Order).where(Order.tracking_no == tracking_no))
    if order is None:
        raise Problem(status=404, title="Order not found", detail=tracking_no)
    return order


@router.get("/{tracking_no}.pdf")
async def get_waybill(
    tracking_no: str, session: AsyncSession = Depends(get_session)
) -> FileResponse:
    """Stream a single waybill, re-rendering on demand if the file is gone.

    Re-rendering is deterministic, so a regenerated file is byte-identical to
    the one written during the batch run.
    """
    order = await _order_or_404(session, tracking_no)

    path = Path(order.waybill_path) if order.waybill_path else None
    if path is None or not path.exists():
        from app.waybill.dto import OrderDTO

        output_dir = resolve_output_dir(None)
        filename = order.waybill_filename or f"{order.tracking_no}.pdf"
        path = output_dir / filename
        render_waybill(OrderDTO.from_order(order), path)
        order.waybill_path = str(path)
        order.waybill_filename = path.name
        await session.commit()

    return FileResponse(path, media_type="application/pdf", filename=path.name)


@router.get("/batch/{batch_id}.zip")
async def get_batch_zip(
    batch_id: int, session: AsyncSession = Depends(get_session)
) -> StreamingResponse:
    """Every waybill in a batch, zipped."""
    orders = list(
        await session.scalars(
            select(Order)
            .where(Order.batch_id == batch_id, Order.status == "created")
            .order_by(Order.id)
        )
    )
    if not orders:
        raise Problem(
            status=404, title="Nothing to download", detail=f"batch {batch_id}"
        )

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for order in orders:
            path = Path(order.waybill_path) if order.waybill_path else None
            if path is None or not path.exists():
                continue
            archive.write(path, arcname=path.name)
    buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="waybills_batch_{batch_id}.zip"'
        },
    )
