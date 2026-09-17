"""Several items in one parcel.

An order stores its items as a list of ``{"name", "variant", "quantity"}``
dicts, plus ``"image"`` when a CSV row named a product photo.  The older
single-item columns stay filled in, so everything that reads them keeps
working:

* one item      -> ``goods_name`` is its name, ``item_variant`` its variant and
  ``quantity`` its quantity - exactly as before items existed;
* several items -> ``goods_name`` describes the parcel (``"Maxi Chic x2, Gown"``),
  ``item_variant`` is empty (each item has its own) and ``quantity`` is the
  total number of pieces.

Orders saved before items existed have no list; :func:`items_of` rebuilds one
from those columns.
"""
from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

#: the J&T label's separator between product and variant - two spaces
LABEL_SEPARATOR = " -  "


def _same(text: str) -> str:
    """Comparison form: case and repeated spaces do not make a new product."""
    return " ".join(text.split()).casefold()


def normalise_items(raw: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Tidy item lines and merge repeats of the same product and variant.

    Accepts ``name``/``variant`` or the CSV's ``goods_name``/``item_variant``.
    Names are kept as typed (only trimmed); lines without a name are dropped;
    a missing quantity counts as one.  Two lines for the same product in the
    same variant become one line with the quantities added up - unless one is
    drop-shipped and the other is not: those are fulfilled by different people.

    ``dropship`` and ``image`` are stored only when set, so items saved before
    either existed look exactly the same.
    """
    merged: dict[tuple[str, str, bool], dict[str, Any]] = {}
    for item in raw:
        name = str(item.get("name") or item.get("goods_name") or "").strip()
        if not name:
            continue
        variant = str(item.get("variant") or item.get("item_variant") or "").strip()
        quantity = int(item.get("quantity") or 1)
        image = str(item.get("image") or "").strip()
        dropship = bool(item.get("dropship"))

        key = (_same(name), _same(variant), dropship)
        if key in merged:
            merged[key]["quantity"] += quantity
            if image and not merged[key].get("image"):
                merged[key]["image"] = image
            continue
        entry: dict[str, Any] = {"name": name, "variant": variant, "quantity": quantity}
        if image:
            entry["image"] = image
        if dropship:
            entry["dropship"] = True
        merged[key] = entry
    return list(merged.values())


def all_dropship(items: list[Mapping[str, Any]]) -> bool:
    """Every item is drop-shipped (and there is at least one)."""
    return bool(items) and all(item.get("dropship") for item in items)


def supplier_ships(items: list[Mapping[str, Any]], payment_type: str | None) -> bool:
    """The supplier sends this parcel, not the shop.

    Only a PAID order whose items are ALL drop-shipped.  Cash on delivery stays
    with the shop, and so does a parcel mixing drop-shipped and in-stock items.
    Such an order goes to the drop-ship WhatsApp group and is left out of the
    packing PDFs.
    """
    return all_dropship(items) and str(payment_type or "PREPAID").upper() != "COD"


def items_of(order: Mapping[str, Any]) -> list[dict[str, Any]]:
    """An order's items - also for orders saved before items existed."""
    if order.get("items"):
        return normalise_items(order["items"])
    return normalise_items(
        [
            {
                "name": order.get("goods_name"),
                "variant": order.get("item_variant"),
                "quantity": order.get("quantity"),
            }
        ]
    )


def total_quantity(items: Iterable[Mapping[str, Any]]) -> int:
    return sum(int(item["quantity"]) for item in items)


def item_text(item: Mapping[str, Any], *, variant: bool, separator: str = LABEL_SEPARATOR) -> str:
    """``"Maxi Chic"``, ``"Maxi Chic x2"`` or ``"Maxi Chic -  Purple / L x2"``."""
    text = str(item["name"])
    if variant and item.get("variant"):
        text = f"{text}{separator}{item['variant']}"
    if int(item["quantity"]) > 1:
        text = f"{text} x{item['quantity']}"
    return text


def _by_product(items: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """One entry per product with quantities added up, for text without sizes.

    Without variants, "Maxi Chic (S), Maxi Chic (L)" would print as the
    confusing "Maxi Chic, Maxi Chic"; it reads "Maxi Chic x2" instead.
    """
    merged: dict[str, dict[str, Any]] = {}
    for item in items:
        key = _same(str(item["name"]))
        if key in merged:
            merged[key]["quantity"] += int(item["quantity"])
        else:
            merged[key] = {"name": item["name"], "variant": "", "quantity": int(item["quantity"])}
    return list(merged.values())


def item_parts(items: Iterable[Mapping[str, Any]], *, variants: bool) -> list[str]:
    """One text per entry: every line with sizes, or one per product without."""
    lines = list(items) if variants else _by_product(items)
    return [item_text(item, variant=variants) for item in lines]


def describe(items: Iterable[Mapping[str, Any]], *, variants: bool = False) -> str:
    """Comma-separated parcel contents: ``"Maxi Chic x2, Chiffon Gown"``."""
    return ", ".join(item_parts(items, variants=variants))


def is_simple(items: list[Mapping[str, Any]]) -> bool:
    """One item, one piece: the label prints it exactly like the J&T reference."""
    return len(items) <= 1 and (not items or int(items[0]["quantity"]) == 1)


def order_columns(items: list[Mapping[str, Any]]) -> dict[str, Any]:
    """The single-item columns (``goods_name``, ``item_variant``, ``quantity``)."""
    if len(items) == 1:
        only = items[0]
        return {
            "goods_name": only["name"],
            "item_variant": only.get("variant") or "",
            "quantity": int(only["quantity"]),
        }
    return {
        "goods_name": describe(items),
        "item_variant": "",
        "quantity": total_quantity(items),
    }


def product_key(items: list[Mapping[str, Any]]) -> str | None:
    """The product every item shares, or ``None`` when the parcel mixes products.

    Variants do not split a product: 25 orders of the same suit in different
    sizes are still one product to pack.
    """
    names = {_same(str(item["name"])) for item in items}
    return next(iter(names)) if len(names) == 1 else None
