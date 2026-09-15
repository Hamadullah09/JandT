"""Volumetric and chargeable weight maths (spec section 4.6).

    volumetric_weight = (L x W x H) / 6000
    chargeable_weight = max(actual, volumetric) rounded UP to 0.1 kg
"""
from __future__ import annotations

from decimal import ROUND_CEILING, ROUND_HALF_UP, Decimal

TWO = Decimal("0.01")
TENTH = Decimal("0.1")
DIVISOR = Decimal("6000")


def _d(value: Decimal | float | int | str | None) -> Decimal:
    if value is None or value == "":
        return Decimal("0")
    return Decimal(str(value))


def volumetric_weight(
    length: Decimal | float | None,
    width: Decimal | float | None,
    height: Decimal | float | None,
) -> Decimal:
    """``(L x W x H) / 6000`` rounded to 2 dp."""
    vol = (_d(length) * _d(width) * _d(height)) / DIVISOR
    return vol.quantize(TWO, rounding=ROUND_HALF_UP)


def ceil_to_tenth(value: Decimal | float | None) -> Decimal:
    """Round *up* to the next 0.1 kg.  ``0.81`` -> ``0.9``, ``0.80`` -> ``0.8``."""
    tenths = (_d(value) * 10).to_integral_value(rounding=ROUND_CEILING)
    return (tenths / 10).quantize(TENTH)


def chargeable_weight(
    actual: Decimal | float | None,
    length: Decimal | float | None = 0,
    width: Decimal | float | None = 0,
    height: Decimal | float | None = 0,
) -> Decimal:
    """``max(actual, volumetric)`` rounded up to the next 0.1 kg."""
    vol = volumetric_weight(length, width, height)
    return ceil_to_tenth(max(_d(actual), vol))
