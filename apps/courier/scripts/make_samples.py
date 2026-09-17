"""Regenerate the sample CSVs from the real production header set.

    python scripts/make_samples.py

Writes:
    backend/samples/bulk_orders_template.csv   headers + 3 fictional example rows
    backend/samples/bulk_orders_500.csv        500-row load fixture
    backend/samples/bulk_orders_broken.csv     490 good + 10 deliberately bad

The header row is taken verbatim from :data:`app.csv_engine.schema.CANONICAL`,
which was itself derived from the user's real ``bulk_orders.csv`` - so the
template always matches the contract the parser enforces.
"""
from __future__ import annotations

import csv
import random
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND))

from app.csv_engine.schema import CANONICAL  # noqa: E402

SAMPLES = BACKEND / "samples"

# Example rows for the template - fictional customers, never real ones: the
# template is downloaded from the portal and this repository is public.
# ``source`` and ``dropship`` are optional extras the parser also reads.
TEMPLATE_COLUMNS = [*CANONICAL, "source", "dropship"]
TEMPLATE_ROWS: list[dict[str, str]] = [
    {
        "order_no": "10001", "receiver_name": "Nur Aisyah Rahman",
        "receiver_phone": "0123001101", "receiver_postcode": "47301",
        "receiver_city": "Petaling Jaya", "receiver_state": "Selangor",
        "receiver_address": "No. 8, Jalan SS 21/35, Damansara Utama",
        "address_type": "HOME",
        "goods_name": "Pearl Hand Embellished 3 Piece Suit", "item_variant": "",
        "quantity": "1", "actual_weight": "1.2",
        "length": "0", "width": "0", "height": "0",
        "payment_type": "PREPAID", "cod_amount": "0", "order_value": "119",
        "remark": "Paid Order", "source": "Website", "dropship": "no",
    },
    {
        "order_no": "10002", "receiver_name": "Tan Mei Ling",
        "receiver_phone": "0163001102", "receiver_postcode": "11950",
        "receiver_city": "Bayan Lepas", "receiver_state": "Penang",
        "receiver_address": "Block B-3-2, Persiaran Bayan Indah, Bayan Baru",
        "address_type": "HOME",
        "goods_name": "Pure Chiffon Bandhani Gown", "item_variant": "",
        "quantity": "1", "actual_weight": "0.8",
        "length": "0", "width": "0", "height": "0",
        "payment_type": "COD", "cod_amount": "78", "order_value": "78",
        "remark": "COD collect on delivery", "source": "Instagram", "dropship": "no",
    },
    {
        "order_no": "10003", "receiver_name": "Priya Devi Muthu",
        "receiver_phone": "0173001103", "receiver_postcode": "11900",
        "receiver_city": "Bayan Lepas", "receiver_state": "Penang",
        "receiver_address": "Level 2, Persiaran Bayan Lepas Technoplex, Phase 4",
        "address_type": "OFFICE",
        "goods_name": "Heavy Embroidery Gharara 3Pcs Suit Collection For Women",
        "item_variant": "L",
        "quantity": "1", "actual_weight": "1.5",
        "length": "0", "width": "0", "height": "0",
        "payment_type": "COD", "cod_amount": "273", "order_value": "273",
        "remark": "COD collect on delivery", "source": "Daraz", "dropship": "yes",
    },
]

FIRST_NAMES = [
    "Nurul", "Siti", "Ahmad", "Muhammad", "Aina", "Farah", "Emily", "Kavitha",
    "Nalini", "Menaga", "Anne", "Wanie", "Elizabeth", "Kirendeep", "Priya",
    "Chong", "Tan", "Lim", "Wong", "Raj", "Suresh", "Hafiz", "Zulkifli",
]
LAST_NAMES = [
    "Sinnasamy", "Sabapathie", "Subramaniam", "Abdullah", "Ismail", "Rahman",
    "Lim", "Tan", "Wong", "Kaur", "Selvi", "Duim", "Ng", "Raj", "Gunasengaran",
    "Mohamed", "Yusof", "Chandran", "Balakrishnan", "Hassan",
]
GOODS = [
    "Pearl Hand Embellished 3 Piece Suit",
    "Pure Chiffon Bandhani Gown",
    "Heavy Embroidery Gharara 3Pcs Suit Collection For Women",
    "Flowy A-Line Kurti Palazzo 2Pcs Set For Women 002",
    "Embroidered Maxi Chic",
    "Heavy Pure Viscose Dola Silk with Embroidery Work - 3-piece suit",
    "Rayon Embroidered Kurti with Plazzo 2 Pcs Dress",
    "Plazzo And Duppata Set Fully Stitched Ready to Wear",
    "Designer Anarkali Kurta Pant and Dupatta 3Pcs Set For Women",
    "Chiffon Georgette Party Set with Farshi Palazzo",
]
VARIANTS = ["", "S", "M", "L", "XL", "XXL"]
# (postcode, city, state) - all inside the seeded national plan
DESTINATIONS = [
    ("47810", "Petaling Jaya", "Selangor"),
    ("43000", "Kajang", "Selangor"),
    ("43200", "Cheras", "Selangor"),
    ("40170", "Shah Alam", "Selangor"),
    ("41100", "Klang", "Selangor"),
    ("11950", "Bayan Lepas", "Penang"),
    ("11900", "Bayan Lepas", "Penang"),
    ("10050", "George Town", "Penang"),
    ("31350", "Kinta", "Perak"),
    ("30010", "Ipoh", "Perak"),
    ("81750", "Masai", "Johor"),
    ("80100", "Johor Bahru", "Johor"),
    ("94300", "Kota Samarahan", "Sarawak"),
    ("88000", "Kota Kinabalu", "Sabah"),
    ("50450", "Kuala Lumpur", "Kuala Lumpur"),
    ("70100", "Seremban", "Negeri Sembilan"),
    ("75300", "Melaka", "Melaka"),
    ("25200", "Kuantan", "Pahang"),
]
STREETS = [
    "No. {n}, Jalan Mangga, Off Jalan Dato Dollah",
    "{n}, Lorong 22E8A, Taman Desa Ilmu",
    "No {n}, Jalan Ara 4, Taman Rinting",
    "A{n}K Langat Jaya Condo, Jalan Dato Alias",
    "No. {n}, Lang Damai 3, Desa Lang Damai",
    "Lot {n}, Persiaran Mahsuri 1, Bandar Baru",
    "{n}-15-16 The Promenade Condominium, Barat Daya",
    "No. {n}-1, Jalan PJU 5/21, The Strand, Kota Damansara",
]


def _row(index: int, rng: random.Random) -> dict[str, str]:
    postcode, city, state = rng.choice(DESTINATIONS)
    cod = rng.random() < 0.45
    value = round(rng.uniform(45, 320), 2)
    return {
        "order_no": str(20000 + index),
        "receiver_name": f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}",
        "receiver_phone": f"01{rng.randint(1, 9)}{rng.randint(1000000, 9999999)}",
        "receiver_postcode": postcode,
        "receiver_city": city,
        "receiver_state": state,
        "receiver_address": rng.choice(STREETS).format(n=rng.randint(1, 240)),
        "address_type": "OFFICE" if rng.random() < 0.12 else "HOME",
        "goods_name": rng.choice(GOODS),
        "item_variant": rng.choice(VARIANTS),
        "quantity": "1",
        "actual_weight": f"{rng.uniform(0.3, 3.0):.1f}",
        "length": "0", "width": "0", "height": "0",
        "payment_type": "COD" if cod else "PREPAID",
        "cod_amount": f"{value:.2f}" if cod else "0",
        "order_value": f"{value:.2f}",
        "remark": "COD collect on delivery" if cod else "Paid Order",
    }


def write(path: Path, rows: list[dict[str, str]], columns: list[str] | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=columns or list(CANONICAL))
        writer.writeheader()
        writer.writerows(rows)
    print(f"  wrote {path.name:30s} {len(rows):4d} rows")


def main() -> None:
    rng = random.Random(20260915)          # deterministic fixtures

    write(SAMPLES / "bulk_orders_template.csv", TEMPLATE_ROWS, TEMPLATE_COLUMNS)

    bulk = [_row(i, rng) for i in range(500)]
    write(SAMPLES / "bulk_orders_500.csv", bulk)

    # 490 good + 10 deliberately broken, for acceptance criterion 9
    broken = [_row(i, rng) for i in range(490)]
    for i, row in enumerate(broken):
        row["order_no"] = str(30000 + i)
    faults: list[tuple[str, str]] = [
        ("receiver_postcode", "478"),          # too short
        ("receiver_postcode", "04000"),        # not in the national plan
        ("receiver_phone", "0225064173"),      # not a mobile prefix
        ("receiver_phone", ""),                # missing
        ("actual_weight", ""),                 # missing
        ("actual_weight", "45"),               # over 30 kg
        ("receiver_name", ""),                 # empty receiver
        ("receiver_address", "ab"),            # too short
        ("address_type", "CASTLE"),            # not HOME/OFFICE
        ("quantity", "0"),                     # below 1
    ]
    for i, (field_name, value) in enumerate(faults):
        row = _row(900 + i, rng)
        row["order_no"] = str(39000 + i)
        row[field_name] = value
        if field_name == "actual_weight" and value == "":
            row["payment_type"] = "PREPAID"
        broken.insert(i * 49 + 3, row)
    write(SAMPLES / "bulk_orders_broken.csv", broken)


if __name__ == "__main__":
    main()
