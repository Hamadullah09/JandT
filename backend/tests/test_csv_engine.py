"""CSV contract, header aliasing and per-row validation."""
from __future__ import annotations

from pathlib import Path

import pytest

from app.csv_engine.parser import parse_csv
from app.csv_engine.schema import CANONICAL, REQUIRED, map_headers, normalise_header

SAMPLES = Path(__file__).resolve().parent.parent / "samples"
TEMPLATE = SAMPLES / "bulk_orders_template.csv"
BROKEN = SAMPLES / "bulk_orders_broken.csv"

HEADER = ",".join(CANONICAL)
GOOD_ROW = (
    "12809,Emily Lim,0125064173,47810,Petaling Jaya,Selangor,"
    '"No. 43-1, Jalan PJU 5/21, Kota Damansara",HOME,'
    "Pearl Hand Embellished 3 Piece Suit,,1,1.2,0,0,0,PREPAID,0,119,Paid Order"
)


def csv_bytes(*rows: str, header: str = HEADER) -> bytes:
    return ("\n".join([header, *rows])).encode("utf-8")


# ------------------------------------------------------------------ headers
class TestHeaderMapping:
    def test_normalisation_is_case_and_separator_insensitive(self):
        for spelling in ["Receiver Name", "receiver_name", "RECEIVER NAME", " Receiver-Name "]:
            assert normalise_header(spelling) == "receivername"

    def test_the_real_production_headers_all_map(self):
        mapping = map_headers(list(CANONICAL))
        assert mapping.ok
        assert not mapping.unknown
        assert set(mapping.columns.values()) == set(CANONICAL)

    def test_alias_map_accepts_other_spellings(self):
        mapping = map_headers(
            [
                "Order Number", "Recipient Name", "Contact Number", "Postal Code",
                "Town", "State", "Delivery Address", "Address Type", "Product Name",
                "Size", "Qty", "Weight (kg)", "Length", "Width", "Height",
                "Payment Method", "COD", "Value", "Notes",
            ]
        )
        assert mapping.ok, mapping.missing_required
        assert set(mapping.columns.values()) >= REQUIRED

    def test_sender_columns_are_ignored_with_a_warning(self):
        mapping = map_headers([*CANONICAL, "Sender Name", "Deliverer Postcode"])
        assert mapping.ok
        assert mapping.ignored_sender == ["Sender Name", "Deliverer Postcode"]
        assert any("Sender columns are ignored" in w for w in mapping.warnings)
        assert "sender_name" not in mapping.columns.values()

    def test_unknown_columns_are_reported_not_fatal(self):
        mapping = map_headers([*CANONICAL, "Favourite Colour"])
        assert mapping.ok
        assert mapping.unknown == ["Favourite Colour"]

    def test_missing_required_columns_are_listed(self):
        mapping = map_headers([c for c in CANONICAL if c != "receiver_phone"])
        assert not mapping.ok
        assert mapping.missing_required == ["receiver_phone"]


# ------------------------------------------------------------------ parsing
class TestParsing:
    def test_template_parses_cleanly(self):
        result = parse_csv(TEMPLATE, TEMPLATE.name)
        assert result.fatal is None
        assert result.total == 3
        assert len(result.ok_rows) == 3

    def test_utf8_bom_is_tolerated(self):
        raw = b"\xef\xbb\xbf" + csv_bytes(GOOD_ROW)
        result = parse_csv(raw, "bom.csv")
        assert result.fatal is None
        assert len(result.ok_rows) == 1

    def test_phone_is_normalised(self):
        row = parse_csv(csv_bytes(GOOD_ROW), "x.csv").ok_rows[0]
        assert row.data["receiver_phone"] == "+60 125064173"

    def test_raw_cells_are_preserved_for_the_grid(self):
        row = parse_csv(csv_bytes(GOOD_ROW), "x.csv").ok_rows[0]
        assert row.raw["receiver_phone"] == "0125064173"

    def test_missing_required_column_is_fatal(self):
        header = ",".join(c for c in CANONICAL if c != "actual_weight")
        result = parse_csv(csv_bytes("a,b", header=header), "x.csv")
        assert result.fatal and "actual_weight" in result.fatal

    def test_header_only_file_is_fatal(self):
        result = parse_csv(HEADER.encode(), "x.csv")
        assert result.fatal and "no data rows" in result.fatal

    def test_unreadable_input_is_fatal_not_an_exception(self):
        result = parse_csv(Path("does-not-exist.csv"), "nope.csv")
        assert result.fatal and "Could not read" in result.fatal


# --------------------------------------------------------------- validation
class TestRowValidation:
    def _one(self, **overrides):
        values = dict(zip(CANONICAL, GOOD_ROW.split(",")))
        # the quoted address column contains commas; rebuild it safely
        values = {
            "order_no": "1", "receiver_name": "Test Person",
            "receiver_phone": "0125064173", "receiver_postcode": "47810",
            "receiver_city": "Petaling Jaya", "receiver_state": "Selangor",
            "receiver_address": "No. 1, Jalan Ujian, Taman Contoh",
            "address_type": "HOME", "goods_name": "Test Item", "item_variant": "",
            "quantity": "1", "actual_weight": "1.2", "length": "0", "width": "0",
            "height": "0", "payment_type": "PREPAID", "cod_amount": "0",
            "order_value": "50", "remark": "",
        }
        values.update(overrides)
        row = ",".join(f'"{values[c]}"' for c in CANONICAL)
        return parse_csv(csv_bytes(row), "x.csv").rows[0]

    def test_a_good_row_passes(self):
        assert self._one().status == "ok"

    @pytest.mark.parametrize(
        ("field", "value"),
        [
            ("receiver_postcode", "478"),
            ("receiver_postcode", "abcde"),
            ("receiver_phone", "0225064173"),
            ("receiver_phone", ""),
            ("receiver_name", ""),
            ("goods_name", ""),
            ("actual_weight", ""),
            ("actual_weight", "0"),
            ("actual_weight", "-1"),
            ("actual_weight", "45"),
            ("receiver_address", "ab"),
            ("address_type", "CASTLE"),
            ("quantity", "0"),
            ("payment_type", "CHEQUE"),
            ("cod_amount", "-5"),
        ],
    )
    def test_bad_values_are_rejected_with_the_right_field(self, field, value):
        row = self._one(**{field: value})
        assert row.status == "error"
        assert row.error_message
        assert field in f"{row.error_field} {row.error_message}"

    def test_cod_requires_an_amount(self):
        row = self._one(payment_type="COD", cod_amount="0")
        assert row.status == "error"
        assert "cod_amount" in (row.error_message or "")

    def test_prepaid_forces_cod_to_zero(self):
        row = self._one(payment_type="PREPAID", cod_amount="99")
        assert row.status == "ok"
        assert row.data["cod_amount"] == "0"

    def test_defaults_are_applied(self):
        row = self._one(address_type="", quantity="", length="", payment_type="")
        assert row.status == "ok"
        assert row.data["address_type"] == "HOME"
        assert row.data["quantity"] == 1
        assert row.data["length"] == "0"
        assert row.data["payment_type"] == "PREPAID"


# ----------------------------------------------------------- batch behaviour
class TestBatchResilience:
    def test_one_bad_row_does_not_abort_the_batch(self):
        result = parse_csv(BROKEN, BROKEN.name)
        assert result.fatal is None
        assert result.total == 500
        assert len(result.ok_rows) == 491      # 9 fail here, 1 fails at enrich
        assert len(result.error_rows) == 9

    def test_every_error_row_names_a_field_and_a_message(self):
        for row in parse_csv(BROKEN, BROKEN.name).error_rows:
            assert row.error_field
            assert row.error_message
            assert row.row_no > 0

    def test_row_numbers_are_sequential_and_one_based(self):
        result = parse_csv(BROKEN, BROKEN.name)
        assert [r.row_no for r in result.rows] == list(range(1, 501))
