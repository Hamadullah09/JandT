"""One PDF per product, for printing and packing.

Orders whose parcel holds a single product - in any size or colour, any
quantity - are grouped under that product.  Parcels that mix products go
together in "Mixed items": putting a mixed parcel in each of its products'
files would print its label twice.  Each PDF is just those orders' labels,
one per page, with identical sizes and colours next to each other.

Built automatically after every CSV import (``packing/batch-<id>/``) and on
demand for a whole day by ``scripts/pack_orders.py`` (``packing/<date>/``).
"""
from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.core.items import product_key, total_quantity
from app.core.naming import sanitise_stem, unique_path
from app.waybill.batch import merge_pdfs

MIXED = "Mixed items"
#: only files this module wrote are ever removed from a packing folder
_OURS = re.compile(r" - \d+ orders?(_\d+)?\.pdf$", re.IGNORECASE)


@dataclass(slots=True)
class PackingOrder:
    order_no: str
    tracking_no: str
    items: list[dict[str, Any]]
    waybill_path: str | None
    #: position in creation order, used as the tie-break inside a file
    sequence: int = 0
    #: the ORM order, when a missing label has to be rendered again
    source: Any = field(default=None, repr=False)


@dataclass(slots=True)
class PackingFile:
    title: str
    path: Path
    orders: int
    pieces: int


def group_for_packing(orders: list[PackingOrder]) -> list[tuple[str, list[PackingOrder]]]:
    """``[(title, orders)]``: products A-Z, then Mixed items last."""
    groups: dict[str | None, list[PackingOrder]] = {}
    titles: dict[str | None, str] = {None: MIXED}
    for order in orders:
        key = product_key(order.items) if order.items else None
        groups.setdefault(key, []).append(order)
        if key is not None:
            titles.setdefault(key, str(order.items[0]["name"]))

    result = []
    for key, members in groups.items():
        if key is None:
            members.sort(key=lambda o: o.sequence)
        else:
            # same size/colour together, so identical pieces are packed in one go
            members.sort(
                key=lambda o: (str(o.items[0].get("variant") or "").casefold(), o.sequence)
            )
        result.append((titles[key], members))
    result.sort(key=lambda group: (group[0] == MIXED, group[0].casefold()))
    return result


def write_packing_pdfs(
    orders: list[PackingOrder],
    folder: Path,
    render_missing: Callable[[PackingOrder], Path | None] | None = None,
) -> list[PackingFile]:
    """Write one PDF per product into *folder*, replacing an earlier run's files.

    *render_missing* is asked for a label whose PDF is gone from disk; without
    it, such an order is left out rather than failing the whole file.
    """
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob("*.pdf"):
        if _OURS.search(old.name):
            old.unlink()

    written: list[PackingFile] = []
    taken: set[str] = set()
    for title, members in group_for_packing(orders):
        labels: list[Path] = []
        included: list[PackingOrder] = []
        for order in members:
            path = Path(order.waybill_path) if order.waybill_path else None
            if (path is None or not path.is_file()) and render_missing is not None:
                path = render_missing(order)
            if path is not None and path.is_file():
                labels.append(path)
                included.append(order)
        if not labels:
            continue
        count = len(included)
        name = f"{sanitise_stem(title) or 'Item'} - {count} order{'s' if count != 1 else ''}.pdf"
        merged = merge_pdfs(labels, unique_path(folder, name, taken))
        if merged is not None:
            written.append(
                PackingFile(
                    title=title,
                    path=Path(merged),
                    orders=count,
                    pieces=sum(total_quantity(o.items) for o in included),
                )
            )
    return written
