"""Headless bulk order creation: CSV in, waybill PDFs out.

    python scripts/bulk_create.py \
        --csv  "C:/Users/me/Desktop/orders_sept.csv" \
        --out  "C:/Users/me/Desktop/Waybills/Sept" \
        --sender-profile default \
        --workers 8 \
        [--dry-run] [--merge-pdf] [--start-seq 2158571544]

No web server, no browser.  It imports the same ``core``, ``csv_engine`` and
``waybill`` modules the API uses, so a CSV processed here and the same CSV
processed through the portal produce byte-identical PDFs.

Exit codes:
    0  every row created
    1  partial - some rows failed or were duplicates
    2  fatal - unreadable CSV, unusable output directory, no sender profile

Module-level imports are kept tiny on purpose: the render pool starts its
workers with *spawn*, which re-imports this file in every child process.
Pulling SQLAlchemy and pandas in at module scope would add about a second per
worker to every run.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

EXIT_OK = 0
EXIT_PARTIAL = 1
EXIT_FATAL = 2


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="bulk_create",
        description="Create J&T orders and waybills from a CSV, headless.",
    )
    parser.add_argument("--csv", required=True, type=Path, help="input CSV path")
    parser.add_argument("--out", required=True, type=Path, help="output directory")
    parser.add_argument(
        "--sender-profile",
        default="default",
        help="'default' for the active profile, or an account code",
    )
    parser.add_argument(
        "--workers", type=int, default=0, help="render workers (0 = cpu count)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="parse and validate only - creates nothing, writes nothing",
    )
    parser.add_argument(
        "--merge-pdf", action="store_true", help="also write merged_<batch>.pdf"
    )
    parser.add_argument(
        "--start-seq",
        type=int,
        default=None,
        help="restart the tracking sequence at this value before running",
    )
    parser.add_argument(
        "--quiet", action="store_true", help="suppress the progress display"
    )
    return parser.parse_args(argv)


async def _run(args: argparse.Namespace) -> int:
    from rich.console import Console
    from rich.progress import (
        BarColumn,
        Progress,
        SpinnerColumn,
        TextColumn,
        TimeElapsedColumn,
    )
    from rich.table import Table
    from sqlalchemy import select, text

    from app.config import get_settings
    from app.core.naming import OutputDirError, validate_output_dir
    from app.csv_engine.parser import parse_csv
    from app.csv_engine.pipeline import rows_from_parse, run_pipeline
    from app.db.models import ImportBatch, SenderProfile
    from app.db.session import dispose_engine, get_sessionmaker

    console = Console(stderr=False)
    settings = get_settings()
    if args.workers:
        settings.render_workers = args.workers

    # ---- 1/2. parse + validate ------------------------------------------
    if not args.csv.exists():
        console.print(f"[red]No such CSV:[/red] {args.csv}")
        return EXIT_FATAL

    started = time.perf_counter()
    parsed = parse_csv(args.csv, args.csv.name)
    if parsed.fatal:
        console.print(f"[red]{parsed.fatal}[/red]")
        return EXIT_FATAL

    for warning in parsed.warnings:
        console.print(f"[yellow]warning:[/yellow] {warning}")

    console.print(
        f"[bold]{parsed.total}[/bold] rows read from [cyan]{args.csv.name}[/cyan] - "
        f"[green]{len(parsed.ok_rows)} valid[/green], "
        f"[red]{len(parsed.error_rows)} invalid[/red]"
    )

    if args.dry_run:
        _print_errors(console, Table, parsed.error_rows)
        console.print("[yellow]--dry-run: nothing was created.[/yellow]")
        return EXIT_OK if not parsed.error_rows else EXIT_PARTIAL

    # ---- output directory, validated before anything is created ---------
    try:
        output_dir = validate_output_dir(args.out)
    except OutputDirError as exc:
        console.print(f"[red]{exc}[/red]")
        return EXIT_FATAL

    try:
        async with get_sessionmaker()() as session:
            if args.start_seq is not None:
                await session.execute(
                    text(f"ALTER SEQUENCE tracking_seq RESTART WITH {args.start_seq}")
                )
                await session.commit()
                console.print(f"tracking sequence restarted at {args.start_seq}")

            stmt = select(SenderProfile)
            stmt = (
                stmt.where(SenderProfile.is_active.is_(True))
                if args.sender_profile == "default"
                else stmt.where(SenderProfile.account_code == args.sender_profile)
            )
            sender = await session.scalar(stmt)
            if sender is None:
                console.print(
                    f"[red]No sender profile matching '{args.sender_profile}'.[/red] "
                    "Run `python -m app.db.seed` first."
                )
                return EXIT_FATAL

            batch = ImportBatch(
                filename=args.csv.name,
                source_path=str(args.csv.resolve()),
                output_dir=str(output_dir),
                total_rows=parsed.total,
                ok_rows=len(parsed.ok_rows),
                failed_rows=len(parsed.error_rows),
                status="pending",
                created_by="cli",
            )
            session.add(batch)
            await session.commit()

            rows = rows_from_parse(parsed)

            with Progress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                BarColumn(bar_width=34),
                TextColumn("{task.completed}/{task.total}"),
                TextColumn("[cyan]{task.fields[rate]}[/cyan]"),
                TimeElapsedColumn(),
                console=console,
                disable=args.quiet,
            ) as progress:
                task = progress.add_task(
                    "creating orders", total=len(rows), rate="0 rows/s"
                )
                stage_started = time.perf_counter()

                async def on_progress(stage: str, processed: int, total: int) -> None:
                    elapsed = max(1e-6, time.perf_counter() - stage_started)
                    progress.update(
                        task,
                        description=(
                            "rendering waybills" if stage == "rendering"
                            else "creating orders"
                        ),
                        completed=processed,
                        total=total,
                        rate=f"{processed / elapsed:,.0f} rows/s",
                    )

                summary = await run_pipeline(
                    session,
                    batch=batch,
                    rows=rows,
                    output_dir=output_dir,
                    sender=sender,
                    progress=on_progress,
                    merge=args.merge_pdf,
                )
                progress.update(task, completed=len(rows), total=len(rows))

        elapsed = time.perf_counter() - started
        _print_summary(console, Table, summary, elapsed, output_dir)
        _print_errors(
            console, Table, [r for r in summary.rows if r.status in {"error", "duplicate"}]
        )

        if summary.created == summary.total:
            return EXIT_OK
        return EXIT_PARTIAL
    finally:
        await dispose_engine()


def _print_summary(console, Table, summary, elapsed: float, output_dir: Path) -> None:
    table = Table(show_header=False, box=None, pad_edge=False)
    table.add_column(style="bold")
    table.add_column()
    table.add_row("total rows", str(summary.total))
    table.add_row("created", f"[green]{summary.created}[/green]")
    table.add_row(
        "duplicates",
        f"[yellow]{summary.duplicates}[/yellow]" if summary.duplicates else "0",
    )
    table.add_row("failed", f"[red]{summary.failed}[/red]" if summary.failed else "0")
    table.add_row("elapsed", f"{elapsed:.2f} s  (pipeline {summary.duration_ms} ms)")
    table.add_row(
        "throughput",
        f"{summary.created / elapsed:,.0f} orders/s" if elapsed > 0 else "-",
    )
    table.add_row("output dir", str(output_dir))
    table.add_row("manifest", summary.manifest_path or "-")
    if summary.errors_path:
        table.add_row("errors", summary.errors_path)
    if summary.merged_path:
        table.add_row("merged pdf", summary.merged_path)
    console.print()
    console.print(table)


def _print_errors(console, Table, rows) -> None:
    if not rows:
        return
    table = Table(title="rejected rows", title_justify="left")
    table.add_column("row", justify="right")
    table.add_column("order_no")
    table.add_column("status")
    table.add_column("field")
    table.add_column("message", overflow="fold")
    for row in rows[:50]:
        order_no = getattr(row, "order_no", None) or (
            row.raw.get("order_no", "") if hasattr(row, "raw") else ""
        )
        table.add_row(
            str(row.row_no),
            str(order_no),
            row.status,
            row.error_field or "",
            row.error_message or "",
        )
    console.print()
    console.print(table)
    if len(rows) > 50:
        console.print(f"[dim]... and {len(rows) - 50} more (see the errors CSV)[/dim]")


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    try:
        return asyncio.run(_run(args))
    except KeyboardInterrupt:
        print("\ninterrupted", file=sys.stderr)
        return EXIT_FATAL


if __name__ == "__main__":
    raise SystemExit(main())
