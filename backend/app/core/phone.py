"""Malaysian mobile number normalisation.

Canonical stored form is ``+60 1XXXXXXXX`` (9 or 10 digits after the 60).
"""
from __future__ import annotations

import re

_NON_DIGIT = re.compile(r"\D")


class PhoneError(ValueError):
    pass


def normalise_my_mobile(raw: str | None) -> str:
    """Accept ``01x...``, ``601x...``, ``+601x...``, ``01x-xxx xxxx`` forms.

    Returns ``"+60 1XXXXXXXX"``.  Raises :class:`PhoneError` for anything that
    is not a plausible Malaysian mobile number.
    """
    if raw is None or not str(raw).strip():
        raise PhoneError("phone is required")

    digits = _NON_DIGIT.sub("", str(raw))

    if digits.startswith("60"):
        national = digits[2:]
    elif digits.startswith("0"):
        national = digits[1:]
    else:
        national = digits

    if not national.startswith("1"):
        raise PhoneError(f"not a Malaysian mobile number: {raw!r}")
    # 01X-XXXXXXX -> 9 digits (e.g. 123456789) or 10 (011 numbers)
    if not 9 <= len(national) <= 10:
        raise PhoneError(f"mobile number must have 9-10 digits after '0': {raw!r}")

    return f"+60 {national}"
