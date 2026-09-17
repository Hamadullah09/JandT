"""Integration tests for the full bulk pipeline (acceptance criteria 6-9).

These need PostgreSQL and skip themselves when it is not reachable.
"""
from __future__ import annotations

import csv
from pathlib import Path

import pytest
from sqlalchemy import func, select, text

from app.csv_engine.parser import parse_csv
from app.csv_engine.pipeline import rows_from_parse, run_pipeline
from app.db.models import ImportBatch, Order
from tests.conftest import requires_db

SAMPLES = Path(__file__).resolve().parent.parent / "samples"
BULK_500 = SAMPLES / "bulk_orders_500.csv"
BROKEN = SAMPLES / "bulk_orders_broken.csv"

pytestmark = [requires_db, pytest.mark.db]


async def run_batch(session, sender, csv_path: Path, out: Path, limit: int | None = None):
    parsed = parse_csv(csv_path, csv_path.name)
    assert parsed.fatal is None
    rows = rows_from_parse(parsed)
    if limit:
        rows = rows[:limit]

    batch = ImportBatch(
        filename=csv_path.name,
        source_path=str(csv_path),
        output_dir=str(out),
        total_rows=len(rows),
        status="pending",
        created_by="pytest",
    )
    session.add(batch)
    await session.commit()

    summary = await run_pipeline(
        session, batch=batch, rows=rows, output_dir=out, sender=sender
    )
    return summary


class TestHundredRowPipeline:
    """The full path: parse -> enrich -> allocate -> persist -> render."""

    async def test_creates_every_order_and_pdf(self, session, sender, tmp_out):
        summary = await run_batch(session, sender, BULK_500, tmp_out, limit=100)

        assert summary.total == 100
        assert summary.created == 100
        assert summary.failed == 0
        assert summary.duplicates == 0

        pdfs = sorted(tmp_out.glob("OrderNo_*.pdf"))
        assert len(pdfs) == 100
        assert all(p.stat().st_size > 1000 for p in pdfs)

    async def test_rows_land_in_the_database(self, session, sender, tmp_out):
        await run_batch(session, sender, BULK_500, tmp_out, limit=100)
        total = await session.scalar(select(func.count()).select_from(Order))
        assert total == 100

    async def test_tracking_numbers_are_unique_and_well_formed(
        self, session, sender, tmp_out
    ):
        await run_batch(session, sender, BULK_500, tmp_out, limit=100)
        total, distinct = (
            await session.execute(
                text("SELECT count(*), count(DISTINCT tracking_no) FROM orders")
            )
        ).one()
        assert total == distinct == 100

        numbers = list(await session.scalars(select(Order.tracking_no)))
        assert all(len(n) == 12 and n.isdigit() and n.startswith("63") for n in numbers)

    async def test_carrier_fields_are_derived(self, session, sender, tmp_out):
        await run_batch(session, sender, BULK_500, tmp_out, limit=100)
        orders = list(await session.scalars(select(Order)))
        for order in orders:
            assert order.sortation_code and order.sortation_code.count("-") == 2
            assert order.route_code
            assert order.service_scope in {"SAME CITY", "WEST", "EAST"}
            assert order.freight_fee is not None and order.freight_fee > 0
            assert order.chargeable_weight >= order.actual_weight
            assert order.waybill_filename == f"OrderNo_{order.customer_order_no}.pdf"

    async def test_sender_is_snapshotted_onto_every_order(
        self, session, sender, tmp_out
    ):
        await run_batch(session, sender, BULK_500, tmp_out, limit=20)
        orders = list(await session.scalars(select(Order)))
        assert orders
        for order in orders:
            assert order.sender_name == sender.company_name
            assert order.sender_postcode == sender.postcode
            assert order.sender_address == sender.address

    async def test_manifest_covers_every_row(self, session, sender, tmp_out):
        summary = await run_batch(session, sender, BULK_500, tmp_out, limit=100)
        manifest = Path(summary.manifest_path)
        assert manifest.exists()
        with manifest.open(encoding="utf-8-sig", newline="") as fh:
            rows = list(csv.DictReader(fh))
        assert len(rows) == 100
        assert rows[0]["status"] == "created"
        assert rows[0]["tracking_no"].startswith("63")
        assert rows[0]["waybill_file"].startswith("OrderNo_")


class TestIdempotency:
    """AC8 - re-importing the same CSV must create zero new orders."""

    async def test_second_import_creates_nothing(self, session, sender, tmp_out):
        first = await run_batch(session, sender, BULK_500, tmp_out, limit=50)
        assert first.created == 50

        second_out = tmp_out / "again"
        second_out.mkdir()
        second = await run_batch(session, sender, BULK_500, second_out, limit=50)

        assert second.created == 0
        assert second.duplicates == 50
        assert list(second_out.glob("OrderNo_*.pdf")) == []

        total = await session.scalar(select(func.count()).select_from(Order))
        assert total == 50

    async def test_duplicates_are_reported_per_row(self, session, sender, tmp_out):
        await run_batch(session, sender, BULK_500, tmp_out, limit=10)
        again = tmp_out / "again"
        again.mkdir()
        summary = await run_batch(session, sender, BULK_500, again, limit=10)
        for row in summary.rows:
            assert row.status == "duplicate"
            assert "already exists" in (row.error_message or "")

    async def test_the_unique_index_is_the_real_guard(self, session, sender, tmp_out):
        """Even bypassing the pre-check, the database refuses a second row."""
        await run_batch(session, sender, BULK_500, tmp_out, limit=1)
        order_no = await session.scalar(select(Order.customer_order_no))
        with pytest.raises(Exception):
            await session.execute(
                text(
                    "INSERT INTO orders (tracking_no, customer_order_no, sender_name,"
                    " sender_phone, sender_postcode, sender_state, sender_address,"
                    " receiver_name, receiver_phone, receiver_postcode, receiver_state,"
                    " receiver_address, actual_weight, volumetric_weight,"
                    " chargeable_weight) VALUES ('639999999999', :o, 'x','x','43300',"
                    " 'SELANGOR','x','x','x','43000','SELANGOR','x',1,0,1)"
                ),
                {"o": order_no},
            )
        await session.rollback()


class TestPartialFailure:
    """AC9 - 490 good rows are created, 10 rows come back with precise errors."""

    async def test_good_rows_survive_bad_ones(self, session, sender, tmp_out):
        summary = await run_batch(session, sender, BROKEN, tmp_out)

        assert summary.total == 500
        assert summary.created == 490
        assert summary.failed == 10
        assert len(list(tmp_out.glob("OrderNo_*.pdf"))) == 490

    async def test_every_failure_names_a_field_and_a_reason(
        self, session, sender, tmp_out
    ):
        summary = await run_batch(session, sender, BROKEN, tmp_out)
        failures = [r for r in summary.rows if r.status == "error"]
        assert len(failures) == 10
        for row in failures:
            assert row.error_field
            assert row.error_message

    async def test_error_csv_is_written(self, session, sender, tmp_out):
        summary = await run_batch(session, sender, BROKEN, tmp_out)
        errors = Path(summary.errors_path)
        assert errors.exists()
        with errors.open(encoding="utf-8-sig", newline="") as fh:
            rows = list(csv.DictReader(fh))
        assert len(rows) == 10
        assert {"row_no", "order_no", "status", "field", "message"} <= set(rows[0])

    async def test_an_unknown_postcode_fails_only_its_own_row(
        self, session, sender, tmp_out
    ):
        summary = await run_batch(session, sender, BROKEN, tmp_out)
        unseeded = [
            r for r in summary.rows
            if r.error_message and "not a recognised Malaysian postcode" in r.error_message
        ]
        assert len(unseeded) == 1
        assert summary.created == 490


class TestOutputArtefacts:
    async def test_filenames_use_the_order_number(self, session, sender, tmp_out):
        summary = await run_batch(session, sender, BULK_500, tmp_out, limit=5)
        for row in summary.rows:
            assert row.waybill_file == f"OrderNo_{row.order_no}.pdf"
            assert (tmp_out / row.waybill_file).exists()

    async def test_pdfs_are_valid_single_page_labels(self, session, sender, tmp_out):
        from pypdf import PdfReader

        await run_batch(session, sender, BULK_500, tmp_out, limit=5)
        for pdf in tmp_out.glob("OrderNo_*.pdf"):
            reader = PdfReader(str(pdf))
            assert len(reader.pages) == 1
            box = reader.pages[0].mediabox
            assert (float(box.width), float(box.height)) == (280.0, 510.0)
