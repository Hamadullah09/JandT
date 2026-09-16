"""Several items per order: the item list, CSV merging, the label, packing PDFs."""
from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest
from pydantic import ValidationError
from pypdf import PdfReader

from app.api.schemas import NormalOrderIn
from app.core.items import (
    describe,
    is_simple,
    items_of,
    normalise_items,
    order_columns,
    product_key,
)
from app.csv_engine.parser import parse_csv
from app.waybill.packing import MIXED, PackingOrder, group_for_packing, write_packing_pdfs
from app.waybill.renderer import render_waybill
from app.waybill.text import fit_items, width_of
from tests.test_waybill import REFERENCE_ORDER

HEADER = (
    "order_no,receiver_name,receiver_phone,receiver_postcode,receiver_address,"
    "goods_name,item_variant,quantity,actual_weight,image"
)
FIRST = '12820,Tan Mei Ling,0123456789,47810,"No. 1, Jalan Contoh 1",'


def csv(*rows: str) -> bytes:
    return "\n".join([HEADER, *rows]).encode("utf-8")


def item(name: str, variant: str = "", quantity: int = 1) -> dict:
    return {"name": name, "variant": variant, "quantity": quantity}


# ------------------------------------------------------------------ item list
class TestItemList:
    def test_repeats_of_the_same_product_and_variant_add_up(self):
        merged = normalise_items(
            [item("Maxi Chic", "L"), item("maxi  chic", "l", 2), item("Maxi Chic", "M")]
        )
        assert merged == [item("Maxi Chic", "L", 3), item("Maxi Chic", "M")]

    def test_csv_field_names_are_accepted_and_nameless_lines_dropped(self):
        assert normalise_items(
            [{"goods_name": " Gown ", "item_variant": "Red", "quantity": "2"}, {"goods_name": ""}]
        ) == [item("Gown", "Red", 2)]

    def test_orders_saved_before_items_existed_still_have_one(self):
        old = {"goods_name": "Gown", "item_variant": "M", "quantity": 2}
        assert items_of(old) == [item("Gown", "M", 2)]

    def test_description_is_comma_separated_with_quantities(self):
        items = [item("Maxi Chic", "Purple / L", 2), item("Gown", "Red / M")]
        assert describe(items) == "Maxi Chic x2, Gown"
        assert describe(items, variants=True) == "Maxi Chic -  Purple / L x2, Gown -  Red / M"

    def test_one_product_in_two_sizes_counts_together_when_sizes_are_hidden(self):
        items = [item("Maxi Chic", "Purple / S"), item("Maxi Chic", "Purple / L")]
        assert describe(items) == "Maxi Chic x2"
        assert describe(items, variants=True) == "Maxi Chic -  Purple / S, Maxi Chic -  Purple / L"
        assert order_columns(items)["goods_name"] == "Maxi Chic x2"

    def test_one_item_keeps_the_old_columns(self):
        assert order_columns([item("Gown", "M", 2)]) == {
            "goods_name": "Gown", "item_variant": "M", "quantity": 2
        }

    def test_several_items_describe_the_parcel_and_total_the_pieces(self):
        assert order_columns([item("Maxi", "L", 2), item("Gown")]) == {
            "goods_name": "Maxi x2, Gown", "item_variant": "", "quantity": 3
        }

    def test_only_one_piece_of_one_item_is_simple(self):
        assert is_simple([item("Gown")])
        assert not is_simple([item("Gown", quantity=2)])
        assert not is_simple([item("Gown"), item("Maxi")])

    def test_sizes_do_not_split_a_product_but_other_products_do(self):
        assert product_key([item("Maxi Chic", "L"), item("maxi chic", "M")]) == "maxi chic"
        assert product_key([item("Maxi Chic"), item("Gown")]) is None


# ------------------------------------------------------------------ csv rows
class TestCsvRowsShareAnOrder:
    def test_rows_with_one_order_number_become_one_order(self):
        parsed = parse_csv(csv(
            FIRST + "Maxi Chic,Purple / L,2,1.2,",
            "12820,,,,,Chiffon Gown,Red / M,1,,",
        ))
        assert (parsed.line_count, parsed.total) == (2, 1)
        order = parsed.rows[0]
        assert order.status == "ok" and order.rows == [1, 2]
        assert order.data["items"] == [item("Maxi Chic", "Purple / L", 2), item("Chiffon Gown", "Red / M")]
        assert order.data["goods_name"] == "Maxi Chic x2, Chiffon Gown"
        assert order.data["quantity"] == 3

    def test_the_rows_need_not_be_next_to_each_other(self):
        parsed = parse_csv(csv(
            FIRST + "Maxi Chic,,1,1.2,",
            '12821,Lee Siew Lan,0123456780,41100,"7, Jalan Contoh 2",Kurti,,1,0.8,',
            "12820,,,,,Gown,,1,,",
        ))
        assert [r.rows for r in parsed.rows] == [[1, 3], None]

    def test_order_details_repeated_the_same_way_are_fine(self):
        parsed = parse_csv(csv(
            FIRST + "Maxi Chic,,1,1.2,",
            "12820,Tan Mei Ling,+60 12-345 6789,47810,,Gown,,1,1.2,",
        ))
        assert parsed.rows[0].status == "ok"

    def test_different_order_details_stop_the_order_and_name_the_row(self):
        parsed = parse_csv(csv(FIRST + "Maxi Chic,,1,1.2,", "12820,,,43200,,Gown,,1,,"))
        error = parsed.rows[0]
        assert error.status == "error" and error.error_field == "receiver_postcode"
        assert error.error_message.startswith("row 2: receiver_postcode differs from row 1")
        assert "order 12820 (rows 1, 2) was not created" in error.error_message

    def test_a_bad_item_row_stops_the_whole_order(self):
        parsed = parse_csv(csv(FIRST + "Maxi Chic,,1,1.2,", "12820,,,,,Gown,,0,,"))
        assert parsed.rows[0].status == "error"
        assert parsed.rows[0].error_message.startswith("row 2: quantity must be 1 or more")

    def test_an_item_row_must_name_its_product(self):
        parsed = parse_csv(csv(FIRST + "Maxi Chic,,1,1.2,", "12820,,,,,,,1,,"))
        assert "goods_name is required" in parsed.rows[0].error_message

    def test_each_item_keeps_its_own_photo(self):
        parsed = parse_csv(csv(FIRST + "Maxi Chic,,1,1.2,maxi.jpg", "12820,,,,,Gown,,1,,gown.jpg"))
        assert [i.get("image") for i in parsed.rows[0].data["items"]] == ["maxi.jpg", "gown.jpg"]

    def test_a_variant_too_long_for_the_database_is_one_bad_row(self):
        parsed = parse_csv(csv(FIRST + "Maxi Chic," + "X" * 33 + ",1,1.2,"))
        assert parsed.rows[0].error_field == "item_variant"

    def test_a_single_row_order_is_unchanged(self):
        parsed = parse_csv(csv(FIRST + "Maxi Chic,Purple / L,2,1.2,"))
        assert parsed.rows[0].rows is None
        assert "items" not in parsed.rows[0].data


# ------------------------------------------------------------------ label
class TestItemsOnTheLabel:
    FONT, WIDTH = "Helvetica", 163.0

    def test_a_list_that_fits_is_printed_whole_at_full_size(self):
        assert fit_items(["Maxi Chic x2", "Gown"], self.FONT, 7.0, 5.0, self.WIDTH) == (
            "Maxi Chic x2, Gown", 7.0
        )

    def test_a_long_list_shrinks_before_anything_is_hidden(self):
        parts = ["Embroidered Maxi Chic x2", "Pure Chiffon Bandhani Gown"]
        text, size = fit_items(parts, self.FONT, 7.0, 5.0, self.WIDTH)
        assert text == "Embroidered Maxi Chic x2, Pure Chiffon Bandhani Gown"
        assert 5.0 <= size < 7.0 and width_of(text, self.FONT, size) <= self.WIDTH

    def test_what_cannot_fit_is_counted_never_silently_dropped(self):
        parts = [f"Heavy Embroidery Gharara Suit {n}" for n in range(6)]
        text, size = fit_items(parts, self.FONT, 7.0, 5.0, self.WIDTH)
        shown = text.count("Gharara")
        assert text.endswith(f"+{6 - shown} more") and size == 5.0
        assert width_of(text, self.FONT, size) <= self.WIDTH

    def test_a_multi_item_waybill_lists_every_item(self, tmp_path):
        items = [item("Embroidered Maxi Chic", "Purple / L", 2), item("Pure Chiffon Gown", "Red / M")]
        path = tmp_path / "multi.pdf"
        render_waybill(replace(REFERENCE_ORDER, items=items), path)
        text = PdfReader(str(path)).pages[0].extract_text()
        assert "Embroidered Maxi Chic x2, Pure Chiffon Gown" in text           # dispatcher copy
        assert "Embroidered Maxi Chic -  Purple / L x2, Pure Chiffon Gown -  Red / M" in text

    def test_a_single_piece_order_renders_byte_for_byte_as_before(self, tmp_path):
        before, after = tmp_path / "before.pdf", tmp_path / "after.pdf"
        render_waybill(REFERENCE_ORDER, before)
        only = [item(REFERENCE_ORDER.goods_name, REFERENCE_ORDER.item_variant)]
        render_waybill(replace(REFERENCE_ORDER, items=only), after)
        assert before.read_bytes() == after.read_bytes()


# ------------------------------------------------------------------ packing
class TestPackingPdfs:
    def order(self, no: int, items: list[dict], label: Path | None) -> PackingOrder:
        return PackingOrder(
            order_no=str(no), tracking_no=f"63{no}", items=items,
            waybill_path=str(label) if label else None, sequence=no,
        )

    def test_products_a_to_z_sizes_together_and_mixed_parcels_last(self):
        groups = group_for_packing([
            self.order(1, [item("Maxi Chic", "M")], None),
            self.order(2, [item("Gown")], None),
            self.order(3, [item("Maxi Chic", "L")], None),
            self.order(4, [item("Maxi Chic"), item("Gown")], None),
            self.order(5, [item("maxi chic", "M")], None),
        ])
        assert [(title, [o.order_no for o in members]) for title, members in groups] == [
            ("Gown", ["2"]),
            ("Maxi Chic", ["3", "1", "5"]),
            (MIXED, ["4"]),
        ]

    @pytest.fixture
    def labels(self, tmp_path):
        paths = []
        for n in range(4):
            path = tmp_path / f"OrderNo_{n}.pdf"
            render_waybill(replace(REFERENCE_ORDER, tracking_no=f"63215857{n:04d}"), path)
            paths.append(path)
        return paths

    def test_one_pdf_per_product_holding_exactly_its_labels(self, tmp_path, labels):
        files = write_packing_pdfs(
            [
                self.order(0, [item("Maxi / Chic", quantity=2)], labels[0]),
                self.order(1, [item("Maxi / Chic")], labels[1]),
                self.order(2, [item("Gown"), item("Maxi / Chic")], labels[2]),
            ],
            tmp_path / "packing",
        )
        assert [(f.path.name, f.orders, f.pieces) for f in files] == [
            ("Maxi Chic - 2 orders.pdf", 2, 3),
            ("Mixed items - 1 order.pdf", 1, 2),
        ]
        assert len(PdfReader(str(files[0].path)).pages) == 2

    def test_running_again_replaces_its_own_files_only(self, tmp_path, labels):
        folder = tmp_path / "packing"
        folder.mkdir()
        (folder / "my notes.pdf").write_bytes(b"%PDF")
        write_packing_pdfs([self.order(0, [item("Gown")], labels[0])], folder)
        write_packing_pdfs(
            [self.order(0, [item("Gown")], labels[0]), self.order(1, [item("Gown")], labels[1])],
            folder,
        )
        assert sorted(p.name for p in folder.iterdir()) == ["Gown - 2 orders.pdf", "my notes.pdf"]

    def test_a_deleted_label_is_rendered_again_instead_of_dropped(self, tmp_path, labels):
        replacement = labels[3]
        files = write_packing_pdfs(
            [self.order(0, [item("Gown")], tmp_path / "deleted.pdf")],
            tmp_path / "packing",
            render_missing=lambda order: replacement,
        )
        assert files[0].orders == 1


# ------------------------------------------------------------------ api
class TestNormalOrderItems:
    BASE = dict(
        receiver_name="Tan Mei Ling", receiver_phone="0123456789", receiver_postcode="47810",
        receiver_address="No. 1, Jalan Contoh 1", goods_name="Maxi Chic", actual_weight="1.2",
        customer_order_no="12820",
    )

    def test_items_are_optional(self):
        assert NormalOrderIn(**self.BASE).items == []

    def test_every_item_is_validated(self):
        with pytest.raises(ValidationError):
            NormalOrderIn(**self.BASE, items=[{"goods_name": "Gown", "quantity": 0}])
        with pytest.raises(ValidationError):
            NormalOrderIn(**self.BASE, item_variant="X" * 33)
