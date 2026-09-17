"""Orders as a CSV file for Excel, each tracking number a link to its tracking page.

Written for people opening the file in Excel or Google Sheets:

* the tracking number is a ``=HYPERLINK(...)`` formula, so clicking it opens
  the tracking page; the plain address is repeated in the last column for
  anything that does not run formulas;
* phone numbers, postcodes and order numbers are written as text formulas
  (``="+60 17-123 4567"``) - otherwise Excel reads ``+60 ...`` as a sum,
  drops a postcode's leading zero and turns long numbers into ``6.3E+11``;
* any other value that starts like a formula (``=``, ``+``, ``-``, ``@``) is
  prefixed with an apostrophe, so text typed into an order can never run as
  one (CSV injection);
* UTF-8 with a byte order mark, which is how Excel recognises UTF-8.
"""
from __future__ import annotations

import csv
import io
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal

from app.core.items import item_text, items_of, total_quantity
from app.core.trace import STATUS_LABELS, as_myt
from app.notify.whatsapp import format_phone

COLUMNS = [
    "No.",
    "Order Date",
    "Order No.",
    "Source",
    "Tracking Number",
    "Status",
    "Last Update",
    "Receiver Name",
    "Phone",
    "Postcode",
    "City",
    "State",
    "Address",
    "Items",
    "Pieces",
    "Payment",
    "COD Amount (RM)",
    "Item Value (RM)",
    "Shipping Fee (RM)",
    "Weight (kg)",
    "Drop-ship",
    "Tracking Link",
]

_FORMULA_START = ("=", "+", "-", "@", "\t", "\r")


@dataclass(slots=True)
class ExportOrder:
    """The order fields the file needs - from the ORM or anywhere else."""

    created_at: datetime
    customer_order_no: str | None
    tracking_no: str
    tracking_status: str
    tracking_updated_at: datetime | None
    receiver_name: str
    receiver_phone: str
    receiver_postcode: str
    receiver_city: str | None
    receiver_state: str
    receiver_address: str
    items: list[dict] | None
    goods_name: str | None
    item_variant: str | None
    quantity: int
    order_payment_type: str | None
    cod_amount: Decimal
    order_value: Decimal
    freight_fee: Decimal | None
    chargeable_weight: Decimal
    source: str = "Website"

    @classmethod
    def of(cls, order: object) -> "ExportOrder":
        return cls(**{name: getattr(order, name) for name in cls.__dataclass_fields__})


def safe(value: object) -> str:
    """Plain text that a spreadsheet will never evaluate."""
    text = "" if value is None else str(value)
    return f"'{text}" if text.startswith(_FORMULA_START) else text


def as_text(value: object) -> str:
    """Kept exactly as written: ``="+60 17-123 4567"``, ``="01000"``."""
    text = "" if value is None else str(value)
    if not text:
        return ""
    return '="' + text.replace('"', '""') + '"'


def link(url: str, label: str) -> str:
    return '=HYPERLINK("{}","{}")'.format(url.replace('"', '""'), label.replace('"', '""'))


def _money(value: Decimal | None) -> str:
    return "" if value is None else f"{value:.2f}"


def _when(moment: datetime | None) -> str:
    return "" if moment is None else f"{as_myt(moment):%Y-%m-%d %H:%M}"


def _dropship(items: list[dict]) -> str:
    """``Yes`` when every item is drop-shipped, ``Some`` when a few are."""
    flagged = sum(1 for item in items if item.get("dropship"))
    return "Yes" if items and flagged == len(items) else "Some" if flagged else ""


def rows(orders: Iterable[ExportOrder], tracking_url: Callable[[str], str]) -> list[list[str]]:
    table = []
    for number, order in enumerate(orders, start=1):
        fields = {
            "items": order.items,
            "goods_name": order.goods_name,
            "item_variant": order.item_variant,
            "quantity": order.quantity,
        }
        items = items_of(fields)
        cod = str(order.order_payment_type or "").upper() == "COD"
        url = tracking_url(order.tracking_no)
        table.append([
            str(number),
            _when(order.created_at),
            as_text(order.customer_order_no),
            safe(order.source),
            link(url, order.tracking_no),
            STATUS_LABELS.get(order.tracking_status, order.tracking_status),
            _when(order.tracking_updated_at),
            safe(order.receiver_name),
            as_text(format_phone(order.receiver_phone)),
            as_text(order.receiver_postcode),
            safe(order.receiver_city),
            safe(order.receiver_state),
            safe(order.receiver_address),
            safe("; ".join(item_text(item, variant=True, separator=" - ") for item in items)),
            str(total_quantity(items)),
            "COD" if cod else "Paid",
            _money(order.cod_amount) if cod else "",
            _money(order.order_value),
            _money(order.freight_fee),
            _money(order.chargeable_weight),
            _dropship(items),
            safe(url),
        ])
    return table


def orders_csv(orders: Iterable[ExportOrder], tracking_url: Callable[[str], str]) -> bytes:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\r\n")
    writer.writerow(COLUMNS)
    writer.writerows(rows(orders, tracking_url))
    return buffer.getvalue().encode("utf-8-sig")
