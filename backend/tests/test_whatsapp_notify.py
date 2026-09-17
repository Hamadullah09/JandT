"""WhatsApp group notifications: message format, photo lookup, the outbox."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.config import get_settings
from app.csv_engine.parser import parse_csv
from app.csv_engine.pipeline import PipelineRow
from app.csv_engine.schema import CANONICAL, map_headers
from app.notify.whatsapp import (
    build_job,
    build_messages,
    enqueue,
    format_phone,
    queue_created_rows,
    resolve_image,
    service_status,
)

ORDER = {
    "customer_order_no": "12809",
    "tracking_no": "632158575144",
    "receiver_name": "Nur Aisyah Rahman",
    "receiver_address": "12 Jalan Contoh 3, Taman Contoh",
    "receiver_postcode": "47100",
    "receiver_city": "Puchong",
    "receiver_state": "Selangor",
    "receiver_phone": "+60 171234567",
    "goods_name": "Embroidered Maxi Chic",
    "item_variant": "Purple / L",
}


@pytest.fixture
def images(tmp_path: Path) -> Path:
    folder = tmp_path / "images"
    folder.mkdir()
    (folder / "Embroidered Maxi Chic.JPG").write_bytes(b"jpg")
    (folder / "#1 (5).jpeg").write_bytes(b"jpg")
    return folder


@pytest.fixture
def pdf(tmp_path: Path) -> Path:
    path = tmp_path / "OrderNo_12809.pdf"
    path.write_bytes(b"%PDF-1.4")
    return path


@pytest.fixture
def enabled(tmp_path: Path, images: Path, monkeypatch):
    """WhatsApp switched on, pointed at a throwaway outbox."""
    settings = get_settings()
    outbox = tmp_path / "outbox"
    monkeypatch.setattr(settings, "whatsapp_enabled", True)
    monkeypatch.setattr(settings, "whatsapp_outbox_dir", str(outbox))
    monkeypatch.setattr(settings, "whatsapp_images_dir", str(images))
    return outbox


def created_row(pdf: Path, *, image: str = "", order_no: str = "12809",
                tracking: str = "632158575144") -> PipelineRow:
    row = PipelineRow(row_no=1, payload={"order_no": order_no, "image": image})
    row.status = "created"
    row.tracking_no = tracking
    row.waybill_path = str(pdf)
    row.enriched = {**ORDER, "customer_order_no": order_no, "tracking_no": tracking}
    return row


# ------------------------------------------------------------------ phone
class TestFormatPhone:
    def test_matches_how_customers_write_it(self):
        assert format_phone("+60 171234567") == "+60 17-123 4567"

    def test_011_numbers_have_an_extra_digit(self):
        assert format_phone("+60 1123456789") == "+60 11-2345 6789"

    def test_anything_else_passes_through(self):
        assert format_phone("+92 3001234567") == "+92 3001234567"
        assert format_phone("") == ""
        assert format_phone(None) == ""


# ------------------------------------------------------------------ photos
class TestResolveImage:
    def test_csv_file_name_is_looked_up_in_the_images_folder(self, images):
        path, warning = resolve_image("#1 (5).jpeg", "anything", images)
        assert path == (images / "#1 (5).jpeg").resolve()
        assert warning is None

    def test_csv_absolute_path_is_used_as_is(self, images):
        absolute = str((images / "#1 (5).jpeg").resolve())
        assert resolve_image(absolute, None, images)[0] == Path(absolute)

    def test_falls_back_to_a_photo_named_after_the_product(self, images):
        path, _ = resolve_image("", "embroidered  maxi CHIC", images)
        assert path == (images / "Embroidered Maxi Chic.JPG").resolve()

    def test_a_missing_csv_photo_warns_and_still_falls_back(self, images):
        path, warning = resolve_image("nope.jpg", "Embroidered Maxi Chic", images)
        assert path == (images / "Embroidered Maxi Chic.JPG").resolve()
        assert "nope.jpg" in warning

    def test_no_photo_at_all_is_normal_not_a_warning(self, images):
        assert resolve_image("", "Unknown Product", images) == (None, None)

    def test_a_missing_images_folder_is_not_an_error(self, tmp_path):
        assert resolve_image("", "x", tmp_path / "absent") == (None, None)


# ------------------------------------------------------------------ messages
class TestBuildMessages:
    def test_three_messages_in_order(self, images, pdf):
        photo = images / "#1 (5).jpeg"
        messages = build_messages(ORDER, photo, pdf)
        assert [m["type"] for m in messages] == ["text", "image", "document"]
        assert messages[0]["text"] == "Order created #12809\nTracking: 632158575144"
        assert messages[1]["path"] == str(photo)
        assert messages[2]["path"] == str(pdf)

    def test_caption_matches_a_customer_whatsapp_order(self, images, pdf):
        caption = build_messages(ORDER, images / "#1 (5).jpeg", pdf)[1]["caption"]
        assert caption == (
            "Purple / L\n"
            "\n"
            "Nur Aisyah Rahman\n"
            "12 Jalan Contoh 3, Taman Contoh\n"
            "47100 Puchong\n"
            "Selangor\n"
            "Malaysia\n"
            "+60 17-123 4567"
        )

    def test_without_a_photo_still_only_the_colour_and_size(self, pdf):
        details = build_messages(ORDER, None, pdf)[1]
        assert details["type"] == "text"
        assert details["text"].startswith("Purple / L\n\nNur Aisyah")

    def test_no_colour_or_size_means_the_message_starts_with_the_receiver(self, images, pdf):
        order = {**ORDER, "item_variant": ""}
        caption = build_messages(order, images / "#1 (5).jpeg", pdf)[1]["caption"]
        assert caption.startswith("Nur Aisyah Rahman\n")

    def test_the_product_name_is_never_in_the_message(self, images, pdf):
        # the merchant asked: colour/size only, like their own WhatsApp orders
        for photo in (images / "#1 (5).jpeg", None):
            for variant in ("Purple / L", ""):
                message = build_messages({**ORDER, "item_variant": variant}, photo, pdf)[1]
                assert "Embroidered" not in (message.get("caption") or message["text"])

    def test_no_pdf_means_no_document_message(self):
        assert [m["type"] for m in build_messages(ORDER, None, None)] == ["text", "text"]


class TestSeveralItems:
    ITEMS = [
        {"name": "Embroidered Maxi Chic", "variant": "Purple / L", "quantity": 2},
        {"name": "Pure Chiffon Gown", "variant": "Red / M", "quantity": 1},
    ]

    def test_each_item_gets_a_colour_and_size_line_without_its_name(self, images, pdf):
        order = {**ORDER, "items": self.ITEMS}
        caption = build_messages(order, images / "#1 (5).jpeg", pdf)[1]["caption"]
        assert caption.startswith("Purple / L x2\nRed / M\n\nNur Aisyah")

    def test_an_item_without_colour_or_size_adds_no_line(self, images, pdf):
        order = {**ORDER, "items": [*self.ITEMS, {"name": "Scarf", "variant": "", "quantity": 1}]}
        caption = build_messages(order, images / "#1 (5).jpeg", pdf)[1]["caption"]
        assert caption.startswith("Purple / L x2\nRed / M\n\nNur Aisyah")

    def test_a_quantity_above_one_is_shown(self, images, pdf):
        order = {**ORDER, "items": [{**self.ITEMS[0]}]}
        assert build_messages(order, images / "#1 (5).jpeg", pdf)[1]["caption"].startswith(
            "Purple / L x2\n"
        )
        assert build_messages(order, None, pdf)[1]["text"].startswith("Purple / L x2\n")

    def test_the_photo_is_found_through_any_item(self, images, pdf):
        order = {**ORDER, "goods_name": "Gown x1, Embroidered Maxi Chic", "items": [
            {"name": "Gown", "variant": "", "quantity": 1},
            {"name": "Embroidered Maxi Chic", "variant": "", "quantity": 1},
        ]}
        job, warnings = build_job(
            order, image="", waybill_path=str(pdf), job_id="j", images_dir=images
        )
        assert job["messages"][1]["path"] == str((images / "Embroidered Maxi Chic.JPG").resolve())
        assert warnings == []

    def test_a_missing_csv_photo_says_which_photo_is_used_instead(self, images, pdf):
        _, warnings = build_job(
            ORDER, image="gone.jpg", waybill_path=str(pdf), job_id="j", images_dir=images
        )
        assert warnings == ["12809: photo not found: gone.jpg - using Embroidered Maxi Chic.JPG instead"]


# ------------------------------------------------------------------ jobs
class TestJobs:
    def test_a_missing_pdf_is_dropped_with_a_warning(self, images, tmp_path):
        job, warnings = build_job(
            ORDER, image="", waybill_path=str(tmp_path / "gone.pdf"),
            job_id="j1", images_dir=images,
        )
        assert [m["type"] for m in job["messages"]] == ["text", "image"]
        assert any("PDF missing" in w for w in warnings)

    def test_jobs_start_unsent(self, images, pdf):
        job, _ = build_job(ORDER, image="", waybill_path=str(pdf),
                           job_id="j1", images_dir=images)
        assert (job["sent"], job["attempts"], job["last_error"]) == (0, 0, None)

    def test_enqueue_is_atomic_and_leaves_no_temp_file(self, tmp_path, images, pdf):
        job, _ = build_job(ORDER, image="", waybill_path=str(pdf),
                           job_id="j1", images_dir=images)
        written = enqueue(job, tmp_path / "outbox")
        assert json.loads(written.read_text(encoding="utf-8"))["order_no"] == "12809"
        assert [p.name for p in (tmp_path / "outbox").iterdir()] == ["j1.json"]


# ------------------------------------------------------------------ queueing
class TestQueueCreatedRows:
    def test_tests_can_never_queue_whatever_env_says(self):
        assert get_settings().whatsapp_enabled is False

    def test_disabled_writes_nothing(self, pdf, tmp_path, monkeypatch):
        outbox = tmp_path / "outbox"
        monkeypatch.setattr(get_settings(), "whatsapp_outbox_dir", str(outbox))
        assert queue_created_rows([created_row(pdf)]).queued == 0
        assert not outbox.exists()

    def test_only_created_rows_are_queued(self, enabled, pdf):
        good = created_row(pdf)
        duplicate = created_row(pdf, order_no="12810", tracking="632158575145")
        duplicate.status = "duplicate"
        result = queue_created_rows([good, duplicate])
        assert result.queued == 1
        assert len(list(enabled.glob("*.json"))) == 1

    def test_jobs_sort_in_creation_order(self, enabled, pdf):
        rows = [
            created_row(pdf, order_no=str(12809 + i), tracking=f"63215857514{i}")
            for i in range(3)
        ]
        queue_created_rows(rows)
        names = sorted(p.name for p in enabled.glob("*.json"))
        order_nos = [
            json.loads((enabled / n).read_text(encoding="utf-8"))["order_no"]
            for n in names
        ]
        assert order_nos == ["12809", "12810", "12811"]

    def test_the_csv_photo_reaches_the_job(self, enabled, images, pdf):
        queue_created_rows([created_row(pdf, image="#1 (5).jpeg")])
        job = json.loads(next(enabled.glob("*.json")).read_text(encoding="utf-8"))
        assert job["messages"][1]["path"] == str((images / "#1 (5).jpeg").resolve())


# ------------------------------------------------------------------ service status
class TestServiceStatus:
    NOW = "2026-09-16T08:00:00.000Z"

    def beat(self, outbox: Path, *, at: str = NOW, state: str = "CONNECTED") -> None:
        outbox.mkdir(parents=True, exist_ok=True)
        (outbox.parent / "heartbeat.json").write_text(
            json.dumps({"at": at, "state": state, "group": "Orders"}), encoding="utf-8"
        )

    def now(self, seconds_later: int):
        from datetime import datetime, timedelta
        return datetime.fromisoformat(self.NOW.replace("Z", "+00:00")) + timedelta(
            seconds=seconds_later
        )

    def test_no_heartbeat_means_not_running(self, enabled):
        status = service_status()
        assert (status.running, status.connected) == (False, False)
        assert "NOT running" in status.describe()

    def test_a_fresh_heartbeat_means_running(self, enabled):
        self.beat(enabled)
        status = service_status(now=self.now(5))
        assert (status.running, status.connected, status.group) == (True, True, "Orders")
        assert 'posting to "Orders"' in status.describe()

    def test_a_stale_heartbeat_means_it_stopped(self, enabled):
        self.beat(enabled)
        assert service_status(now=self.now(600)).running is False

    def test_a_whatsapp_restriction_is_reported_as_such(self, enabled):
        self.beat(enabled, state="RESTRICTED")
        status = service_status(now=self.now(5))
        assert (status.running, status.restricted) == (True, True)
        assert "RESTRICTED" in status.describe()
        assert "paused" in status.describe()

    def test_running_but_disconnected_is_reported(self, enabled):
        self.beat(enabled, state="OPENING")
        status = service_status(now=self.now(5))
        assert (status.running, status.connected) == (True, False)
        assert "not connected" in status.describe()

    def test_pending_jobs_are_counted_but_temp_files_are_not(self, enabled, pdf):
        queue_created_rows([created_row(pdf)])
        (enabled / ".half-written.tmp").write_text("x")
        assert service_status().pending == 1

    def test_a_corrupt_heartbeat_is_not_an_error(self, enabled):
        enabled.mkdir(parents=True, exist_ok=True)
        (enabled.parent / "heartbeat.json").write_text("{ nope")
        assert service_status().running is False


# ------------------------------------------------------------------ csv column
class TestImageColumn:
    def test_common_spellings_map_to_image(self):
        for spelling in ["image", "Image", "Photo", "Product Image", "Picture"]:
            assert map_headers([spelling]).columns == {spelling: "image"}

    def test_image_is_not_part_of_the_production_template(self):
        assert "image" not in CANONICAL

    def test_image_value_survives_parsing(self):
        header = ",".join([*CANONICAL, "Photo"])
        row = (
            "12809,Tan Mei Ling,0123456789,47810,Petaling Jaya,Selangor,"
            '"No. 1, Jalan Contoh 1, Taman Contoh",HOME,'
            "Pearl Hand Embellished 3 Piece Suit,,1,1.2,0,0,0,PREPAID,0,119,"
            'Paid Order,"#1 (5).jpeg"'
        )
        parsed = parse_csv(f"{header}\n{row}".encode("utf-8"), "t.csv")
        assert not parsed.fatal
        assert parsed.rows[0].data["image"] == "#1 (5).jpeg"
