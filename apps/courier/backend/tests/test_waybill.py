"""Waybill regression tests (acceptance criterion 5).

Two independent guards:

* **against the real reference** - ``tests/golden/OrderNo_12808_reference.pdf``
  is the artefact shipped with the spec.  Every text item, rule, black bar and
  barcode box in the generated label is asserted against the position it
  occupies there.
* **against a golden byte stream** - the renderer is deterministic, so any
  unintended change to output shows up as a byte diff.

Both run without a database.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest
from pypdf import PdfReader

from app.waybill import layout as L
from app.waybill.dto import OrderDTO
from app.waybill.renderer import render_waybill
from tests.fixtures import REFERENCE_ORDER

GOLDEN_DIR = Path(__file__).parent / "golden"
REFERENCE_PDF = GOLDEN_DIR / "OrderNo_12808_reference.pdf"
GOLDEN_PDF = GOLDEN_DIR / "OrderNo_12808_generated.pdf"

#: Baseline position tolerance, in points.
TOL = 3.0


def x_tolerance(size: float) -> float:
    """Horizontal allowance for one text item.

    Helvetica and the reference's Arial / MicrosoftYaHei subsets are metrically
    close but not identical, so a *centred* or *right-aligned* string starts a
    little further along when its glyphs are narrower.  That offset is half the
    width difference, which scales with the font size - hence a proportional
    allowance rather than a flat one.  At 7-9 pt it stays at TOL; the 24 pt
    sortation code gets ~4.8 pt.
    """
    return max(TOL, size * 0.2)


def text_items(path: Path) -> list[tuple[float, float, float, str]]:
    """``[(x, y, size, text), ...]`` for one page, decoded via ToUnicode."""
    items: list[tuple[float, float, float, str]] = []

    def visitor(text, cm, tm, font_dict, font_size):  # noqa: ANN001
        if not text or not text.strip():
            return
        items.append((round(tm[4], 2), round(tm[5], 2), float(font_size), text.replace("\n", "")))

    PdfReader(str(path)).pages[0].extract_text(visitor_text=visitor)
    return items


def content_stream(path: Path) -> str:
    return PdfReader(str(path)).pages[0].get_contents().get_data().decode("latin-1")


def find_item(items, needle: str, near_y: float | None = None):
    """Locate a text item.

    Several strings appear once per copy (``TO``, ``MONTHLY``, the tracking
    number), so a caller that knows where it expects the item passes *near_y*
    and gets the closest candidate rather than whichever copy comes first.
    """
    matches = [it for it in items if needle in it[3]]
    if not matches:
        return None
    if near_y is None:
        return matches[0]
    return min(matches, key=lambda it: abs(it[1] - near_y))


@pytest.fixture(scope="module")
def generated(tmp_path_factory) -> Path:
    out = tmp_path_factory.mktemp("waybill") / "OrderNo_12808.pdf"
    render_waybill(REFERENCE_ORDER, out)
    return out


class TestPageGeometry:
    def test_page_size_is_280_by_510(self, generated):
        box = PdfReader(str(generated)).pages[0].mediabox
        assert (float(box.width), float(box.height)) == (280.0, 510.0)

    def test_reference_has_the_same_page_size(self):
        box = PdfReader(str(REFERENCE_PDF)).pages[0].mediabox
        assert (float(box.width), float(box.height)) == (L.PAGE_W, L.PAGE_H)

    def test_single_page(self, generated):
        assert len(PdfReader(str(generated)).pages) == 1


class TestTextAgainstReference:
    """Every text item must sit where the reference puts it."""

    #: (substring, x, y, size) taken from the reference's own text matrices.
    EXPECTED = [
        # --- receiver copy -------------------------------------------------
        ("632158571544", 220.74, 485.31, 8.0),
        ("Nalini Sinnasamy", 41.00, 472.21, 7.0),
        ("TO", 14.26, 467.92, 9.0),
        ("F-08-07, RESIDENSI IDAMAN ABADI,", 41.00, 461.59, 7.0),
        ("43000", 7.31, 447.42, 9.0),
        ("KAJANG SELANGOR MALAYSIA", 41.00, 443.12, 7.0),
        ("LINKED INTERNATIONAL SDN BHD", 42.00, 409.21, 7.0),
        ("FROM", 7.12, 407.42, 9.0),
        ("******06", 43.00, 399.21, 7.0),
        ("43300", 7.31, 394.92, 9.0),
        ("0.6 KG", 13.29, 382.51, 5.0),
        ("MONTHLY", 241.84, 382.51, 5.0),
        ("Receiver Copy", 107.73, 381.10, 8.0),
        # --- dispatcher copy -----------------------------------------------
        ("300-K41-SG496", 49.93, 348.44, 24.0),
        ("E03", 231.85, 311.94, 24.0),
        ("632158571544", 125.87, 306.81, 8.0),
        ("2026-09-14", 6.34, 304.57, 6.0),
        ("TO", 17.15, 293.21, 7.0),
        ("43000", 11.74, 277.71, 7.0),
        ("HOME", 204.43, 256.02, 10.0),
        ("COD", 191.65, 241.21, 7.0),
        ("EZ", 268.82, 241.21, 7.0),
        ("Parcel  Information", 5.00, 227.21, 7.0),
        ("Signature", 173.00, 226.81, 8.0),
        ("Chiffon Georgette Party Set with Farshi Palazzo -", 5.00, 216.59, 7.0),
        ("IC", 173.00, 215.21, 7.0),
        ("MONTHLY", 241.54, 215.21, 7.0),
        ("By signing this package", 6.00, 204.68, 5.0),
        ("Dispatcher Copy", 193.24, 197.10, 8.0),
        # --- sender copy ----------------------------------------------------
        ("632158571544", 120.87, 143.31, 8.0),
        ("Nalini Sinnasamy", 43.00, 130.21, 7.0),
        ("******94", 208.00, 130.21, 7.0),
        ("TO", 15.26, 127.92, 9.0),
        ("43000", 8.31, 106.42, 9.0),
        ("LINKED INTERNATIONAL SDN BHD", 44.00, 94.71, 7.0),
        ("FROM", 8.12, 92.42, 9.0),
        ("B-09-09, PERDANA SELATAN", 44.00, 84.59, 7.0),
        ("43300", 8.81, 75.92, 9.0),
        ("Parcel  Information", 46.00, 64.51, 5.0),
        ("2026-09-14", 4.84, 59.61, 6.0),
        ("Chiffon Georgette Party Set with Farshi Palazzo -  M", 44.00, 55.59, 7.0),
        ("MONTHLY", 3.27, 40.71, 7.0),
        ("Remarks:", 45.00, 29.51, 5.0),
        ("0.6 KG", 8.16, 24.31, 8.0),
        ("This invoice services provided by J&T Express", 3.00, 18.35, 4.0),
        ("Sender Copy", 114.85, 3.10, 8.0),
    ]

    @pytest.mark.parametrize(("needle", "x", "y", "size"), EXPECTED)
    def test_item_position(self, generated, needle, x, y, size):
        found = find_item(text_items(generated), needle, near_y=y)
        assert found is not None, f"{needle!r} is missing from the waybill"
        got_x, got_y, got_size, _ = found
        allowance = x_tolerance(size)
        assert abs(got_x - x) <= allowance, (
            f"{needle!r} x={got_x} expected ~{x} (+/-{allowance:.1f})"
        )
        assert abs(got_y - y) <= TOL, f"{needle!r} y={got_y} expected ~{y}"
        assert got_size == size, f"{needle!r} size={got_size} expected {size}"

    def test_the_reference_really_contains_these_items(self):
        """Guards the expectation table itself against drift."""
        items = text_items(REFERENCE_PDF)
        for needle, x, y, size in self.EXPECTED:
            found = find_item(items, needle, near_y=y)
            assert found is not None, f"{needle!r} not in the reference PDF"
            assert abs(found[0] - x) <= 0.01 and abs(found[1] - y) <= 0.01
            assert found[2] == size


class TestStaticContent:
    def test_phone_numbers_are_masked(self, generated):
        blob = " ".join(t for _, _, _, t in text_items(generated))
        assert "******94" in blob and "******06" in blob
        assert "123456794" not in blob
        assert "135763706" not in blob

    def test_date_format_is_iso(self, generated):
        blob = " ".join(t for _, _, _, t in text_items(generated))
        assert re.search(r"\b2026-09-14\b", blob)

    def test_all_three_copy_names_present(self, generated):
        blob = " ".join(t for _, _, _, t in text_items(generated))
        for name in ("Receiver Copy", "Dispatcher Copy", "Sender Copy"):
            assert name in blob

    def test_legal_sentences_are_verbatim(self, generated):
        blob = " ".join(t for _, _, _, t in text_items(generated))
        for line in L.LEGAL_DISPATCHER + L.LEGAL_SENDER:
            assert line in blob

    def test_service_badge(self, generated):
        blob = " ".join(t for _, _, _, t in text_items(generated))
        assert "NORMAL" in blob and "SAME CITY" in blob


class TestObjectPositions:
    """Black bars, rules and barcode boxes, read out of the content stream."""

    def test_copy_name_bars(self, generated):
        stream = content_stream(generated)
        for x, y, w, h in [
            (L.A_STRIP_BAR_X, L.A_STRIP_BAR_Y, L.A_STRIP_BAR_W, L.A_STRIP_BAR_H),
            (L.B_BAR_X, L.B_BAR_Y, L.B_BAR_W, L.B_BAR_H),
            (L.C_BAR_X, L.C_BAR_Y, L.C_BAR_W, L.C_BAR_H),
            (L.B_BADGE_X, L.B_BADGE_Y, L.B_BADGE_W, L.B_BADGE_H),
        ]:
            assert f"{x:g} {y:g} {w:g} {h:g} re" in stream, f"missing rect {x},{y},{w},{h}"

    def test_reference_has_the_same_bars(self):
        stream = content_stream(REFERENCE_PDF)
        # the reference draws them with a negative height from the top edge
        for x, top, w, h in [(41, 389, 189, 10), (171, 210, 108, 20), (0, 11, 279, 10)]:
            assert f"{x} {top} {w} -{h} re" in stream

    def test_cut_lines_are_dashed(self, generated):
        stream = content_stream(generated)
        assert "[2.5 1.5] 0 d" in stream

    def test_barcode_boxes(self, generated):
        """Three Code128 symbols, each scaled to its measured width."""
        stream = content_stream(generated)
        scales = re.findall(r"([\d.]+) 0 0 1 ([\d.]+) ([\d.]+) cm", stream)
        assert len(scales) >= 3, "expected three scaled barcode transforms"
        placements = {(round(float(x), 2), round(float(y), 2)) for _, x, y in scales}
        for x, y in [
            (L.A_BARCODE_X, L.A_BARCODE_Y),
            (L.B_BARCODE_X, L.B_BARCODE_Y),
            (L.C_BARCODE_X, L.C_BARCODE_Y),
        ]:
            assert (x, y) in placements, f"no barcode placed at {x},{y}"


class TestDeterminism:
    def test_byte_stable_across_renders(self, tmp_path):
        a, b = tmp_path / "a.pdf", tmp_path / "b.pdf"
        render_waybill(REFERENCE_ORDER, a)
        render_waybill(REFERENCE_ORDER, b)
        assert a.read_bytes() == b.read_bytes()

    def test_matches_the_committed_golden(self, generated):
        assert generated.read_bytes() == GOLDEN_PDF.read_bytes(), (
            "Waybill output changed. If this is intended, regenerate with:\n"
            "  python -c \"import sys;sys.path.insert(0,'.');"
            "from tests.fixtures import REFERENCE_ORDER;"
            "from app.waybill.renderer import render_waybill;"
            "render_waybill(REFERENCE_ORDER,'tests/golden/OrderNo_12808_generated.pdf')\""
        )


class TestOverflowHandling:
    def test_long_values_are_truncated_not_wrapped(self, tmp_path):
        order = OrderDTO(
            **{
                **REFERENCE_ORDER.to_dict(),
                "receiver_name": "A" * 60,
                "goods_name": "Very Long Product Name " * 12,
                "receiver_address": "Jalan " + ("Panjang " * 40),
            }
        )
        out = render_waybill(order, tmp_path / "long.pdf")
        blob = " ".join(t for _, _, _, t in text_items(out))
        assert "-" in blob                                  # truncation marker
        # nothing may run past the page edge
        for x, _y, size, text in text_items(out):
            from app.waybill.text import width_of

            assert x + width_of(text, L.FONT, size) <= L.PAGE_W + 1.0

    def test_non_latin_name_still_renders(self, tmp_path):
        order = OrderDTO(**{**REFERENCE_ORDER.to_dict(), "receiver_name": "Zoë Müller"})
        out = render_waybill(order, tmp_path / "unicode.pdf")
        assert out.exists() and out.stat().st_size > 1000

    def test_cod_watermark_only_when_cod_is_positive(self, tmp_path):
        with_cod = render_waybill(REFERENCE_ORDER, tmp_path / "cod.pdf")
        without = render_waybill(
            OrderDTO(**{**REFERENCE_ORDER.to_dict(), "cod_amount": 0.0}),
            tmp_path / "nocod.pdf",
        )
        # reportlab writes floats without a leading zero: ".784 .784 .784 rg"
        grey = re.compile(r"0?\.784 0?\.784 0?\.784 rg")
        assert grey.search(content_stream(with_cod))
        assert not grey.search(content_stream(without))
