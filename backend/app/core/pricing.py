"""Freight calculation driven by ``config/rates.yml``.

Drives ``Total Shipping Fee`` in the UI.  Never printed on the waybill.
"""
from __future__ import annotations

import math
from decimal import ROUND_HALF_UP, Decimal

from app.config import get_rates

TWOPLACES = Decimal("0.01")


def _q(value: Decimal | float | int) -> Decimal:
    return Decimal(str(value)).quantize(TWOPLACES, rounding=ROUND_HALF_UP)


def freight_fee(
    scope: str,
    chargeable_weight: Decimal | float,
    *,
    goods_type: str = "PARCEL",
    cod_amount: Decimal | float = 0,
) -> Decimal:
    """first-kg + per-started-extra-kg, plus an optional COD handling fee.

    Unknown zones fall back to ``default_zone`` rather than raising - pricing
    must never be the reason an order fails to create.
    """
    rates = get_rates()
    zones = rates["zones"]
    band = zones.get(scope) or zones[rates.get("default_zone", "WEST")]

    surcharges = rates.get("surcharges") or {}
    doc_flat = surcharges.get("document_flat")

    if goods_type == "DOCUMENT" and doc_flat is not None:
        base = Decimal(str(doc_flat))
    else:
        weight = Decimal(str(chargeable_weight or 0))
        base = Decimal(str(band["first_kg"]))
        if weight > 1:
            extra = math.ceil(float(weight) - 1.0 - 1e-9)
            base += Decimal(str(band["extra_kg"])) * extra

    cod = Decimal(str(cod_amount or 0))
    if cod > 0:
        pct = Decimal(str(surcharges.get("cod_percent", 0))) / Decimal("100")
        fee = max(cod * pct, Decimal(str(surcharges.get("cod_min", 0))))
        base += fee

    return _q(base)
