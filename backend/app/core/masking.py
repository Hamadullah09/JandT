"""Phone masking.

The masked form is a *presentation* concern and appears **only** on the printed
waybill.  The database and the UI always keep the full number.
"""
from __future__ import annotations

import re

_NON_DIGIT = re.compile(r"\D")


def mask(phone: str | None) -> str:
    """``"+60 12-506 4173"`` -> ``"******73"``.

    Always six asterisks followed by the final two digits, matching the
    reference waybill (``******94`` / ``******06``).  Short or empty inputs are
    padded rather than raising - a waybill must always render.
    """
    digits = _NON_DIGIT.sub("", phone or "")
    return "*" * 6 + digits[-2:].rjust(2, "*")
