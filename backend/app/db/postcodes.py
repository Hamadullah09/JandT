"""Malaysian postcode reference data used to seed ``postcode_zone``.

Postcodes are allocated by the national operator in contiguous numeric ranges
per state, so the table is generated from range definitions rather than shipped
as a 77k-line CSV.  Every 5-digit code inside a live range is materialised, which
means postcode validation ("must exist in postcode_zone") rejects codes outside
the national plan (``04000``, ``99999``, ...) while never crashing on a code that
is merely obscure.

``hub_code`` / ``dp_code`` / ``route_code`` encode physical J&T infrastructure.
They are seeded per block where known and fall back to the deterministic rules in
:mod:`app.core.sortation` otherwise.
"""
from __future__ import annotations

from typing import Iterator

from app.core.sortation import (
    fallback_dp_code,
    fallback_hub_code,
    fallback_route_code,
)

# ---------------------------------------------------------------------------
# state ranges: (low, high, state)   - first match wins
# ---------------------------------------------------------------------------
STATE_RANGES: list[tuple[int, int, str]] = [
    (1000, 2800, "PERLIS"),
    (5000, 9810, "KEDAH"),
    (10000, 14400, "PULAU PINANG"),
    (15000, 18500, "KELANTAN"),
    (20000, 24300, "TERENGGANU"),
    (25000, 28800, "PAHANG"),
    (30000, 36810, "PERAK"),
    (39000, 39200, "PAHANG"),          # Cameron Highlands
    (40000, 48300, "SELANGOR"),
    (49000, 49000, "PAHANG"),          # Genting Highlands
    (50000, 60999, "KUALA LUMPUR"),
    (62000, 62988, "PUTRAJAYA"),
    (63000, 68100, "SELANGOR"),
    (70000, 73509, "NEGERI SEMBILAN"),
    (75000, 78309, "MELAKA"),
    (79000, 86900, "JOHOR"),
    (87000, 87033, "LABUAN"),
    (88000, 91309, "SABAH"),
    (93000, 98859, "SARAWAK"),
]

# ---------------------------------------------------------------------------
# city blocks: (low, high, city)  - consulted before falling back to the state
# ---------------------------------------------------------------------------
CITY_RANGES: list[tuple[int, int, str]] = [
    # --- Pulau Pinang -------------------------------------------------------
    (10000, 10999, "GEORGE TOWN"),
    (11000, 11499, "BALIK PULAU"),
    (11500, 11699, "AYER ITAM"),
    (11700, 11799, "GELUGOR"),
    (11800, 11899, "SUNGAI ARA"),
    (11900, 11999, "BAYAN LEPAS"),
    (12000, 13999, "BUTTERWORTH"),
    (14000, 14400, "BUKIT MERTAJAM"),
    # --- Perak --------------------------------------------------------------
    (30000, 30999, "IPOH"),
    (31000, 31099, "BATU GAJAH"),
    (31100, 31299, "SUNGAI SIPUT"),
    (31300, 31399, "KINTA"),
    (31400, 31999, "IPOH"),
    (32000, 32999, "SITIAWAN"),
    (33000, 33999, "KUALA KANGSAR"),
    (34000, 34999, "TAIPING"),
    (35000, 35999, "BIDOR"),
    (36000, 36810, "TELUK INTAN"),
    # --- Selangor -----------------------------------------------------------
    (40000, 40999, "SHAH ALAM"),
    (41000, 41999, "KLANG"),
    (42000, 42999, "KAPAR"),
    (43000, 43099, "KAJANG"),
    (43100, 43199, "HULU LANGAT"),
    (43200, 43299, "CHERAS"),
    (43300, 43399, "SERI KEMBANGAN"),
    (43400, 43499, "SERDANG"),
    (43500, 43599, "SEMENYIH"),
    (43600, 43699, "BANGI"),
    (43700, 43799, "BERANANG"),
    (43800, 43899, "DENGKIL"),
    (43900, 43999, "SEPANG"),
    (44000, 44399, "KUALA KUBU BHARU"),
    (45000, 45999, "KUALA SELANGOR"),
    (46000, 46999, "PETALING JAYA"),
    (47000, 47199, "SUNGAI BULOH"),
    (47200, 47299, "PUCHONG"),
    (47300, 47499, "PETALING JAYA"),
    (47500, 47699, "SUBANG JAYA"),
    (47700, 47799, "PETALING JAYA"),
    (47800, 47899, "PETALING JAYA"),
    (47900, 47999, "PETALING JAYA"),
    (48000, 48300, "RAWANG"),
    (63000, 63999, "CYBERJAYA"),
    (64000, 64999, "SEPANG"),
    (65000, 68100, "AMPANG"),
    # --- Federal territories ------------------------------------------------
    (50000, 60999, "KUALA LUMPUR"),
    (62000, 62988, "PUTRAJAYA"),
    # --- Johor --------------------------------------------------------------
    (79000, 79999, "ISKANDAR PUTERI"),
    (80000, 80999, "JOHOR BAHRU"),
    (81000, 81099, "KULAI"),
    (81100, 81299, "JOHOR BAHRU"),
    (81300, 81399, "SKUDAI"),
    (81400, 81499, "SENAI"),
    (81500, 81599, "GELANG PATAH"),
    (81600, 81699, "PEKAN NANAS"),
    (81700, 81799, "MASAI"),
    (81800, 82999, "ULU TIRAM"),
    (83000, 83999, "BATU PAHAT"),
    (84000, 84999, "MUAR"),
    (85000, 85999, "SEGAMAT"),
    (86000, 86900, "KLUANG"),
    # --- Sabah / Sarawak ----------------------------------------------------
    (88000, 88999, "KOTA KINABALU"),
    (89000, 89999, "PAPAR"),
    (90000, 90999, "SANDAKAN"),
    (91000, 91309, "TAWAU"),
    (93000, 93999, "KUCHING"),
    (94000, 94999, "KOTA SAMARAHAN"),
    (95000, 95999, "SRI AMAN"),
    (96000, 96999, "SIBU"),
    (97000, 97999, "BINTULU"),
    (98000, 98859, "MIRI"),
]

# ---------------------------------------------------------------------------
# hub / route blocks: (low, high, hub_code, route_code)
# Klang Valley is covered exhaustively per the spec; the rest of the country
# gets one hub per state block.
# ---------------------------------------------------------------------------
HUB_RANGES: list[tuple[int, int, str, str]] = [
    (40000, 40999, "S12", "A01"),   # Shah Alam
    (41000, 42999, "K22", "B02"),   # Klang
    (43000, 43099, "K41", "E03"),   # Kajang  <- reference waybill
    (43100, 43199, "H43", "E04"),   # Hulu Langat
    (43200, 43299, "C31", "E05"),   # Cheras
    (43300, 43399, "S44", "E06"),   # Seri Kembangan (the fixed sender)
    (43400, 43499, "S45", "E07"),   # Serdang
    (43500, 43699, "B46", "E08"),   # Semenyih / Bangi
    (43700, 43999, "D47", "E09"),   # Beranang / Dengkil / Sepang
    (44000, 45999, "K51", "F01"),   # Kuala Kubu Bharu / Kuala Selangor
    (46000, 46999, "P61", "C01"),   # Petaling Jaya
    (47000, 47199, "S62", "C02"),   # Sungai Buloh
    (47200, 47299, "P63", "C03"),   # Puchong
    (47300, 47499, "P64", "C04"),   # Petaling Jaya
    (47500, 47699, "S65", "C05"),   # Subang Jaya
    (47700, 47999, "P66", "C06"),   # Petaling Jaya
    (48000, 48300, "R67", "C07"),   # Rawang
    (50000, 60999, "W11", "K01"),   # Kuala Lumpur
    (62000, 62988, "P21", "K02"),   # Putrajaya
    (63000, 63999, "C71", "E10"),   # Cyberjaya
    (64000, 64999, "S72", "E11"),   # Sepang
    (65000, 68100, "A73", "E12"),   # Ampang
    (1000, 2800, "R01", "N01"),     # Perlis
    (5000, 9810, "A02", "N02"),     # Kedah
    (10000, 14400, "P03", "N03"),   # Pulau Pinang
    (15000, 18500, "K04", "N04"),   # Kelantan
    (20000, 24300, "T05", "N05"),   # Terengganu
    (25000, 28800, "K06", "N06"),   # Pahang
    (30000, 36810, "I07", "N07"),   # Perak
    (39000, 39200, "T08", "N08"),   # Cameron Highlands
    (49000, 49000, "G09", "N09"),   # Genting
    (70000, 73509, "S13", "S01"),   # Negeri Sembilan
    (75000, 78309, "M14", "S02"),   # Melaka
    (79000, 86900, "J15", "S03"),   # Johor
    (87000, 87033, "L16", "T01"),   # Labuan
    (88000, 91309, "K17", "T02"),   # Sabah
    (93000, 98859, "Q18", "T03"),   # Sarawak
]

#: Delivery-point codes observed on real waybills.  Everything else uses the
#: deterministic fallback so no postcode is ever without a sortation code.
DP_OVERRIDES: dict[str, str] = {
    "43000": "496",   # OrderNo_12808.pdf -> 300-K41-SG496
}


def _lookup(ranges: list[tuple[int, int, str]], code: int) -> str | None:
    for lo, hi, value in ranges:
        if lo <= code <= hi:
            return value
    return None


def _lookup_hub(code: int) -> tuple[str, str] | None:
    for lo, hi, hub, route in HUB_RANGES:
        if lo <= code <= hi:
            return hub, route
    return None


def state_for(postcode: str) -> str | None:
    """State for a 5-digit postcode, or ``None`` if outside the national plan."""
    try:
        return _lookup(STATE_RANGES, int(postcode))
    except (TypeError, ValueError):
        return None


def row_for(code: int) -> dict[str, str]:
    """Build one ``postcode_zone`` row."""
    postcode = f"{code:05d}"
    state = _lookup(STATE_RANGES, code) or ""
    city = _lookup(CITY_RANGES, code) or state
    hub_route = _lookup_hub(code)
    if hub_route:
        hub_code, route_code = hub_route
    else:
        hub_code = fallback_hub_code(postcode, state)
        route_code = fallback_route_code(postcode)
    return {
        "postcode": postcode,
        "state": state,
        "city": city,
        "zone_code": postcode[1:4],
        "hub_code": hub_code,
        "dp_code": DP_OVERRIDES.get(postcode, fallback_dp_code(postcode)),
        "route_code": route_code,
    }


def iter_rows() -> Iterator[dict[str, str]]:
    """Yield every seeded ``postcode_zone`` row, ascending."""
    for lo, hi, _state in STATE_RANGES:
        for code in range(lo, hi + 1):
            yield row_for(code)


def total_rows() -> int:
    return sum(hi - lo + 1 for lo, hi, _ in STATE_RANGES)
