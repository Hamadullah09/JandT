"""Where orders came from (app/core/sources.py)."""
from __future__ import annotations

import pytest

from app.api.schemas import NormalOrderIn
from app.api.v1.orders import _payload
from app.core.sources import DEFAULT_SOURCE, SOURCES, normalise_source, ordered
from app.csv_engine.parser import parse_csv


class TestNames:
    @pytest.mark.parametrize(
        ("typed", "source"),
        [
            ("", "Website"),
            (None, "Website"),
            ("website", "Website"),
            ("  DARAZ ", "Daraz"),
            ("daraz.pk", "Daraz"),
            ("Amazon UK", "Amazon"),
            ("ebay", "eBay"),
            ("fb", "Facebook"),
            ("insta", "Instagram"),
            ("TikTok", "TikTok Shop"),
            ("whats app", "WhatsApp"),
            ("Shopee MY", "Shopee"),
            ("others", "Other"),
        ],
    )
    def test_common_spellings_become_one_source(self, typed, source):
        assert normalise_source(typed) == source

    def test_a_new_marketplace_is_kept_as_written(self):
        assert normalise_source("Carousell") == "Carousell"
        assert normalise_source("  Mudah   my ") == "Mudah my"
        assert len(normalise_source("x" * 80)) == 32

    def test_known_sources_first_then_others_a_to_z(self):
        names = ordered({"Zalora", "Daraz", "carousell"})
        assert names[: len(SOURCES)] == [source.name for source in SOURCES]
        assert names[len(SOURCES):] == ["carousell", "Zalora"]

    def test_website_is_the_default(self):
        assert DEFAULT_SOURCE == "Website" and SOURCES[0].name == "Website"


HEADER = "order_no,receiver_name,receiver_phone,receiver_postcode,receiver_address,goods_name,quantity,actual_weight"
FIRST = '12820,Tan Mei Ling,0123456789,47810,"No. 1, Jalan Contoh 1",Kurti,1,0.8'


class TestCsv:
    @pytest.mark.parametrize("column", ["source", "Source", "Channel", "Sales Channel", "marketplace", "platform"])
    def test_the_column_is_found_by_its_usual_names(self, column):
        parsed = parse_csv(f"{HEADER},{column}\n{FIRST},daraz.pk".encode())
        assert parsed.rows[0].data["source"] == "Daraz"

    def test_without_the_column_orders_are_from_the_website(self):
        parsed = parse_csv(f"{HEADER}\n{FIRST}".encode())
        assert parsed.rows[0].data["source"] == "Website"

    def test_rows_of_one_order_may_spell_the_source_differently(self):
        parsed = parse_csv(
            f"{HEADER},source\n{FIRST},daraz.pk\n12820,,,,,Gown,1,,Daraz\n12820,,,,,Scarf,1,,".encode()
        )
        row = parsed.rows[0]
        assert (row.status, row.data["source"]) == ("ok", "Daraz")

    def test_rows_of_one_order_from_two_sources_are_a_mistake(self):
        parsed = parse_csv(f"{HEADER},source\n{FIRST},Daraz\n12820,,,,,Gown,1,,Amazon".encode())
        assert parsed.rows[0].status == "error" and parsed.rows[0].error_field == "source"


class TestNormalOrder:
    BASE = dict(
        receiver_name="Nur Aisyah Rahman", receiver_phone="0171234567",
        receiver_postcode="47100", receiver_address="12 Jalan Contoh 3, Taman Contoh",
        goods_name="Kurti", actual_weight="0.8", customer_order_no="12820",
    )

    def test_the_form_defaults_to_website(self):
        assert _payload(NormalOrderIn(**self.BASE))["source"] == "Website"

    def test_the_chosen_source_is_tidied(self):
        assert _payload(NormalOrderIn(**self.BASE, source="amazon"))["source"] == "Amazon"
