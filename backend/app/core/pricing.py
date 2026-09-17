"""Freight calculation driven by ``config/rates.yml``.

Drives ``Total Shipping Fee`` and the Chargeable Information figures in the UI.
Never printed on the waybill.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from app.config import get_rates

TWOPLACES = Decimal("0.01")
ZERO = Decimal("0.00")


def _q(value: Decimal | float | int) -> Decimal:
    return Decimal(str(value)).quantize(TWOPLACES, rounding=ROUND_HALF_UP)


def _surcharges() -> dict:
    return get_rates().get("surcharges") or {}


def _percent(key: str) -> Decimal:
    return Decimal(str(_surcharges().get(key) or 0)) / Decimal("100")


def _base_fee(scope: str, chargeable_weight: Decimal | float, goods_type: str) -> Decimal:
    """first-kg + per-started-extra-kg; documents at their flat rate."""
    rates = get_rates()
    zones = rates["zones"]
    band = zones.get(scope) or zones[rates.get("default_zone", "WEST")]

    doc_flat = _surcharges().get("document_flat")
    if goods_type == "DOCUMENT" and doc_flat is not None:
        return Decimal(str(doc_flat))

    weight = Decimal(str(chargeable_weight or 0))
    base = Decimal(str(band["first_kg"]))
    if weight > 1:
        extra = math.ceil(float(weight) - 1.0 - 1e-9)
        base += Decimal(str(band["extra_kg"])) * extra
    return base


def cod_fee(cod_amount: Decimal | float = 0) -> Decimal:
    """COD handling fee before tax: max(cod_min, cod_amount * cod_percent)."""
    cod = Decimal(str(cod_amount or 0))
    if cod <= 0:
        return Decimal("0")
    return max(cod * _percent("cod_percent"), Decimal(str(_surcharges().get("cod_min", 0))))


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
    return _q(_base_fee(scope, chargeable_weight, goods_type) + cod_fee(cod_amount))


@dataclass(frozen=True, slots=True)
class FeeBreakdown:
    """Every figure in the Normal Order page's Chargeable Information section.

    Laid out like the J&T portal: Total Shipping Fee is the shipping charge
    alone, while the COD fee and the tax are shown separately beside it.
    """

    base_shipping_fee: Decimal
    base_price_tax: Decimal
    discounted_shipping_fee: Decimal
    discounted_tax: Decimal
    cod_fee: Decimal
    cod_tax: Decimal
    cod_handling_fee: Decimal
    insurance_fee: Decimal | None       # None: insurance is not offered
    total_sst: Decimal
    total_shipping_fee: Decimal


def fee_breakdown(
    scope: str,
    chargeable_weight: Decimal | float,
    *,
    goods_type: str = "PARCEL",
    cod_amount: Decimal | float = 0,
    item_value: Decimal | float = 0,
) -> FeeBreakdown:
    """Split a parcel's charges the way the J&T portal shows them.

    SST (``sst_percent``) applies to the shipping fee, the COD fee and any
    insurance.  No discounts are configured, so the discounted figures are 0.
    """
    sst = _percent("sst_percent")
    base = _q(_base_fee(scope, chargeable_weight, goods_type))
    base_tax = _q(base * sst)
    cod = _q(cod_fee(cod_amount))
    cod_tax = _q(cod * sst)

    insurance: Decimal | None = None
    insurance_tax = ZERO
    surcharges = _surcharges()
    value = Decimal(str(item_value or 0))
    if surcharges.get("insurance_percent") is not None:
        insurance = ZERO
        if value > 0:
            insurance = _q(
                max(
                    value * _percent("insurance_percent"),
                    Decimal(str(surcharges.get("insurance_min") or 0)),
                )
            )
        insurance_tax = _q(insurance * sst)

    return FeeBreakdown(
        base_shipping_fee=base,
        base_price_tax=base_tax,
        discounted_shipping_fee=ZERO,
        discounted_tax=ZERO,
        cod_fee=cod,
        cod_tax=cod_tax,
        cod_handling_fee=cod + cod_tax,
        insurance_fee=insurance,
        total_sst=base_tax + cod_tax + insurance_tax,
        total_shipping_fee=base,
    )
