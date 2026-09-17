"""Post existing orders to the WhatsApp group.

    python scripts/whatsapp_send.py --order-no 12809
    python scripts/whatsapp_send.py --order-no 12809 --image "#1 (5).jpeg"
    python scripts/whatsapp_send.py --from-csv input/customers_10.csv

New orders are queued automatically.  Use this for orders created before
WhatsApp was switched on, to post an order again, or to try the group setup on
a real order without creating a new one.

It only queues the messages - jt-whatsapp must be running to send them.  A
waybill PDF that was deleted is rendered again first, byte-identical to the
original, so the PDF message is never silently dropped.
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

EXIT_OK = 0
EXIT_NOTHING = 1
EXIT_FATAL = 2

ORDER_FIELDS = (
    "customer_order_no", "tracking_no", "receiver_name", "receiver_address",
    "receiver_postcode", "receiver_city", "receiver_state", "receiver_phone",
    "goods_name", "item_variant", "quantity", "items",
    # decides the group: paid + all drop-shipped goes to the drop-ship group
    "order_payment_type",
)


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="whatsapp_send",
        description="Queue existing orders for the WhatsApp group.",
    )
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--order-no", nargs="+", metavar="NO", help="order numbers")
    src.add_argument(
        "--from-csv", type=Path,
        help="every order in this CSV, with the photo from its image column",
    )
    p.add_argument(
        "--image",
        help="photo for every selected order: a file in images/ or a full path",
    )
    p.add_argument("--yes", action="store_true", help="skip the confirmation prompt")
    return p.parse_args(argv)


def _images_from_csv(path: Path) -> dict[str, str]:
    """order_no -> image, using the same header aliases as the importer."""
    from app.csv_engine.schema import map_headers

    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        columns = map_headers(reader.fieldnames or []).columns
        by_canonical = {canonical: raw for raw, canonical in columns.items()}
        if "order_no" not in by_canonical:
            raise SystemExit(f"No order_no column in {path}")
        order_col, image_col = by_canonical["order_no"], by_canonical.get("image")
        return {
            row[order_col].strip(): (row.get(image_col) or "").strip() if image_col else ""
            for row in reader
            if (row.get(order_col) or "").strip()
        }


async def _run(args: argparse.Namespace) -> int:
    from sqlalchemy import select

    from app.core.naming import unique_path, waybill_filename
    from app.db.models import Order
    from app.db.session import dispose_engine, get_sessionmaker
    from app.notify.whatsapp import queue_orders, service_status
    from app.waybill.dto import OrderDTO
    from app.waybill.renderer import render_waybill
    from app.config import get_settings

    if args.from_csv:
        if not args.from_csv.exists():
            print(f"No such CSV: {args.from_csv}")
            return EXIT_FATAL
        images = _images_from_csv(args.from_csv)
    else:
        images = {str(n).strip(): "" for n in args.order_no}

    try:
        async with get_sessionmaker()() as session:
            orders = list(await session.scalars(
                select(Order)
                .where(Order.customer_order_no.in_(list(images)))
                .order_by(Order.id)
            ))
            missing = sorted(set(images) - {o.customer_order_no for o in orders})
            if missing:
                print(f"Not in the database, skipped: {', '.join(missing)}")
            if not orders:
                print("Nothing to send.")
                return EXIT_NOTHING

            print(f"\n{len(orders)} order(s) will be posted to the WhatsApp group:\n")
            for o in orders:
                photo = args.image or images.get(o.customer_order_no) or "photo by product name"
                print(f"  {o.customer_order_no:<14} {o.tracking_no}  {o.receiver_name}  [{photo}]")

            if not args.yes:
                answer = input(f"\nQueue these {len(orders)} order(s)? [y/N]: ").strip().lower()
                if answer != "y":
                    print("Cancelled - nothing was queued.")
                    return EXIT_OK

            entries = []
            for o in orders:
                pdf = Path(o.waybill_path) if o.waybill_path else None
                if pdf is None or not pdf.is_file():
                    pdf = unique_path(
                        get_settings().default_output_dir,
                        o.waybill_filename or waybill_filename(o.customer_order_no, o.tracking_no),
                    )
                    render_waybill(OrderDTO.from_order(o), pdf)
                    o.waybill_path, o.waybill_filename = str(pdf), pdf.name
                    print(f"  re-rendered missing waybill: {pdf.name}")
                fields = {name: getattr(o, name) for name in ORDER_FIELDS}
                entries.append((fields, args.image or images.get(o.customer_order_no), str(pdf)))
            await session.commit()
    finally:
        await dispose_engine()

    result = queue_orders(entries)
    to_dropship = f" ({result.to_dropship} to the drop-ship group)" if result.to_dropship else ""
    print(f"\nQueued {result.queued} order(s){to_dropship}.")
    for warning in result.warnings:
        print(f"  warning: {warning}")
    print(f"WhatsApp: {service_status().describe()}")
    return EXIT_OK if result.queued == len(entries) else EXIT_FATAL


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    try:
        return asyncio.run(_run(args))
    except KeyboardInterrupt:
        print("\nInterrupted - nothing was queued.")
        return EXIT_FATAL


if __name__ == "__main__":
    raise SystemExit(main())
