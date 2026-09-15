"""Bulk Import Orders: upload, stage, commit, progress, artefacts."""
from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import AsyncIterator

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import active_sender, resolve_output_dir
from app.api.errors import Problem
from app.api.schemas import (
    BulkCommitIn,
    BulkCommitOut,
    BulkProgressOut,
    BulkRowOut,
    BulkUploadOut,
    DeleteRowsIn,
    DeleteRowsOut,
    OutputDirCheckIn,
    OutputDirCheckOut,
)
from app.config import get_settings
from app.core.naming import OutputDirError, validate_output_dir
from app.csv_engine.parser import parse_csv
from app.csv_engine.pipeline import PipelineRow, run_pipeline
from app.db.models import ImportBatch, ImportRow
from app.db.session import get_session, get_sessionmaker

log = logging.getLogger(__name__)
router = APIRouter(prefix="/bulk", tags=["bulk"])

PROGRESS_POLL_SECONDS = 0.4


# ---------------------------------------------------------------------------
# output directory
# ---------------------------------------------------------------------------
@router.post("/check-output-dir", response_model=OutputDirCheckOut)
async def check_output_dir(body: OutputDirCheckIn) -> OutputDirCheckOut:
    """Validate the directory *before* a run, so a bad path costs nothing."""
    try:
        resolved = validate_output_dir(body.output_dir)
    except OutputDirError as exc:
        return OutputDirCheckOut(ok=False, message=str(exc))
    return OutputDirCheckOut(ok=True, resolved=str(resolved))


# ---------------------------------------------------------------------------
# upload (parse + validate only - nothing is created yet)
# ---------------------------------------------------------------------------
@router.post("/upload", response_model=BulkUploadOut)
async def upload(
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
) -> BulkUploadOut:
    settings = get_settings()
    raw = await file.read()
    if len(raw) > settings.max_upload_mb * 1024 * 1024:
        raise Problem(
            status=413,
            title="File too large",
            detail=f"Maximum upload size is {settings.max_upload_mb} MB.",
        )

    parsed = parse_csv(raw, file.filename or "upload.csv")
    if parsed.fatal:
        raise Problem(
            status=422,
            title="CSV could not be imported",
            detail=parsed.fatal,
            type_="urn:jt:bad-csv",
        )

    batch = ImportBatch(
        filename=parsed.filename,
        total_rows=parsed.total,
        ok_rows=len(parsed.ok_rows),
        failed_rows=len(parsed.error_rows),
        status="pending",
        stage="parsing",
        created_by="web",
    )
    session.add(batch)
    await session.flush()

    staged = [
        ImportRow(
            batch_id=batch.id,
            row_no=row.row_no,
            status=row.status,
            error_field=row.error_field,
            error_message=row.error_message,
            payload=row.data or {},
            raw=row.raw,
        )
        for row in parsed.rows
    ]
    session.add_all(staged)
    await session.commit()

    rows = await session.scalars(
        select(ImportRow)
        .where(ImportRow.batch_id == batch.id)
        .order_by(ImportRow.row_no)
    )
    items = [
        BulkRowOut(
            id=r.id,
            row_no=r.row_no,
            status=r.status,
            error_field=r.error_field,
            error_message=r.error_message,
            tracking_no=r.tracking_no,
            data=r.payload or {},
            raw=r.raw or {},
        )
        for r in rows
    ]
    return BulkUploadOut(
        batch_id=batch.id,
        filename=batch.filename,
        total=parsed.total,
        ok=len(parsed.ok_rows),
        errors=len(parsed.error_rows),
        warnings=parsed.warnings,
        rows=items,
        row_errors=[
            {
                "row_no": r.row_no,
                "status": r.status,
                "field": r.error_field,
                "message": r.error_message,
            }
            for r in parsed.error_rows
        ],
    )


async def _load_batch(session: AsyncSession, batch_id: int) -> ImportBatch:
    batch = await session.get(ImportBatch, batch_id)
    if batch is None:
        raise Problem(status=404, title="Batch not found", detail=str(batch_id))
    return batch


async def _pipeline_rows(
    session: AsyncSession, batch_id: int, row_ids: list[int] | None
) -> list[PipelineRow]:
    stmt = select(ImportRow).where(ImportRow.batch_id == batch_id)
    if row_ids:
        stmt = stmt.where(ImportRow.id.in_(row_ids))
    staged = await session.scalars(stmt.order_by(ImportRow.row_no))
    rows: list[PipelineRow] = []
    for r in staged:
        rows.append(
            PipelineRow(
                row_no=r.row_no,
                payload=dict(r.payload or {}) or {"order_no": r.raw.get("order_no", "")},
                status="ok" if r.status == "ok" else "error",
                error_field=r.error_field,
                error_message=r.error_message,
            )
        )
    return rows


async def _write_back(session: AsyncSession, batch_id: int, rows: list[PipelineRow]) -> None:
    """Reflect the outcome onto the staged rows so the grid can show it."""
    staged = await session.scalars(
        select(ImportRow).where(ImportRow.batch_id == batch_id)
    )
    by_row_no = {r.row_no: r for r in staged}
    for row in rows:
        target = by_row_no.get(row.row_no)
        if target is None:
            continue
        target.status = "created" if row.status == "created" else row.status
        target.tracking_no = row.tracking_no
        target.error_field = row.error_field
        target.error_message = row.error_message
    await session.commit()


async def _run(batch_id: int, body: BulkCommitIn, output_dir: Path) -> None:
    """Background worker for ``?async=true`` - owns its own session.

    Nothing awaits this task, so a failure is recorded on the batch (where the
    progress stream will surface it as ``failed``) and logged, rather than
    re-raised into an unretrieved-task warning that no caller would ever see.
    """
    async with get_sessionmaker()() as session:
        try:
            batch = await _load_batch(session, batch_id)
            sender = await active_sender(session)
            rows = await _pipeline_rows(session, batch_id, body.row_ids)
            await run_pipeline(
                session,
                batch=batch,
                rows=rows,
                output_dir=output_dir,
                sender=sender,
                merge=body.merge_pdf,
            )
            await _write_back(session, batch_id, rows)
        except Exception:                         # noqa: BLE001
            log.exception("bulk batch %s failed", batch_id)
            await session.rollback()
            batch = await session.get(ImportBatch, batch_id)
            if batch is not None:
                batch.status = "failed"
                batch.stage = "failed"
                await session.commit()


@router.post("/{batch_id}/commit", response_model=BulkCommitOut)
async def commit(
    batch_id: int,
    body: BulkCommitIn,
    async_mode: bool = Query(False, alias="async"),
    session: AsyncSession = Depends(get_session),
) -> BulkCommitOut:
    """Create orders and waybills for the staged rows.

    ``?async=true`` returns immediately and the UI follows
    ``GET /bulk/{id}/progress``; otherwise the summary is returned inline.
    """
    batch = await _load_batch(session, batch_id)
    output_dir = resolve_output_dir(body.output_dir)
    batch.output_dir = str(output_dir)
    await session.commit()

    if async_mode:
        asyncio.create_task(_run(batch_id, body, output_dir))
        return BulkCommitOut(
            batch_id=batch_id,
            total=batch.total_rows,
            created=0,
            failed=0,
            duplicates=0,
            duration_ms=0,
            output_dir=str(output_dir),
            manifest_url=f"/api/v1/bulk/{batch_id}/manifest.csv",
            zip_url=f"/api/v1/waybills/batch/{batch_id}.zip",
        )

    sender = await active_sender(session)
    rows = await _pipeline_rows(session, batch_id, body.row_ids)
    summary = await run_pipeline(
        session,
        batch=batch,
        rows=rows,
        output_dir=output_dir,
        sender=sender,
        merge=body.merge_pdf,
    )
    await _write_back(session, batch_id, rows)

    return BulkCommitOut(
        **summary.as_dict(),
        manifest_url=f"/api/v1/bulk/{batch_id}/manifest.csv",
        zip_url=f"/api/v1/waybills/batch/{batch_id}.zip",
        row_errors=[
            {
                "row_no": r.row_no or 0,
                "status": r.status,
                "field": r.error_field,
                "message": r.error_message,
            }
            for r in summary.rows
            if r.status in {"error", "duplicate"}
        ],
    )


def _progress_of(batch: ImportBatch) -> BulkProgressOut:
    total = batch.total_rows or 0
    processed = batch.processed or 0
    percent = round(100.0 * processed / total, 1) if total else 0.0
    eta = None
    if batch.started_at and processed and processed < total:
        elapsed = (
            (batch.finished_at or batch.started_at).timestamp()
            - batch.started_at.timestamp()
        ) * 1000
        if elapsed > 0:
            eta = int(elapsed / processed * (total - processed))
    return BulkProgressOut(
        batch_id=batch.id,
        stage=batch.stage or batch.status,
        status=batch.status,
        processed=processed,
        total=total,
        percent=percent,
        eta_ms=eta,
    )


@router.get(
    "/{batch_id}/progress",
    # StreamingResponse carries no response_model, so declare the frame shape
    # explicitly - it keeps BulkProgressOut in the OpenAPI schema and therefore
    # in the generated TypeScript types.
    responses={200: {"model": BulkProgressOut, "description": "SSE progress frames"}},
)
async def progress(batch_id: int, stream: bool = Query(True)) -> StreamingResponse:
    """Server-sent events; pass ``?stream=false`` for a single JSON snapshot."""
    async def events() -> AsyncIterator[bytes]:
        while True:
            async with get_sessionmaker()() as session:
                batch = await session.get(ImportBatch, batch_id)
                if batch is None:
                    yield b'event: error\ndata: {"detail":"batch not found"}\n\n'
                    return
                await session.refresh(batch)
                payload = _progress_of(batch).model_dump()
                terminal = batch.status in {"done", "failed"}
            yield f"data: {json.dumps(payload)}\n\n".encode()
            if terminal or not stream:
                return
            await asyncio.sleep(PROGRESS_POLL_SECONDS)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/{batch_id}/rows", response_model=list[BulkRowOut])
async def list_rows(
    batch_id: int, session: AsyncSession = Depends(get_session)
) -> list[BulkRowOut]:
    rows = await session.scalars(
        select(ImportRow)
        .where(ImportRow.batch_id == batch_id)
        .order_by(ImportRow.row_no)
    )
    return [
        BulkRowOut(
            id=r.id,
            row_no=r.row_no,
            status=r.status,
            error_field=r.error_field,
            error_message=r.error_message,
            tracking_no=r.tracking_no,
            data=r.payload or {},
            raw=r.raw or {},
        )
        for r in rows
    ]


@router.delete("/{batch_id}/rows", response_model=DeleteRowsOut)
async def delete_rows(
    batch_id: int,
    body: DeleteRowsIn,
    session: AsyncSession = Depends(get_session),
) -> DeleteRowsOut:
    if not body.row_ids:
        return DeleteRowsOut(deleted=0)
    result = await session.execute(
        delete(ImportRow)
        .where(ImportRow.batch_id == batch_id)
        .where(ImportRow.id.in_(body.row_ids))
    )
    await session.commit()
    return DeleteRowsOut(deleted=int(result.rowcount or 0))


@router.get("/{batch_id}/manifest.csv")
async def manifest(
    batch_id: int, session: AsyncSession = Depends(get_session)
) -> FileResponse:
    batch = await _load_batch(session, batch_id)
    if not batch.output_dir:
        raise Problem(status=404, title="No manifest", detail="This batch has not run.")
    path = Path(batch.output_dir) / f"manifest_{batch_id}.csv"
    if not path.exists():
        raise Problem(status=404, title="No manifest", detail=str(path))
    return FileResponse(path, media_type="text/csv", filename=path.name)


@router.get("/{batch_id}/errors.csv")
async def errors_csv(
    batch_id: int, session: AsyncSession = Depends(get_session)
) -> FileResponse:
    batch = await _load_batch(session, batch_id)
    path = Path(batch.output_dir or "") / f"import_errors_{batch_id}.csv"
    if not batch.output_dir or not path.exists():
        raise Problem(
            status=404, title="No error report", detail="This batch had no failures."
        )
    return FileResponse(path, media_type="text/csv", filename=path.name)
