"""Parallel waybill rendering.

Rendering is CPU-bound (vector barcode + QR + PDF assembly), so it runs in a
``ProcessPoolExecutor``.  Two details make this fast and safe on Windows, where
the pool uses *spawn*:

* workers receive plain dicts and destination paths - never ORM rows, never a
  DB session;
* work is handed over in **chunks**, so the per-task pickling and dispatch cost
  is amortised over many labels instead of paid 500 times.

Output paths are resolved by the parent before dispatch, which keeps collision
handling single-threaded and deterministic.
"""
from __future__ import annotations

import atexit
import os
import threading
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable, Sequence

from app.waybill.renderer import render_waybill

# ---------------------------------------------------------------------------
# A single pool is reused for the life of the process.
#
# On Windows (and macOS) the pool starts workers with *spawn*, which re-imports
# the parent's ``__main__`` in every child.  That is a fixed cost of roughly a
# second per worker when ``__main__`` pulls in SQLAlchemy/pandas, and paying it
# per batch dominated the render stage.  Creating the pool once amortises it
# across every batch the process ever runs.
#
# Entry-point scripts additionally keep their module-level imports light so the
# re-import is cheap in the first place - see scripts/bulk_create.py.
# ---------------------------------------------------------------------------
_POOL: ProcessPoolExecutor | None = None
_POOL_WORKERS = 0
_POOL_LOCK = threading.Lock()


def _shutdown_pool() -> None:
    global _POOL
    with _POOL_LOCK:
        if _POOL is not None:
            _POOL.shutdown(wait=False, cancel_futures=True)
            _POOL = None


atexit.register(_shutdown_pool)


def get_pool(workers: int) -> ProcessPoolExecutor:
    """Lazily create (or resize) the shared render pool."""
    global _POOL, _POOL_WORKERS
    with _POOL_LOCK:
        if _POOL is None or _POOL_WORKERS != workers:
            if _POOL is not None:
                _POOL.shutdown(wait=False, cancel_futures=True)
            _POOL = ProcessPoolExecutor(max_workers=workers)
            _POOL_WORKERS = workers
        return _POOL

#: (order payload, destination path)
RenderJob = tuple[dict[str, Any], str]


@dataclass(slots=True)
class RenderOutcome:
    tracking_no: str
    path: str
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.error is None


def _render_one(job: RenderJob) -> tuple[str, str, str | None]:
    payload, destination = job
    tracking_no = str(payload.get("tracking_no", ""))
    try:
        render_waybill(payload, destination)
    except Exception as exc:                      # noqa: BLE001 - reported per row
        return tracking_no, destination, f"{type(exc).__name__}: {exc}"
    return tracking_no, destination, None


def _render_chunk(chunk: Sequence[RenderJob]) -> list[tuple[str, str, str | None]]:
    """Executed inside a worker process."""
    return [_render_one(job) for job in chunk]


def _chunks(jobs: Sequence[RenderJob], size: int) -> list[Sequence[RenderJob]]:
    size = max(1, size)
    return [jobs[i : i + size] for i in range(0, len(jobs), size)]


def render_serial(
    jobs: Sequence[RenderJob], on_progress: Callable[[int], None] | None = None
) -> list[RenderOutcome]:
    out: list[RenderOutcome] = []
    for job in jobs:
        out.append(RenderOutcome(*_render_one(job)))
        if on_progress:
            on_progress(1)
    return out


def render_many(
    jobs: Sequence[RenderJob],
    workers: int = 0,
    chunk_size: int = 32,
    on_progress: Callable[[int], None] | None = None,
) -> list[RenderOutcome]:
    """Render every job, returning one :class:`RenderOutcome` per job.

    Falls back to serial rendering for small batches and if a process pool
    cannot be started at all - a restricted host must still produce waybills.
    """
    if not jobs:
        return []

    worker_count = workers or (os.cpu_count() or 4)
    batches = _chunks(list(jobs), chunk_size)

    if worker_count <= 1 or len(batches) <= 1:
        return render_serial(jobs, on_progress)

    results: list[RenderOutcome] = []
    try:
        pool = get_pool(min(worker_count, len(batches)))
        futures = {pool.submit(_render_chunk, chunk): chunk for chunk in batches}
        for future in as_completed(futures):
            for row in future.result():
                results.append(RenderOutcome(*row))
            if on_progress:
                on_progress(len(futures[future]))
    except Exception:                             # noqa: BLE001
        _shutdown_pool()
        return render_serial(jobs, on_progress)

    # restore submission order - as_completed returns whatever finishes first
    order = {str(payload.get("tracking_no", "")): i for i, (payload, _) in enumerate(jobs)}
    results.sort(key=lambda r: order.get(r.tracking_no, 0))
    return results


def merge_pdfs(paths: Iterable[str | Path], destination: str | Path) -> Path | None:
    """Concatenate rendered waybills into one file for a single print job."""
    from pypdf import PdfWriter

    writer = PdfWriter()
    count = 0
    for path in paths:
        p = Path(path)
        if not p.exists():
            continue
        writer.append(str(p))
        count += 1
    if not count:
        return None
    out = Path(destination)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("wb") as fh:
        writer.write(fh)
    writer.close()
    return out
