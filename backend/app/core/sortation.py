"""Sortation code, route code and service scope derivation.

Reference waybill (``OrderNo_12808.pdf``) for receiver postcode ``43000``::

    sortation code : 300-K41-SG496
    route code     : E03
    service scope  : SAME CITY      (sender 43300 Selangor -> receiver Selangor)

Composition::

    sortation_code = f"{zone_code}-{hub_code}-{state_abbr}{dp_code}"

``zone_code`` is derived arithmetically from the postcode; ``hub_code`` and
``dp_code`` are *seeded* per postcode in ``postcode_zone`` because they encode
physical J&T infrastructure that cannot be computed from the number alone.
Unseeded postcodes fall back to a deterministic rule (never a crash) - see
:func:`fallback_hub_code` / :func:`fallback_dp_code`.
"""
from __future__ import annotations

STATE_ABBR: dict[str, str] = {
    "JOHOR": "JH",
    "KEDAH": "KE",
    "KELANTAN": "KN",
    "MELAKA": "ME",
    "MALACCA": "ME",
    "NEGERI SEMBILAN": "NS",
    "PAHANG": "PH",
    "PERAK": "PK",
    "PERLIS": "PL",
    "PULAU PINANG": "PG",
    "PENANG": "PG",
    "SABAH": "SB",
    "SARAWAK": "SW",
    "SELANGOR": "SG",
    "TERENGGANU": "TR",
    "KUALA LUMPUR": "KL",
    "WILAYAH PERSEKUTUAN": "KL",
    "LABUAN": "LB",
    "PUTRAJAYA": "PJ",
}

#: Treated as one metropolitan area for scope purposes.
KLANG_VALLEY = {"SELANGOR", "KUALA LUMPUR", "PUTRAJAYA"}

#: East Malaysia - anything involving these is scope EAST.
EAST_STATES = {"SABAH", "SARAWAK", "LABUAN"}

SCOPE_SAME_CITY = "SAME CITY"
SCOPE_WEST = "WEST"
SCOPE_EAST = "EAST"


def primary_state(state_field: str | None) -> str:
    """``"SELANGOR/PETALING/SERI KEMBANGAN"`` -> ``"SELANGOR"``.

    J&T stores the state picker as a ``state/district/area`` path; only the
    first segment is the state itself.
    """
    if not state_field:
        return ""
    return state_field.split("/")[0].strip().upper()


def state_abbr(state_field: str | None) -> str:
    """Two-letter carrier abbreviation, e.g. ``SELANGOR`` -> ``SG``."""
    st = primary_state(state_field)
    if st in STATE_ABBR:
        return STATE_ABBR[st]
    letters = "".join(c for c in st if c.isalpha())
    return (letters[:2] or "XX").upper()


def zone_code(postcode: str) -> str:
    """Digits 2-4 of the postcode.  ``43000`` -> ``300``."""
    pc = str(postcode).strip()
    if len(pc) != 5 or not pc.isdigit():
        raise ValueError(f"postcode must be 5 digits: {postcode!r}")
    return pc[1:4]


def fallback_hub_code(postcode: str, state_field: str | None) -> str:
    """Stable hub code for postcodes absent from the seed table."""
    abbr = state_abbr(state_field)
    return f"{abbr[0]}{int(postcode) % 100:02d}"


def fallback_dp_code(postcode: str) -> str:
    """Stable 3-digit delivery-point code for unseeded postcodes."""
    return f"{(int(postcode) * 7919) % 1000:03d}"


def fallback_route_code(postcode: str) -> str:
    """Stable route code for unseeded postcodes, e.g. ``E03``."""
    n = int(postcode)
    letter = chr(ord("A") + n % 26)
    return f"{letter}{n // 26 % 100:02d}"


def build_sortation_code(
    postcode: str, hub_code: str, state_field: str | None, dp_code: str
) -> str:
    """``("43000", "K41", "Selangor", "496")`` -> ``"300-K41-SG496"``."""
    return f"{zone_code(postcode)}-{hub_code}-{state_abbr(state_field)}{dp_code}"


def service_scope(sender_state: str | None, receiver_state: str | None) -> str:
    """Classify a lane as ``SAME CITY`` / ``WEST`` / ``EAST``.

    * Either endpoint in Sabah / Sarawak / Labuan -> ``EAST``.
    * Same state, or both inside the Klang Valley -> ``SAME CITY``.
      (The reference waybill ships 43300 Seri Kembangan -> 43000 Kajang and is
      stamped ``SAME CITY``, so J&T treats the whole Klang Valley as one city.)
    * Otherwise Peninsular-to-Peninsular -> ``WEST``.
    """
    snd = primary_state(sender_state)
    rcv = primary_state(receiver_state)

    if snd in EAST_STATES or rcv in EAST_STATES:
        return SCOPE_EAST
    if snd and rcv and (snd == rcv or {snd, rcv} <= KLANG_VALLEY):
        return SCOPE_SAME_CITY
    return SCOPE_WEST
