"""Track & trace statuses (app/core/trace.py) and the orders CSV (app/core/export.py)."""
from __future__ import annotations

import csv
import io
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.core import trace
from app.core.export import COLUMNS, ExportOrder, as_text, orders_csv, safe

UTC = timezone.utc


def at(hour: int, minute: int = 0, day: int = 17) -> datetime:
    return datetime(2026, 9, day, hour, minute, tzinfo=trace.MYT)


class TestStatus:
    def test_no_scans_yet_is_order_created(self):
        assert trace.status_of([]) == trace.CREATED

    @pytest.mark.parametrize(
        ("code", "status"),
        [
            ("PICKED_UP", trace.PICKED_UP),
            ("DEPARTURE", trace.IN_TRANSIT),
            ("DC_ARRIVAL", trace.IN_TRANSIT),
            ("DP_ARRIVAL", trace.IN_TRANSIT),
            ("ON_DELIVERY", trace.ON_DELIVERY),
            ("DELIVERED", trace.DELIVERED),
            ("RETURNED", trace.RETURNED),
        ],
    )
    def test_each_scan_sets_its_status(self, code, status):
        assert trace.status_of([trace.Scan(1, code, at(9))]) == status

    def test_the_latest_scan_by_time_wins_not_the_latest_entered(self):
        scans = [
            trace.Scan(1, "ON_DELIVERY", at(10)),
            trace.Scan(2, "PICKED_UP", at(8)),       # entered late, happened earlier
        ]
        assert trace.status_of(scans) == trace.ON_DELIVERY

    def test_at_the_same_time_the_later_entry_wins(self):
        scans = [trace.Scan(1, "ON_DELIVERY", at(10)), trace.Scan(2, "DELIVERED", at(10))]
        assert trace.status_of(scans) == trace.DELIVERED

    def test_every_quick_status_records_a_scan_with_that_status(self):
        for status, code in trace.QUICK_EVENT.items():
            assert trace.EVENT_TYPES[code].status == status

    def test_an_unknown_scan_is_refused(self):
        with pytest.raises(trace.TraceError):
            trace.event_type("TELEPORTED")


class TestWording:
    def test_j_and_t_descriptions_with_the_place(self):
        assert (
            trace.describe("DEPARTURE", "Transit Center SHAHALAM GATEWAY")
            == "Package is departing from 【Transit Center SHAHALAM GATEWAY】"
        )
        assert trace.describe("DP_ARRIVAL", " Drop Point CDC KOTA PUTERI 336 ") == (
            "Package is arrived to 【Drop Point CDC KOTA PUTERI 336】"
        )

    def test_without_a_place_there_are_no_empty_brackets(self):
        assert trace.describe("DEPARTURE", "") == "Package is in transit"
        assert "【" not in trace.describe("DC_ARRIVAL", None)

    def test_dates_and_times_as_jtexpress_my_prints_them(self):
        moment = datetime(2026, 8, 27, 8, 45, tzinfo=UTC)          # 04:45 PM in Malaysia
        assert trace.date_label(moment) == "2026-08-27, Thursday"
        assert trace.time_label(moment) == "04:45 PM"

    def test_a_time_without_a_zone_is_malaysia_time(self):
        assert trace.as_myt(datetime(2026, 9, 17, 14, 30)).utcoffset() == timedelta(hours=8)
        assert trace.time_label(datetime(2026, 9, 17, 14, 30)) == "02:30 PM"

    def test_just_after_midnight_in_malaysia_is_the_next_day(self):
        assert trace.date_label(datetime(2026, 9, 16, 16, 30, tzinfo=UTC)) == "2026-09-17, Thursday"


class TestStageIcons:
    def test_order_created_reaches_nothing(self):
        assert [s.reached for s in trace.steps(trace.CREATED)] == [False] * 4

    def test_in_transit_reaches_two(self):
        steps = trace.steps(trace.IN_TRANSIT)
        assert [s.label for s in steps] == ["Picked Up", "In Transit", "Delivery", "Delivered"]
        assert [s.reached for s in steps] == [True, True, False, False]

    def test_a_returned_parcel_ends_in_returned(self):
        steps = trace.steps(trace.RETURNED)
        assert steps[-1].label == "Returned"
        assert all(s.reached for s in steps)


# ---------------------------------------------------------------------------
# the CSV
# ---------------------------------------------------------------------------
def export_order(**changes) -> ExportOrder:
    fields = dict(
        created_at=datetime(2026, 9, 17, 6, 8, tzinfo=UTC),
        customer_order_no="12820",
        tracking_no="632158579194",
        tracking_status="IN_TRANSIT",
        tracking_updated_at=datetime(2026, 9, 17, 9, 30, tzinfo=UTC),
        receiver_name="Nur Aisyah Rahman",
        receiver_phone="+60 171234567",
        receiver_postcode="01000",
        receiver_city="Kangar",
        receiver_state="Perlis",
        receiver_address="12 Jalan Contoh 3, Taman Contoh",
        items=[
            {"name": "Chiffon Gown", "variant": "Red / M", "quantity": 2, "dropship": True},
            {"name": "Kurti", "variant": "", "quantity": 1},
        ],
        goods_name="Chiffon Gown x2, Kurti",
        item_variant="",
        quantity=3,
        order_payment_type="COD",
        cod_amount=Decimal("78"),
        order_value=Decimal("78"),
        freight_fee=Decimal("9"),
        chargeable_weight=Decimal("0.8"),
    )
    fields.update(changes)
    return ExportOrder(**fields)


def read(body: bytes) -> list[dict[str, str]]:
    assert body.startswith(b"\xef\xbb\xbf"), "Excel needs the UTF-8 byte order mark"
    return list(csv.DictReader(io.StringIO(body.decode("utf-8-sig"))))


def url(no: str) -> str:
    return f"http://localhost:3000/tracking/{no}"


class TestOrdersCsv:
    def test_one_row_per_order_with_every_column(self):
        rows = read(orders_csv([export_order(), export_order(tracking_no="632158579195")], url))
        assert list(rows[0]) == COLUMNS
        assert [r["No."] for r in rows] == ["1", "2"]

    def test_the_tracking_number_opens_its_tracking_page(self):
        row = read(orders_csv([export_order()], url))[0]
        assert row["Tracking Number"] == (
            '=HYPERLINK("http://localhost:3000/tracking/632158579194","632158579194")'
        )
        assert row["Tracking Link"] == "http://localhost:3000/tracking/632158579194"

    def test_numbers_excel_would_mangle_are_kept_as_text(self):
        row = read(orders_csv([export_order()], url))[0]
        assert row["Phone"] == '="+60 17-123 4567"'       # not a sum
        assert row["Postcode"] == '="01000"'              # keeps its leading zero
        assert row["Order No."] == '="12820"'

    def test_items_status_payment_and_times_in_malaysia(self):
        row = read(orders_csv([export_order()], url))[0]
        assert row["Items"] == "Chiffon Gown - Red / M x2; Kurti"
        assert (row["Pieces"], row["Payment"], row["COD Amount (RM)"]) == ("3", "COD", "78.00")
        assert (row["Status"], row["Drop-ship"]) == ("In Transit", "Some")
        assert (row["Order Date"], row["Last Update"]) == ("2026-09-17 14:08", "2026-09-17 17:30")

    def test_a_paid_order_shows_no_cod_amount(self):
        row = read(orders_csv([export_order(order_payment_type="PREPAID")], url))[0]
        assert (row["Payment"], row["COD Amount (RM)"]) == ("Paid", "")

    @pytest.mark.parametrize("evil", ["=cmd|' /C calc'!A0", "+SUM(1,1)", "-2+3", "@SUM(A1)"])
    def test_text_that_looks_like_a_formula_can_never_run(self, evil):
        row = read(orders_csv([export_order(receiver_name=evil, receiver_address=evil)], url))[0]
        assert row["Receiver Name"] == f"'{evil}"
        assert row["Address"] == f"'{evil}"
        assert safe("Jalan 1") == "Jalan 1"

    def test_quotes_inside_text_formulas_are_escaped(self):
        assert as_text('A"1') == '="A""1"'
