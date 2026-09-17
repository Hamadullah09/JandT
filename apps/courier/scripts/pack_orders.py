"""One PDF per item for a day's orders - ready to print and pack.

    python scripts/pack_orders.py                  pick a day from a list
    python scripts/pack_orders.py --today
    python scripts/pack_orders.py --date 2026-09-16

Every order of that day is included, whether it came from a CSV or from the
Normal Order page.  The PDFs go to ``waybills/packing/<day>/``, and running it
again for the same day replaces them:

    Embroidered Maxi Chic - 25 orders.pdf
    Pure Chiffon Gown - 8 orders.pdf
    Mixed items - 3 orders.pdf

Parcels holding several different products go in "Mixed items" only, so no
label is ever printed twice.  A label deleted from disk is rendered again first,
byte-identical to the original.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import date
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

EXIT_OK = 0
EXIT_NOTHING = 1
EXIT_FATAL = 2
RECENT_DAYS = 14


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="pack_orders",
        description="One PDF per item for a day's orders, ready to print and pack.",
    )
    when = p.add_mutually_exclusive_group()
    when.add_argument("--date", type=date.fromisoformat, metavar="YYYY-MM-DD")
    when.add_argument("--today", action="store_true")
    p.add_argument("--out", type=Path, help="folder for the PDFs (default waybills/packing/<day>)")
    p.add_argument("--no-open", action="store_true", help="do not open the folder afterwards")
    return p.parse_args(argv)


def _pick_day(days: list[tuple[date, int]]) -> date | None:
    print("\n  Orders by day")
    print("  -------------")
    for i, (day, count) in enumerate(days, start=1):
        print(f"    [{i}] {day.isoformat()}   {count} order{'s' if count != 1 else ''}")
    print()
    while True:
        answer = input(f"  Select 1-{len(days)} (or Enter to cancel): ").strip()
        if not answer:
            return None
        if answer.isdigit() and 1 <= int(answer) <= len(days):
            return days[int(answer) - 1][0]
        print(f'  "{answer}" is not one of 1-{len(days)}.')


async def _run(args: argparse.Namespace) -> int:
    from sqlalchemy import func, select

    from app.config import get_settings
    from app.core.items import items_of, supplier_ships
    from app.core.naming import unique_path, waybill_filename
    from app.db.models import Order
    from app.db.session import dispose_engine, get_sessionmaker
    from app.waybill.dto import OrderDTO
    from app.waybill.packing import PackingOrder, write_packing_pdfs
    from app.waybill.renderer import render_waybill

    settings = get_settings()
    try:
        async with get_sessionmaker()() as session:
            if args.today or args.date:
                day = date.today() if args.today else args.date
            else:
                days = [
                    (row[0], row[1])
                    for row in await session.execute(
                        select(Order.order_date, func.count())
                        .where(Order.status == "created", Order.order_date.is_not(None))
                        .group_by(Order.order_date)
                        .order_by(Order.order_date.desc())
                        .limit(RECENT_DAYS)
                    )
                ]
                if not days:
                    print("There are no orders yet.")
                    return EXIT_NOTHING
                day = _pick_day(days)
                if day is None:
                    print("  Cancelled.")
                    return EXIT_OK

            orders = list(
                await session.scalars(
                    select(Order)
                    .where(Order.status == "created", Order.order_date == day)
                    .order_by(Order.id)
                )
            )
            if not orders:
                print(f"No orders on {day.isoformat()}.")
                return EXIT_NOTHING

            rendered: list[str] = []

            def render_missing(packing: PackingOrder) -> Path | None:
                order = packing.source
                path = unique_path(
                    settings.default_output_dir,
                    order.waybill_filename
                    or waybill_filename(order.customer_order_no, order.tracking_no),
                )
                render_waybill(OrderDTO.from_order(order), path)
                order.waybill_path, order.waybill_filename = str(path), path.name
                rendered.append(path.name)
                return path

            folder = args.out or settings.default_output_dir / "packing" / day.isoformat()
            packing = []
            for position, o in enumerate(orders):
                items = items_of(
                    {
                        "items": o.items,
                        "goods_name": o.goods_name,
                        "item_variant": o.item_variant,
                        "quantity": o.quantity,
                    }
                )
                packing.append(
                    PackingOrder(
                        order_no=o.customer_order_no or "",
                        tracking_no=o.tracking_no,
                        items=items,
                        waybill_path=o.waybill_path,
                        sequence=position,
                        supplier_ships=supplier_ships(items, o.order_payment_type),
                        source=o,
                    )
                )
            left_out = sum(p.supplier_ships for p in packing)
            files = write_packing_pdfs(packing, folder, render_missing=render_missing)
            await session.commit()
    finally:
        await dispose_engine()

    print(f"\n{len(orders)} order(s) on {day.isoformat()} -> {len(files)} PDF(s) in {folder}\n")
    for packed in files:
        pieces = f"   ({packed.pieces} pcs)" if packed.pieces != packed.orders else ""
        print(f"  {packed.path.name}{pieces}")
    if left_out:
        print(f"\n  {left_out} paid drop-ship order(s) left out - your supplier ships them.")
    if rendered:
        print(f"\n  {len(rendered)} missing label(s) were rendered again first.")

    if files and not args.no_open and hasattr(os, "startfile"):
        os.startfile(folder)                      # noqa: S606 - opens Explorer on Windows
    return EXIT_OK if files else EXIT_NOTHING


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    try:
        return asyncio.run(_run(args))
    except KeyboardInterrupt:
        print("\nInterrupted.")
        return EXIT_FATAL


if __name__ == "__main__":
    raise SystemExit(main())
