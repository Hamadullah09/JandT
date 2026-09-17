"""Drop-shipped items: the flag, which WhatsApp group, and packing.

The merchant's rule: a PAID order whose items are ALL drop-shipped is sent by
the supplier - its WhatsApp messages go to the drop-ship group and its label is
left out of the packing PDFs.  Cash on delivery, in-stock and mixed orders stay
with the shop.
"""
from __future__ import annotations

import json
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path

import pytest
from pypdf import PdfReader

from app.api.schemas import NormalOrderIn, OrderItemIn
from app.api.v1.orders import _payload
from app.config import get_settings
from app.core.items import all_dropship, normalise_items, supplier_ships
from app.csv_engine.parser import parse_csv
from app.notify.whatsapp import (
    ROUTE_DROPSHIP,
    ROUTE_MAIN,
    ServiceStatus,
    build_job,
    queue_orders,
    route_for,
    service_status,
)
from app.waybill.packing import MIXED, PackingOrder, write_packing_pdfs
from app.waybill.renderer import render_waybill
from tests.test_waybill import REFERENCE_ORDER

GOWN = {"name": "Chiffon Gown", "variant": "Red / M", "quantity": 1, "dropship": True}
SUIT = {"name": "Maxi Chic", "variant": "", "quantity": 1, "dropship": True}
KURTI = {"name": "Kurti", "variant": "", "quantity": 1}          # in stock


def order(items: list[dict], payment: str | None) -> dict:
    return {
        "customer_order_no": "12820", "tracking_no": "632158579999", "items": items,
        "order_payment_type": payment, "receiver_name": "Nur Aisyah Rahman",
        "receiver_address": "12 Jalan Contoh 3, Taman Contoh", "receiver_postcode": "47100",
        "receiver_city": "Puchong", "receiver_state": "Selangor",
        "receiver_phone": "+60 171234567",
    }


# ------------------------------------------------------------------ the rule
class TestWhoShipsIt:
    @pytest.mark.parametrize(
        ("items", "payment", "supplier"),
        [
            ([GOWN], "PREPAID", True),            # paid, drop-shipped: the supplier
            ([GOWN, SUIT], "PREPAID", True),      # every item drop-shipped
            ([GOWN], "COD", False),               # cash on delivery stays with the shop
            ([GOWN, KURTI], "PREPAID", False),    # a mix stays with the shop
            ([KURTI], "PREPAID", False),          # in stock
            ([], "PREPAID", False),               # nothing to ship
        ],
    )
    def test_only_paid_orders_of_only_drop_shipped_items(self, items, payment, supplier):
        assert supplier_ships(items, payment) is supplier

    @pytest.mark.parametrize(
        ("items", "payment", "route"),
        [
            ([GOWN], "PREPAID", ROUTE_DROPSHIP),
            ([GOWN, SUIT], "PREPAID", ROUTE_DROPSHIP),
            ([GOWN], "COD", ROUTE_MAIN),
            ([GOWN, KURTI], "PREPAID", ROUTE_MAIN),
            ([KURTI], "PREPAID", ROUTE_MAIN),
        ],
    )
    def test_the_whatsapp_group_follows_the_same_rule(self, items, payment, route):
        assert route_for(order(items, payment)) == route

    def test_no_payment_type_counts_as_paid_like_the_csv_default(self):
        assert supplier_ships([GOWN], None) is True

    def test_an_order_saved_before_the_flag_existed_is_in_stock(self):
        old = {**order([], "PREPAID"), "items": None, "goods_name": "Chiffon Gown",
               "item_variant": "Red / M", "quantity": 1}
        assert route_for(old) == ROUTE_MAIN

    def test_all_dropship_needs_at_least_one_item(self):
        assert all_dropship([]) is False


# ------------------------------------------------------------------ item lines
class TestTheFlagOnItems:
    def test_the_flag_is_kept_and_only_stored_when_set(self):
        stocked = normalise_items([{**KURTI, "dropship": False}])
        assert normalise_items([GOWN]) == [GOWN]
        assert "dropship" not in stocked[0]

    def test_a_drop_shipped_line_never_merges_with_an_in_stock_line(self):
        merged = normalise_items([GOWN, {**GOWN, "dropship": False}, GOWN])
        assert [(i.get("dropship", False), i["quantity"]) for i in merged] == [(True, 2), (False, 1)]


# ------------------------------------------------------------------ csv
HEADER = (
    "order_no,receiver_name,receiver_phone,receiver_postcode,receiver_address,"
    "goods_name,quantity,actual_weight,payment_type,Drop Ship"
)
FIRST = '12820,Tan Mei Ling,0123456789,47810,"No. 1, Jalan Contoh 1",'


def csv(*rows: str, header: str = HEADER) -> bytes:
    return "\n".join([header, *rows]).encode("utf-8")


class TestCsvColumn:
    @pytest.mark.parametrize(
        ("value", "flag"),
        [("yes", True), ("Y", True), ("TRUE", True), ("1", True),
         ("no", False), ("N", False), ("", False), ("0", False)],
    )
    def test_yes_and_no_in_their_usual_spellings(self, value, flag):
        parsed = parse_csv(csv(FIRST + f"Chiffon Gown,1,0.8,PREPAID,{value}"))
        assert parsed.rows[0].status == "ok"
        assert parsed.rows[0].data["dropship"] is flag

    @pytest.mark.parametrize("name", ["dropship", "Dropshipped", "drop_ship"])
    def test_the_column_name_is_forgiving(self, name):
        header = HEADER.replace("Drop Ship", name)
        parsed = parse_csv(csv(FIRST + "Chiffon Gown,1,0.8,PREPAID,yes", header=header))
        assert parsed.rows[0].data["dropship"] is True

    def test_without_the_column_nothing_is_drop_shipped(self):
        header = HEADER.removesuffix(",Drop Ship")
        parsed = parse_csv(csv(FIRST + "Chiffon Gown,1,0.8,PREPAID", header=header))
        assert parsed.rows[0].data["dropship"] is False

    def test_a_typo_is_an_error_not_a_silent_no(self):
        parsed = parse_csv(csv(FIRST + "Chiffon Gown,1,0.8,PREPAID,yse"))
        assert parsed.rows[0].status == "error"
        assert "dropship must be yes or no" in parsed.rows[0].error_message

    def test_rows_of_one_order_may_differ_because_the_flag_is_per_item(self):
        parsed = parse_csv(csv(FIRST + "Chiffon Gown,1,0.8,PREPAID,yes", "12820,,,,,Kurti,1,,,no"))
        row = parsed.rows[0]
        assert row.status == "ok"
        assert [i.get("dropship", False) for i in row.data["items"]] == [True, False]
        assert row.data["dropship"] is False            # not every item

    def test_an_order_of_only_drop_shipped_rows_is_drop_shipped(self):
        parsed = parse_csv(csv(FIRST + "Chiffon Gown,1,0.8,PREPAID,yes", "12820,,,,,Kurti,1,,,y"))
        assert parsed.rows[0].data["dropship"] is True


# ------------------------------------------------------------------ whatsapp
@pytest.fixture
def outbox(tmp_path: Path, monkeypatch) -> Path:
    settings = get_settings()
    folder = tmp_path / "whatsapp" / "outbox"
    monkeypatch.setattr(settings, "whatsapp_outbox_dir", str(folder))
    monkeypatch.setattr(settings, "whatsapp_images_dir", str(tmp_path / "images"))
    return folder


class TestWhatsAppJobs:
    def test_each_job_names_its_group(self, tmp_path):
        paid, _ = build_job(order([GOWN], "PREPAID"), image=None, waybill_path=None,
                            job_id="j1", images_dir=tmp_path)
        cod, _ = build_job(order([GOWN], "COD"), image=None, waybill_path=None,
                           job_id="j2", images_dir=tmp_path)
        assert (paid["route"], cod["route"]) == (ROUTE_DROPSHIP, ROUTE_MAIN)

    def test_the_messages_are_the_same_whichever_group(self, tmp_path):
        paid, _ = build_job(order([GOWN], "PREPAID"), image=None, waybill_path=None,
                            job_id="j1", images_dir=tmp_path)
        stocked, _ = build_job(order([{**GOWN, "dropship": False}], "PREPAID"), image=None,
                               waybill_path=None, job_id="j1", images_dir=tmp_path)
        assert paid["messages"] == stocked["messages"]

    def test_the_queue_counts_what_goes_to_the_drop_ship_group(self, outbox):
        result = queue_orders([
            (order([GOWN], "PREPAID"), None, None),
            (order([GOWN], "COD"), None, None),
            (order([GOWN, KURTI], "PREPAID"), None, None),
        ])
        assert (result.queued, result.to_dropship) == (3, 1)
        jobs = [json.loads(p.read_text(encoding="utf-8")) for p in sorted(outbox.glob("*.json"))]
        assert [job["route"] for job in jobs] == [ROUTE_DROPSHIP, ROUTE_MAIN, ROUTE_MAIN]


class TestServiceStatus:
    def beat(self, outbox: Path, **fields) -> None:
        outbox.mkdir(parents=True, exist_ok=True)
        beat = {"at": datetime.now(timezone.utc).isoformat(), "state": "CONNECTED",
                "group": "Orders", **fields}
        (outbox.parent / "heartbeat.json").write_text(json.dumps(beat), encoding="utf-8")

    def test_both_groups_are_named(self, outbox):
        self.beat(outbox, dropship_group="Supplier", held=0)
        status = service_status()
        assert status.dropship_group == "Supplier"
        assert status.describe() == (
            'service running, posting to "Orders", drop-ship to "Supplier" - nothing waiting'
        )

    def test_orders_held_for_a_missing_drop_ship_group_are_a_warning(self, outbox):
        self.beat(outbox, dropship_group=None, held=2)
        text = service_status().describe()
        assert 'posting to "Orders" - ' in text
        assert "2 paid drop-ship order(s) can't go out" in text
        assert "jt-whatsapp --pick-group" in text

    def test_a_heartbeat_from_before_drop_ship_still_reads(self, outbox):
        self.beat(outbox)
        status = service_status()
        assert (status.running, status.dropship_group, status.held) == (True, None, 0)
        assert status.describe() == 'service running, posting to "Orders" - nothing waiting'

    def test_not_running_says_nothing_about_groups(self):
        status = ServiceStatus(running=False, connected=False, group=None, pending=1, held=3)
        assert "drop-ship" not in status.describe()


# ------------------------------------------------------------------ packing
class TestPacking:
    @pytest.fixture
    def labels(self, tmp_path):
        paths = []
        for n in range(3):
            path = tmp_path / f"OrderNo_{n}.pdf"
            render_waybill(replace(REFERENCE_ORDER, tracking_no=f"63215857{n:04d}"), path)
            paths.append(path)
        return paths

    def test_orders_the_supplier_ships_are_left_out(self, tmp_path, labels):
        def packing(no: int, items: list[dict], payment: str) -> PackingOrder:
            return PackingOrder(
                order_no=str(no), tracking_no=f"63{no}", items=items,
                waybill_path=str(labels[no]), sequence=no,
                supplier_ships=supplier_ships(items, payment),
            )

        files = write_packing_pdfs(
            [
                packing(0, [GOWN], "PREPAID"),          # the supplier's
                packing(1, [GOWN], "COD"),              # ours: cash on delivery
                packing(2, [GOWN, KURTI], "PREPAID"),   # ours: mixed
            ],
            tmp_path / "packing",
        )
        assert [(f.title, f.orders) for f in files] == [("Chiffon Gown", 1), (MIXED, 1)]
        assert sum(len(PdfReader(str(f.path)).pages) for f in files) == 2

    def test_a_day_of_only_supplier_orders_writes_no_files(self, tmp_path, labels):
        only = PackingOrder("0", "630", [GOWN], str(labels[0]), supplier_ships=True)
        assert write_packing_pdfs([only], tmp_path / "packing") == []


# ------------------------------------------------------------------ normal order
class TestNormalOrder:
    BASE = dict(
        receiver_name="Nur Aisyah Rahman", receiver_phone="+60 171234567",
        receiver_postcode="47100", receiver_address="12 Jalan Contoh 3, Taman Contoh",
        goods_name="Chiffon Gown", actual_weight="0.8", customer_order_no="12820",
    )

    def test_an_item_is_in_stock_unless_ticked(self):
        assert OrderItemIn(goods_name="Chiffon Gown").dropship is False
        assert OrderItemIn(goods_name="Chiffon Gown", dropship=True).dropship is True

    def test_the_tick_reaches_the_order(self):
        body = NormalOrderIn(**self.BASE, items=[
            {"goods_name": "Chiffon Gown", "item_variant": "Red / M", "dropship": True},
            {"goods_name": "Kurti"},
        ])
        assert [i["dropship"] for i in _payload(body)["items"]] == [True, False]
