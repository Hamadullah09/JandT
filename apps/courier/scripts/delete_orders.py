"""Delete created orders from the database so their order numbers can be reused.

    python scripts/delete_orders.py --from-csv input/customers_10.csv
    python scripts/delete_orders.py --order-no 12809 12810
    python scripts/delete_orders.py --all

Deleting the PDF files does NOT free an order number: the duplicate guard is the
unique index on ``orders.customer_order_no``, which lives in the database. This
script is the only supported way to release one - there is no DELETE endpoint on
the API.

It always prints what it matched and asks before deleting; pass ``--yes`` to
skip the prompt in a script. Nothing references ``orders``, so the rows come out
cleanly; the import_batch history is left alone.

Note: tracking numbers are NOT rewound. Re-creating a deleted order gives it a
new tracking number, so any label already printed becomes stale.
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


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="delete_orders",
        description="Delete orders from the database so their numbers can be reused.",
    )
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--order-no", nargs="+", metavar="NO", help="order numbers")
    src.add_argument("--from-csv", type=Path, help="delete every order_no in this CSV")
    src.add_argument("--all", action="store_true", help="delete EVERY order")
    p.add_argument("--yes", action="store_true", help="skip the confirmation prompt")
    return p.parse_args(argv)


def _order_nos_from_csv(path: Path) -> list[str]:
    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        field = next(
            (
                f
                for f in (reader.fieldnames or [])
                if f.strip().lower().replace(" ", "_") in {"order_no", "order_number"}
            ),
            None,
        )
        if field is None:
            raise SystemExit(f"No order_no column in {path}")
        return [row[field].strip() for row in reader if (row.get(field) or "").strip()]


async def _run(args: argparse.Namespace) -> int:
    from sqlalchemy import delete, select

    from app.db.models import Order
    from app.db.session import dispose_engine, get_sessionmaker

    if args.from_csv:
        if not args.from_csv.exists():
            print(f"No such CSV: {args.from_csv}")
            return EXIT_FATAL
        wanted = _order_nos_from_csv(args.from_csv)
    elif args.order_no:
        wanted = [str(n).strip() for n in args.order_no]
    else:
        wanted = []

    async with get_sessionmaker()() as session:
        stmt = select(Order)
        if not args.all:
            stmt = stmt.where(Order.customer_order_no.in_(wanted))
        matched = list(await session.scalars(stmt.order_by(Order.id)))

        if not matched:
            print("Nothing matched - no orders deleted.")
            return EXIT_NOTHING

        print(f"\n{len(matched)} order(s) will be deleted:\n")
        for o in matched:
            print(f"  {o.customer_order_no or '(no order_no)':<16} {o.tracking_no}  {o.receiver_name}")

        if not args.yes:
            answer = input(f"\nDelete these {len(matched)} order(s)? [y/N]: ").strip().lower()
            if answer != "y":
                print("Cancelled - nothing was deleted.")
                return EXIT_OK

        ids = [o.id for o in matched]
        await session.execute(delete(Order).where(Order.id.in_(ids)))
        await session.commit()
        print(f"\nDeleted {len(ids)} order(s). Those order numbers are free again.")

    await dispose_engine()
    return EXIT_OK


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    try:
        return asyncio.run(_run(args))
    except KeyboardInterrupt:
        print("\nInterrupted - nothing was deleted.")
        return EXIT_FATAL


if __name__ == "__main__":
    raise SystemExit(main())
