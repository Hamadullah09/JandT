"""Unit tests for tracking, sortation, masking and weight maths.

The expected values come from the reference waybill ``OrderNo_12808.pdf``
wherever it pins one down.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.core.masking import mask
from app.core.naming import sanitise_stem, unique_path, waybill_filename
from app.core.phone import PhoneError, normalise_my_mobile
from app.core.pricing import freight_fee
from app.core.sortation import (
    build_sortation_code,
    primary_state,
    service_scope,
    state_abbr,
    zone_code,
)
from app.core.tracking import TRACKING_LEN, TrackingError, format_tracking, random_tracking
from app.core.weights import ceil_to_tenth, chargeable_weight, volumetric_weight


# ---------------------------------------------------------------- tracking
class TestTracking:
    def test_reference_number(self):
        # OrderNo_12808.pdf carries 632158571544
        assert format_tracking(2_158_571_544, "63") == "632158571544"

    def test_always_twelve_digits(self):
        for value in (0, 1, 999, 2_158_571_544, 9_999_999_999):
            number = format_tracking(value, "63")
            assert len(number) == TRACKING_LEN
            assert number.isdigit()
            assert number.startswith("63")

    def test_zero_padding(self):
        assert format_tracking(7, "63") == "630000000007"

    def test_overflow_is_loud(self):
        with pytest.raises(TrackingError):
            format_tracking(10_000_000_000, "63")

    def test_negative_is_loud(self):
        with pytest.raises(TrackingError):
            format_tracking(-1, "63")

    def test_random_mode_shape(self):
        for _ in range(50):
            number = random_tracking("63")
            assert len(number) == TRACKING_LEN and number.isdigit()
            assert number.startswith("63")


# --------------------------------------------------------------- sortation
class TestSortation:
    def test_reference_sortation_code(self):
        # 43000 Kajang -> 300-K41-SG496 on the reference label
        assert build_sortation_code("43000", "K41", "Selangor", "496") == "300-K41-SG496"

    def test_zone_code_is_digits_two_to_four(self):
        assert zone_code("43000") == "300"
        assert zone_code("11950") == "195"

    @pytest.mark.parametrize("bad", ["4300", "430000", "abcde", ""])
    def test_zone_code_rejects_bad_postcodes(self, bad):
        with pytest.raises(ValueError):
            zone_code(bad)

    def test_state_abbreviations(self):
        assert state_abbr("SELANGOR/PETALING/SERI KEMBANGAN") == "SG"
        assert state_abbr("Penang") == "PG"
        assert state_abbr("Sarawak") == "SW"
        assert state_abbr("Kuala Lumpur") == "KL"

    def test_primary_state_takes_the_first_segment(self):
        assert primary_state("SELANGOR/PETALING/SERI KEMBANGAN") == "SELANGOR"
        assert primary_state("Johor") == "JOHOR"
        assert primary_state(None) == ""

    def test_service_scope_matches_the_reference(self):
        # sender 43300 Selangor -> receiver 43000 Selangor is stamped SAME CITY
        assert service_scope("SELANGOR/PETALING/SERI KEMBANGAN", "Selangor") == "SAME CITY"

    @pytest.mark.parametrize(
        ("receiver", "expected"),
        [
            ("Selangor", "SAME CITY"),
            ("Kuala Lumpur", "SAME CITY"),
            ("Penang", "WEST"),
            ("Johor", "WEST"),
            ("Sabah", "EAST"),
            ("Sarawak", "EAST"),
            ("Labuan", "EAST"),
        ],
    )
    def test_service_scope_table(self, receiver, expected):
        assert service_scope("SELANGOR", receiver) == expected


# ----------------------------------------------------------------- masking
class TestMasking:
    def test_reference_masks(self):
        assert mask("+60 135763706") == "******06"     # sender on the reference
        assert mask("+60 123456794") == "******94"     # receiver on the reference

    def test_always_six_stars_plus_two_digits(self):
        assert mask("0125064173") == "******73"
        assert len(mask("0125064173")) == 8

    def test_short_and_empty_inputs_do_not_raise(self):
        assert mask("7") == "*******7"
        assert mask("") == "********"
        assert mask(None) == "********"


# ------------------------------------------------------------------- phone
class TestPhone:
    @pytest.mark.parametrize(
        "raw",
        ["0125064173", "60125064173", "+60125064173", "+60 12-506 4173", "012-5064173"],
    )
    def test_accepts_every_common_spelling(self, raw):
        assert normalise_my_mobile(raw) == "+60 125064173"

    @pytest.mark.parametrize("raw", ["0225064173", "", None, "12345", "0125"])
    def test_rejects_non_mobiles(self, raw):
        with pytest.raises(PhoneError):
            normalise_my_mobile(raw)


# ----------------------------------------------------------------- weights
class TestWeights:
    def test_volumetric_divides_by_6000(self):
        assert volumetric_weight(30, 20, 10) == Decimal("1.00")
        assert volumetric_weight(40, 30, 20) == Decimal("4.00")

    def test_zero_dimensions(self):
        assert volumetric_weight(0, 0, 0) == Decimal("0.00")

    def test_ceil_to_tenth(self):
        assert ceil_to_tenth(Decimal("0.80")) == Decimal("0.8")
        assert ceil_to_tenth(Decimal("0.81")) == Decimal("0.9")
        assert ceil_to_tenth(Decimal("0.55")) == Decimal("0.6")
        assert ceil_to_tenth(Decimal("1.00")) == Decimal("1.0")

    def test_chargeable_is_the_greater_of_the_two(self):
        assert chargeable_weight("0.6", 0, 0, 0) == Decimal("0.6")
        assert chargeable_weight("1.2", 40, 30, 20) == Decimal("4.0")
        assert chargeable_weight("5.0", 10, 10, 10) == Decimal("5.0")


# ----------------------------------------------------------------- pricing
#: A fixed rate card, so these formula tests do not break whenever the real
#: prices in config/rates.yml are edited (that file says "edit freely").
TEST_RATES = {
    "zones": {
        "SAME CITY": {"first_kg": 5.30, "extra_kg": 1.50},
        "WEST": {"first_kg": 7.50, "extra_kg": 2.00},
        "EAST": {"first_kg": 11.00, "extra_kg": 5.50},
    },
    "default_zone": "WEST",
    "surcharges": {"cod_percent": 2.0, "cod_min": 1.00, "document_flat": 4.50},
}


class TestPricing:
    @pytest.fixture(autouse=True)
    def fixed_rates(self, monkeypatch):
        from app.core import pricing

        monkeypatch.setattr(pricing, "get_rates", lambda: TEST_RATES)

    def test_first_kilogram(self):
        assert freight_fee("SAME CITY", Decimal("0.6")) == Decimal("5.30")
        assert freight_fee("SAME CITY", Decimal("1.0")) == Decimal("5.30")

    def test_started_extra_kilograms(self):
        assert freight_fee("SAME CITY", Decimal("1.1")) == Decimal("6.80")
        assert freight_fee("SAME CITY", Decimal("2.0")) == Decimal("6.80")
        assert freight_fee("SAME CITY", Decimal("2.1")) == Decimal("8.30")

    def test_zones_differ(self):
        weight = Decimal("1.0")
        assert freight_fee("SAME CITY", weight) < freight_fee("WEST", weight)
        assert freight_fee("WEST", weight) < freight_fee("EAST", weight)

    def test_cod_surcharge(self):
        base = freight_fee("WEST", Decimal("1.0"))
        with_cod = freight_fee("WEST", Decimal("1.0"), cod_amount=Decimal("100"))
        assert with_cod == base + Decimal("2.00")

    def test_unknown_zone_falls_back_instead_of_raising(self):
        assert freight_fee("MOON", Decimal("1.0")) == freight_fee("WEST", Decimal("1.0"))


# ------------------------------------------------------------------ naming
class TestNaming:
    def test_reference_filename(self):
        assert waybill_filename("12808", "632158571544") == "OrderNo_12808.pdf"

    def test_falls_back_to_the_tracking_number(self):
        assert waybill_filename("", "632158571544") == "632158571544.pdf"
        assert waybill_filename(None, "632158571544") == "632158571544.pdf"

    @pytest.mark.parametrize("bad", ['a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b'])
    def test_illegal_characters_are_stripped(self, bad):
        assert sanitise_stem(bad) == "ab"

    def test_whitespace_is_collapsed_and_capped(self):
        assert sanitise_stem("  a   b  ") == "a b"
        assert len(sanitise_stem("x" * 400)) == 100

    def test_windows_reserved_names_are_escaped(self):
        assert sanitise_stem("CON") == "_CON"
        assert sanitise_stem("lpt1") == "_lpt1"

    def test_collisions_never_overwrite(self, tmp_path):
        first = unique_path(tmp_path, "OrderNo_1.pdf")
        first.write_bytes(b"x")
        second = unique_path(tmp_path, "OrderNo_1.pdf")
        assert second.name == "OrderNo_1_1.pdf"

    def test_in_memory_reservation_prevents_same_run_collisions(self, tmp_path):
        taken: set[str] = set()
        names = [unique_path(tmp_path, "OrderNo_9.pdf", taken).name for _ in range(3)]
        assert names == ["OrderNo_9.pdf", "OrderNo_9_1.pdf", "OrderNo_9_2.pdf"]
