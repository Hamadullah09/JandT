"""All orders in one CSV file for Excel - each tracking number opens its tracking page.

    python scripts/export_orders.py                     every order
    python scripts/export_orders.py --today             today's orders (Malaysia time)
    python scripts/export_orders.py --days 7            the last 7 days
    python scripts/export_orders.py --status DELIVERED  only delivered parcels
    python scripts/export_orders.py --source Daraz      only orders from Daraz
    python scripts/export_orders.py --out orders.csv --no-open

Writes ``exports/orders_<date>_<time>.csv`` and opens it.  One row per order:
order number, tracking number, status, receiver, address, items, payment.
Clicking a tracking number opens its page on the website, so the website must
be running (``jt-portal``) for the links to load.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import datetime
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

EXIT_OK = 0
EXIT_NOTHING = 1
EXIT_FATAL = 2


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="export_orders",
        description="All orders in a CSV file, each tracking number linked to its tracking page.",
    )
    when = p.add_mutually_exclusive_group()
    when.add_argument("--today", action="store_true", help="only today's orders")
    when.add_argument("--days", type=int, choices=(7, 30), help="only the last 7 or 30 days")
    p.add_argument("--status", help="only one status, e.g. IN_TRANSIT or DELIVERED")
    p.add_argument("--source", help="only orders from one source, e.g. Daraz or Website")
    p.add_argument("--out", type=Path, help="file to write (default exports/orders_<date>_<time>.csv)")
    p.add_argument("--no-open", action="store_true", help="do not open the file afterwards")
    return p.parse_args(argv)


async def _run(args: argparse.Namespace) -> int:
    from sqlalchemy import select

    from app.api.v1.admin import period_start
    from app.config import get_settings
    from app.core import trace
    from app.core.export import ExportOrder, orders_csv
    from app.core.sources import normalise_source
    from app.db.models import Order
    from app.db.session import dispose_engine, get_sessionmaker

    settings = get_settings()
    status = (args.status or "").strip().upper() or None
    if status and status not in trace.STATUSES:
        print(f"Unknown status {args.status!r} - use one of: {', '.join(trace.STATUSES)}")
        return EXIT_FATAL
    period = "today" if args.today else {7: "7d", 30: "30d"}.get(args.days or 0, "all")

    try:
        async with get_sessionmaker()() as session:
            # newest first, like the admin dashboard
            stmt = select(Order).order_by(Order.created_at.desc(), Order.id.desc())
            start = period_start(period)
            if start is not None:
                stmt = stmt.where(Order.created_at >= start)
            if status:
                stmt = stmt.where(Order.tracking_status == status)
            if args.source:
                stmt = stmt.where(Order.source == normalise_source(args.source))
            orders = [ExportOrder.of(order) for order in await session.scalars(stmt)]
    finally:
        await dispose_engine()

    if not orders:
        print("No orders to export.")
        return EXIT_NOTHING

    stamp = datetime.now(trace.MYT).strftime("%Y-%m-%d_%H%M")
    path = args.out or settings.exports_path / f"orders_{stamp}.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        path.write_bytes(orders_csv(orders, settings.tracking_url))
    except PermissionError:
        print(f"Cannot write {path} - is it open in Excel? Close it and try again.")
        return EXIT_FATAL

    print(f"\n  {len(orders)} order(s) exported to")
    print(f"  {path.resolve()}")
    print("\n  Click a tracking number to open its tracking page.")
    print(f"  (The website must be running: jt-portal. Links go to {settings.tracking_page_url})")

    if not args.no_open and hasattr(os, "startfile"):
        os.startfile(path)                        # noqa: S606 - opens it in Excel on Windows
    return EXIT_OK


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    try:
        return asyncio.run(_run(args))
    except KeyboardInterrupt:
        print("\nInterrupted.")
        return EXIT_FATAL


if __name__ == "__main__":
    raise SystemExit(main())
