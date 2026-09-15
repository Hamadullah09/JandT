"""End-to-end timing harness for the 500-row acceptance criterion.

    python -m tests.bench_500 [--csv PATH] [--out DIR] [--rows N]

Prints a stage-by-stage breakdown and the measured ``duration_ms``, then checks
what acceptance criteria 6 and 7 care about: every PDF on disk, correctly named,
and every tracking number distinct.

Module-level imports are deliberately tiny.  The render pool starts workers with
*spawn*, which re-imports this module in every child; pulling SQLAlchemy and
pandas in at module scope would cost roughly a second per worker.
"""
from __future__ import annotations

import argparse
import asyncio
import shutil
import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

DEFAULT_CSV = BACKEND / "samples" / "bulk_orders_500.csv"
DEFAULT_OUT = BACKEND.parent / "waybills" / "bench"
BUDGET_MS = 15_000


async def run(csv_path: Path, out_dir: Path, limit: int | None) -> int:
    from sqlalchemy import select, text

    from app.core.naming import validate_output_dir
    from app.csv_engine.parser import parse_csv
    from app.csv_engine.pipeline import rows_from_parse, run_pipeline
    from app.db.models import ImportBatch, SenderProfile
    from app.db.session import dispose_engine, get_sessionmaker

    try:
        t0 = time.perf_counter()
        parsed = parse_csv(csv_path, csv_path.name)
        parse_ms = (time.perf_counter() - t0) * 1000
        if parsed.fatal:
            print(f"FATAL: {parsed.fatal}")
            return 2

        ok_rows = parsed.ok_rows[:limit] if limit else parsed.ok_rows
        print(
            f"parse+validate : {parse_ms:8.1f} ms   ({parsed.total} rows, "
            f"{len(parsed.ok_rows)} ok, {len(parsed.error_rows)} invalid)"
        )

        output_dir = validate_output_dir(out_dir)
        for stale in output_dir.glob("*"):
            stale.unlink() if stale.is_file() else shutil.rmtree(stale)

        async with get_sessionmaker()() as session:
            sender = await session.scalar(
                select(SenderProfile).where(SenderProfile.is_active.is_(True))
            )
            if sender is None:
                print("FATAL: no active sender profile - run `python -m app.db.seed`")
                return 2

            batch = ImportBatch(
                filename=csv_path.name,
                source_path=str(csv_path),
                output_dir=str(output_dir),
                total_rows=len(ok_rows),
                status="pending",
                created_by="bench",
            )
            session.add(batch)
            await session.commit()

            # every line of the file, invalid ones included, so the manifest
            # and the error CSV account for all of them
            rows = rows_from_parse(parsed)
            if limit:
                rows = rows[:limit]

            marks: dict[str, float] = {}
            start = time.perf_counter()

            async def progress(stage: str, processed: int, total: int) -> None:
                marks.setdefault(stage, (time.perf_counter() - start) * 1000)

            summary = await run_pipeline(
                session,
                batch=batch,
                rows=rows,
                output_dir=output_dir,
                sender=sender,
                progress=progress,
            )
            wall = (time.perf_counter() - start) * 1000
            render_start = marks.get("rendering", 0.0)

            print(f"create (3,4,5) : {render_start:8.1f} ms")
            print(f"render (6)     : {wall - render_start:8.1f} ms")
            print(f"pipeline total : {summary.duration_ms:8.1f} ms")
            print(f"END TO END     : {parse_ms + wall:8.1f} ms   "
                  f"<-- budget {BUDGET_MS} ms")
            print()
            print(f"created={summary.created} duplicates={summary.duplicates} "
                  f"failed={summary.failed}")

            pdfs = sorted(output_dir.glob("OrderNo_*.pdf"))
            print(f"PDFs on disk   : {len(pdfs)}  "
                  f"(e.g. {pdfs[0].name if pdfs else '-'})")
            print(f"manifest       : {Path(summary.manifest_path).name}")

            total, distinct = (
                await session.execute(
                    text("SELECT count(*), count(DISTINCT tracking_no) FROM orders")
                )
            ).one()
            print(f"orders table   : count={total} distinct_tracking_no={distinct} "
                  f"{'OK' if total == distinct else 'COLLISION!'}")

            checks = {
                f"AC6 under {BUDGET_MS // 1000} s       ": (parse_ms + wall) < BUDGET_MS,
                "AC6 one PDF per order": len(pdfs) == summary.created,
                "AC7 unique tracking  ": total == distinct,
            }
            print()
            for label, passed in checks.items():
                print(f"{label} : {'PASS' if passed else 'FAIL'}")
            return 0 if all(checks.values()) else 1
    finally:
        await dispose_engine()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", type=Path, default=DEFAULT_CSV)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--rows", type=int, default=None)
    args = ap.parse_args()
    return asyncio.run(run(args.csv, args.out, args.rows))


if __name__ == "__main__":
    raise SystemExit(main())
