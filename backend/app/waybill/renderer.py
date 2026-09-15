"""Draws one J&T waybill, matching ``OrderNo_12808.pdf``.

Absolute-coordinate ``canvas`` API only - no flowables, no Platypus.  Every
position comes from :mod:`app.waybill.layout`; this module contains no
positional literals.

Determinism: the canvas is created with ``invariant=1``, which fixes the
document ID and both timestamps, so the same order always produces a
byte-identical PDF (AC10).
"""
from __future__ import annotations

from itertools import groupby
from pathlib import Path

from reportlab.graphics.barcode import code128, qrencoder
from reportlab.lib.colors import Color, black, white
from reportlab.pdfgen import canvas as rl_canvas

from app.core.masking import mask
from app.waybill import layout as L
from app.waybill.dto import OrderDTO
from app.waybill.text import fit, pick_font, register_fonts, sanitise, width_of, wrap

__all__ = ["render_waybill"]


# ---------------------------------------------------------------------------
# primitives
# ---------------------------------------------------------------------------
def _draw(
    c: rl_canvas.Canvas,
    x: float,
    y: float,
    value: str,
    font: str,
    size: float,
    max_width: float | None = None,
) -> None:
    """Left-aligned text, auto-truncated and encoding-safe."""
    if not value:
        return
    chosen = pick_font(value, font)
    text = sanitise(value, chosen)
    if max_width is not None:
        text = fit(text, chosen, size, max_width)
    c.setFont(chosen, size)
    c.drawString(x, y, text)


def _draw_centred(
    c: rl_canvas.Canvas,
    cell: tuple[float, float],
    y: float,
    value: str,
    font: str,
    size: float,
) -> None:
    """Centre text inside ``(x1, x2)``, shrinking it if it cannot fit."""
    if not value:
        return
    chosen = pick_font(value, font)
    text = sanitise(value, chosen)
    x1, x2 = cell
    text = fit(text, chosen, size, x2 - x1)
    c.setFont(chosen, size)
    c.drawString(x1 + ((x2 - x1) - width_of(text, chosen, size)) / 2.0, y, text)


def _draw_right(
    c: rl_canvas.Canvas, right_x: float, y: float, value: str, font: str, size: float
) -> None:
    if not value:
        return
    chosen = pick_font(value, font)
    text = sanitise(value, chosen)
    c.setFont(chosen, size)
    c.drawString(right_x - width_of(text, chosen, size), y, text)


def _rule(c: rl_canvas.Canvas, x1: float, y: float, x2: float) -> None:
    c.setLineWidth(L.RULE_W)
    c.setDash()
    c.line(x1, y, x2, y)


def _vrule(c: rl_canvas.Canvas, x: float, y1: float, y2: float) -> None:
    c.setLineWidth(L.RULE_W)
    c.setDash()
    c.line(x, y1, x, y2)


def _cut_line(c: rl_canvas.Canvas, x1: float, y: float, x2: float) -> None:
    c.setLineWidth(L.CUT_W)
    c.setDash(*L.CUT_DASH)
    c.line(x1, y, x2, y)
    c.setDash()


def _black_bar(c: rl_canvas.Canvas, x: float, y: float, w: float, h: float) -> None:
    c.setFillColor(black)
    c.rect(x, y, w, h, stroke=0, fill=1)


def _bar_caption(
    c: rl_canvas.Canvas, x: float, w: float, y: float, value: str
) -> None:
    """White bold caption centred inside a black copy-name bar."""
    c.setFillColor(white)
    _draw_centred(c, (x, x + w), y, value, L.FONT_BOLD, L.SIZE_COPYNAME)
    c.setFillColor(black)


def _barcode(
    c: rl_canvas.Canvas, x: float, y: float, w: float, h: float, value: str
) -> None:
    """Code128, horizontally scaled to occupy exactly *w* points."""
    bc = code128.Code128(
        value, barHeight=h, barWidth=0.5, humanReadable=False, quiet=False
    )
    natural = bc.width
    if natural <= 0:
        return
    c.saveState()
    c.translate(x, y)
    c.scale(w / natural, 1.0)
    bc.drawOn(c, 0, 0)
    c.restoreState()


def _qr_code(c: rl_canvas.Canvas, x: float, y: float, size: float, value: str) -> None:
    """Vector QR (no PIL) whose payload is the tracking number.

    Draws the module matrix straight onto the canvas as one run-length-encoded
    path.  Geometry is identical to ``QrCodeWidget`` - the *size* box covers the
    modules plus a :data:`L.QR_BORDER`-module quiet zone on every side - but it
    encodes once instead of twice and skips the graphics scene entirely, which
    is worth ~70% of total render time.
    """
    code = qrencoder.QRCode(None, getattr(qrencoder.QRErrorCorrectLevel, L.QR_LEVEL))
    code.addData(value)
    code.make()

    border = L.QR_BORDER
    box = size / (code.getModuleCount() + border * 2.0)
    path = c.beginPath()
    for row_index, row in enumerate(code.modules):
        top = y + size - (row_index + border + 1) * box
        column = 0
        for dark, group in groupby(map(bool, row)):
            count = sum(1 for _ in group)
            if dark:
                path.rect(x + (column + border) * box, top, count * box, box)
            column += count
    c.drawPath(path, stroke=0, fill=1)


def _watermark(c: rl_canvas.Canvas) -> None:
    """Rotated grey ``COD`` stamp, drawn before everything else."""
    c.saveState()
    c.setFillColor(Color(L.WM_GREY, L.WM_GREY, L.WM_GREY))
    c.translate(L.WM_CX, L.WM_CY)
    c.rotate(L.WM_ANGLE)
    c.setFont(L.FONT_BOLD, L.WM_SIZE)
    text_w = width_of(L.WM_TEXT, L.FONT_BOLD, L.WM_SIZE)
    c.drawString(-text_w / 2.0, -L.WM_SIZE * 0.35, L.WM_TEXT)
    c.restoreState()
    c.setFillColor(black)


def _service_glyph(c: rl_canvas.Canvas) -> None:
    """The white sortation-centre mark to the right of the badge text.

    Two buildings - a narrow tower and a wider block - standing on a rounded
    tray, matching the icon burned into the reference label.
    """
    w, h = L.B_GLYPH_W, L.B_GLYPH_H
    x = L.B_GLYPH_CX - w / 2.0
    y = L.B_GLYPH_CY - h / 2.0
    c.saveState()
    c.setFillColor(white)

    # rounded tray the buildings stand on
    tray_h = h * 0.20
    c.roundRect(x, y, w, tray_h, tray_h * 0.46, stroke=0, fill=1)

    base_y = y + tray_h * 0.92
    tower_w, tower_h = w * 0.30, h * 0.62
    block_w, block_h = w * 0.50, h * 0.48
    tower_x = x + w * 0.06
    block_x = x + w * 0.44

    c.roundRect(tower_x, base_y, tower_w, tower_h, w * 0.04, stroke=0, fill=1)
    c.roundRect(block_x, base_y, block_w, block_h, w * 0.04, stroke=0, fill=1)

    # windows, punched back out in the badge's black
    c.setFillColor(black)
    win = w * 0.095
    for row in range(2):
        c.rect(
            tower_x + (tower_w - win) / 2.0,
            base_y + tower_h * 0.30 + row * win * 2.0,
            win, win, stroke=0, fill=1,
        )
    for row in range(2):
        for col in range(2):
            c.rect(
                block_x + block_w * 0.24 + col * win * 2.0,
                base_y + block_h * 0.22 + row * win * 2.0,
                win, win, stroke=0, fill=1,
            )
    c.restoreState()
    c.setFillColor(black)


def _badge_line(c: rl_canvas.Canvas, y: float, value: str) -> None:
    """White bold underlined line, centred on the badge's text column."""
    if not value:
        return
    chosen = pick_font(value, L.FONT_BOLD)
    text = sanitise(value, chosen)
    w = width_of(text, chosen, L.SIZE_BADGE)
    x = L.B_BADGE_TEXT_CX - w / 2.0
    c.setFillColor(white)
    c.setFont(chosen, L.SIZE_BADGE)
    c.drawString(x, y, text)
    c.setStrokeColor(white)
    c.setLineWidth(L.B_BADGE_UNDERLINE_W)
    c.setDash()
    underline_y = y - L.B_BADGE_UNDERLINE_DROP
    c.line(x, underline_y, x + w, underline_y)
    c.setFillColor(black)
    c.setStrokeColor(black)


# ---------------------------------------------------------------------------
# sections
# ---------------------------------------------------------------------------
def _section_receiver(c: rl_canvas.Canvas, o: OrderDTO) -> None:
    _barcode(c, L.A_BARCODE_X, L.A_BARCODE_Y, L.A_BARCODE_W, L.A_BARCODE_H, o.tracking_no)
    _draw(c, L.A_TRACKING_X, L.A_TRACKING_Y, o.tracking_no, L.FONT, L.SIZE_TRACKING)
    _rule(c, L.A_RULE_UNDER_BARCODE_X1, L.A_RULE_UNDER_BARCODE_Y, L.A_RULE_UNDER_BARCODE_X2)
    _vrule(c, L.A_GUTTER_X, L.A_GUTTER_TOP_Y, L.A_GUTTER_BOTTOM_Y)
    _vrule(c, L.A_QR_DIVIDER_X, L.A_QR_DIVIDER_TOP_Y, L.A_QR_DIVIDER_BOTTOM_Y)

    _draw_centred(c, L.A_GUTTER_CELL, L.A_TO_Y, L.TXT_TO, L.FONT, L.SIZE_GUTTER_LG)
    _draw_centred(
        c, L.A_GUTTER_CELL, L.A_TO_POSTCODE_Y, o.receiver_postcode,
        L.FONT, L.SIZE_GUTTER_LG,
    )

    _draw(c, L.A_NAME_X, L.A_NAME_Y, o.receiver_name, L.FONT, L.SIZE_BODY, L.A_NAME_MAX_W)
    _draw(c, L.A_PHONE_X, L.A_NAME_Y, mask(o.receiver_phone), L.FONT, L.SIZE_BODY)

    for i, line in enumerate(
        wrap(o.full_receiver_address, L.FONT, L.SIZE_BODY, L.A_ADDR_MAX_W, L.A_ADDR_LINES)
    ):
        _draw(c, L.A_ADDR_X, L.A_ADDR_Y - i * L.LEADING_BODY, line, L.FONT, L.SIZE_BODY)

    _qr_code(c, L.A_QR_X, L.A_QR_Y, L.A_QR_SIZE, o.tracking_no)
    _rule(c, L.A_RULE_MID_X1, L.A_RULE_MID_Y, L.A_RULE_MID_X2)

    _draw_centred(c, L.A_GUTTER_CELL, L.A_FROM_Y, L.TXT_FROM, L.FONT, L.SIZE_GUTTER_LG)
    _draw_centred(
        c, L.A_GUTTER_CELL, L.A_FROM_POSTCODE_Y, o.sender_postcode,
        L.FONT, L.SIZE_GUTTER_LG,
    )
    _draw(
        c, L.A_SENDER_NAME_X, L.A_SENDER_NAME_Y, o.sender_name,
        L.FONT, L.SIZE_BODY, L.A_SENDER_NAME_MAX_W,
    )
    _draw(
        c, L.A_SENDER_PHONE_X, L.A_SENDER_PHONE_Y, mask(o.sender_phone),
        L.FONT, L.SIZE_BODY,
    )

    _rule(c, L.A_RULE_ABOVE_STRIP_X1, L.A_RULE_ABOVE_STRIP_Y, L.A_RULE_ABOVE_STRIP_X2)
    _black_bar(c, L.A_STRIP_BAR_X, L.A_STRIP_BAR_Y, L.A_STRIP_BAR_W, L.A_STRIP_BAR_H)
    _bar_caption(c, L.A_STRIP_BAR_X, L.A_STRIP_BAR_W, L.A_STRIP_TEXT_Y, L.TXT_RECEIVER_COPY)
    _draw_centred(
        c, L.A_STRIP_WEIGHT_CELL, L.A_STRIP_LABEL_Y, o.weight_label, L.FONT, L.SIZE_STRIP
    )
    _draw_centred(
        c, L.A_STRIP_PAYMENT_CELL, L.A_STRIP_LABEL_Y, o.payment_type, L.FONT, L.SIZE_STRIP
    )
    _cut_line(c, L.CUT_A_B_X1, L.CUT_A_B_Y, L.CUT_A_B_X2)


def _section_dispatcher(c: rl_canvas.Canvas, o: OrderDTO) -> None:
    _draw_centred(
        c, (0.0, L.PAGE_W), L.B_SORTATION_Y, o.sortation_code, L.FONT, L.SIZE_SORTATION
    )
    _rule(c, L.B_RULE_UNDER_SORTATION_X1, L.B_RULE_UNDER_SORTATION_Y, L.B_RULE_UNDER_SORTATION_X2)

    _barcode(c, L.B_BARCODE_X, L.B_BARCODE_Y, L.B_BARCODE_W, L.B_BARCODE_H, o.tracking_no)
    _draw_right(c, L.B_ROUTE_RIGHT_X, L.B_ROUTE_Y, o.route_code, L.FONT, L.SIZE_ROUTE)
    _rule(c, L.B_RULE_UNDER_BARCODE_X1, L.B_RULE_UNDER_BARCODE_Y, L.B_RULE_UNDER_BARCODE_X2)

    _draw(c, L.B_DATE_X, L.B_DATE_Y, o.order_date, L.FONT, L.SIZE_DATE)
    _draw(c, L.B_TRACKING_X, L.B_TRACKING_Y, o.tracking_no, L.FONT, L.SIZE_TRACKING)

    _vrule(c, L.B_GUTTER_X, L.B_GUTTER_TOP_Y, L.B_GUTTER_BOTTOM_Y)
    _draw_centred(c, L.B_GUTTER_CELL, L.B_TO_Y, L.TXT_TO, L.FONT, L.SIZE_GUTTER_SM)
    _draw_centred(
        c, L.B_GUTTER_CELL, L.B_TO_POSTCODE_Y, o.receiver_postcode,
        L.FONT, L.SIZE_GUTTER_SM,
    )
    _draw(c, L.B_NAME_X, L.B_NAME_Y, o.receiver_name, L.FONT, L.SIZE_BODY, L.B_NAME_MAX_W)
    _draw(c, L.B_PHONE_X, L.B_NAME_Y, mask(o.receiver_phone), L.FONT, L.SIZE_BODY)
    for i, line in enumerate(
        wrap(o.full_receiver_address, L.FONT, L.SIZE_BODY, L.B_ADDR_MAX_W, L.B_ADDR_LINES)
    ):
        _draw(c, L.B_ADDR_X, L.B_ADDR_Y - i * L.LEADING_BODY, line, L.FONT, L.SIZE_BODY)
    _rule(c, L.B_RULE_UNDER_ADDR_X1, L.B_RULE_UNDER_ADDR_Y, L.B_RULE_UNDER_ADDR_X2)

    # service badge
    _black_bar(c, L.B_BADGE_X, L.B_BADGE_Y, L.B_BADGE_W, L.B_BADGE_H)
    _badge_line(c, L.B_BADGE_LINE1_Y, o.service_type)
    _badge_line(c, L.B_BADGE_LINE2_Y, o.service_scope)
    _service_glyph(c)
    _vrule(c, L.B_BADGE_DIVIDER_X, L.B_BADGE_DIVIDER_TOP_Y, L.B_BADGE_DIVIDER_BOTTOM_Y)

    _draw_centred(
        c, L.B_ADDR_TYPE_CELL, L.B_ADDR_TYPE_Y, o.address_type, L.FONT, L.SIZE_ADDR_TYPE
    )
    _rule(c, L.B_RULE_UNDER_TYPE_X1, L.B_RULE_UNDER_TYPE_Y, L.B_RULE_UNDER_TYPE_X2)
    _draw(c, L.B_COD_X, L.B_COD_Y, L.TXT_COD, L.FONT, L.SIZE_BODY)
    _draw(c, L.B_EZ_X, L.B_EZ_Y, L.TXT_EZ, L.FONT, L.SIZE_BODY)
    _rule(c, L.B_RULE_UNDER_BADGE_X1, L.B_RULE_UNDER_BADGE_Y, L.B_RULE_UNDER_BADGE_X2)

    _draw(
        c, L.B_PARCEL_LABEL_X, L.B_PARCEL_LABEL_Y, L.TXT_PARCEL_INFORMATION,
        L.FONT, L.SIZE_PARCEL_LABEL_B,
    )
    _draw(
        c, L.B_GOODS_X, L.B_GOODS_Y, o.goods_label_short,
        L.FONT, L.SIZE_BODY, L.B_GOODS_MAX_W,
    )

    _vrule(c, L.B_SIG_DIVIDER_X, L.B_SIG_DIVIDER_TOP_Y, L.B_SIG_DIVIDER_BOTTOM_Y)
    _draw(c, L.B_SIGNATURE_X, L.B_SIGNATURE_Y, L.TXT_SIGNATURE, L.FONT, L.SIZE_SIGNATURE)
    _draw(c, L.B_IC_X, L.B_IC_Y, L.TXT_IC, L.FONT, L.SIZE_BODY)
    _draw_centred(c, L.B_PAYMENT_CELL, L.B_PAYMENT_Y, o.payment_type, L.FONT, L.SIZE_BODY)

    _rule(c, L.B_RULE_ABOVE_LEGAL_X1, L.B_RULE_ABOVE_LEGAL_Y, L.B_RULE_ABOVE_LEGAL_X2)
    for i, line in enumerate(L.LEGAL_DISPATCHER):
        _draw(
            c, L.B_LEGAL_X, L.B_LEGAL_Y - i * L.B_LEGAL_LEADING, line,
            L.FONT_BOLD_ITALIC, L.SIZE_LEGAL_B,
        )

    _black_bar(c, L.B_BAR_X, L.B_BAR_Y, L.B_BAR_W, L.B_BAR_H)
    _bar_caption(c, L.B_BAR_X, L.B_BAR_W, L.B_BAR_TEXT_Y, L.TXT_DISPATCHER_COPY)
    _cut_line(c, L.CUT_B_C_X1, L.CUT_B_C_Y, L.CUT_B_C_X2)
    _rule(c, L.B_RULE_SECTION_END_X1, L.B_RULE_SECTION_END_Y, L.B_RULE_SECTION_END_X2)


def _section_sender(c: rl_canvas.Canvas, o: OrderDTO) -> None:
    _barcode(c, L.C_BARCODE_X, L.C_BARCODE_Y, L.C_BARCODE_W, L.C_BARCODE_H, o.tracking_no)
    _draw(c, L.C_TRACKING_X, L.C_TRACKING_Y, o.tracking_no, L.FONT, L.SIZE_TRACKING)
    _rule(c, L.C_RULE_UNDER_BARCODE_X1, L.C_RULE_UNDER_BARCODE_Y, L.C_RULE_UNDER_BARCODE_X2)
    _vrule(c, L.C_GUTTER_X, L.C_GUTTER_TOP_Y, L.C_GUTTER_BOTTOM_Y)

    _draw_centred(c, L.C_GUTTER_CELL, L.C_TO_Y, L.TXT_TO, L.FONT, L.SIZE_GUTTER_LG)
    _draw_centred(
        c, L.C_GUTTER_CELL, L.C_TO_POSTCODE_Y, o.receiver_postcode,
        L.FONT, L.SIZE_GUTTER_LG,
    )
    _draw(c, L.C_NAME_X, L.C_NAME_Y, o.receiver_name, L.FONT, L.SIZE_BODY, L.C_NAME_MAX_W)
    _draw(c, L.C_PHONE_X, L.C_NAME_Y, mask(o.receiver_phone), L.FONT, L.SIZE_BODY)
    for i, line in enumerate(
        wrap(o.full_receiver_address, L.FONT, L.SIZE_BODY, L.C_ADDR_MAX_W, L.C_ADDR_LINES)
    ):
        _draw(c, L.C_ADDR_X, L.C_ADDR_Y - i * L.LEADING_BODY, line, L.FONT, L.SIZE_BODY)
    _rule(c, L.C_RULE_MID_X1, L.C_RULE_MID_Y, L.C_RULE_MID_X2)

    _draw_centred(c, L.C_GUTTER_CELL, L.C_FROM_Y, L.TXT_FROM, L.FONT, L.SIZE_GUTTER_LG)
    _draw_centred(
        c, L.C_GUTTER_CELL, L.C_FROM_POSTCODE_Y, o.sender_postcode,
        L.FONT, L.SIZE_GUTTER_LG,
    )
    _draw(
        c, L.C_SENDER_NAME_X, L.C_SENDER_NAME_Y, o.sender_name,
        L.FONT, L.SIZE_BODY, L.C_SENDER_NAME_MAX_W,
    )
    _draw(
        c, L.C_SENDER_PHONE_X, L.C_SENDER_NAME_Y, mask(o.sender_phone),
        L.FONT, L.SIZE_BODY,
    )
    _draw(
        c, L.C_SENDER_ADDR_X, L.C_SENDER_ADDR_Y, o.full_sender_address,
        L.FONT, L.SIZE_BODY, L.C_SENDER_ADDR_MAX_W,
    )
    _rule(c, L.C_RULE_UNDER_FROM_X1, L.C_RULE_UNDER_FROM_Y, L.C_RULE_UNDER_FROM_X2)

    _draw_centred(c, L.C_STACK_CELL, L.C_DATE_Y, o.order_date, L.FONT, L.SIZE_DATE)
    _draw(
        c, L.C_PARCEL_LABEL_X, L.C_PARCEL_LABEL_Y, L.TXT_PARCEL_INFORMATION,
        L.FONT, L.SIZE_PARCEL_LABEL_C,
    )
    _draw(c, L.C_GOODS_X, L.C_GOODS_Y, o.goods_label, L.FONT, L.SIZE_BODY, L.C_GOODS_MAX_W)

    _rule(c, L.C_RULE_GUTTER_1_X1, L.C_RULE_GUTTER_1_Y, L.C_RULE_GUTTER_1_X2)
    _draw_centred(c, L.C_STACK_CELL, L.C_PAYMENT_Y, o.payment_type, L.FONT, L.SIZE_BODY)

    c.setLineWidth(L.RULE_W)
    c.setDash()
    c.line(L.C_SLANT_X1, L.C_SLANT_Y1, L.C_SLANT_X2, L.C_SLANT_Y2)

    _rule(c, L.C_RULE_GUTTER_2_X1, L.C_RULE_GUTTER_2_Y, L.C_RULE_GUTTER_2_X2)
    remarks = f"{L.TXT_REMARKS} {o.remark}".rstrip() if o.remark else L.TXT_REMARKS
    _draw(
        c, L.C_REMARKS_X, L.C_REMARKS_Y, remarks,
        L.FONT, L.SIZE_REMARKS, L.C_GOODS_MAX_W,
    )
    _draw_centred(c, L.C_STACK_CELL, L.C_WEIGHT_Y, o.weight_label, L.FONT, L.SIZE_WEIGHT_C)

    _rule(c, L.C_RULE_ABOVE_LEGAL_X1, L.C_RULE_ABOVE_LEGAL_Y, L.C_RULE_ABOVE_LEGAL_X2)
    for i, line in enumerate(L.LEGAL_SENDER):
        _draw(
            c, L.C_LEGAL_X, L.C_LEGAL_Y - i * L.C_LEGAL_LEADING, line,
            L.FONT_BOLD_ITALIC, L.SIZE_LEGAL_C,
        )
    _rule(c, L.C_RULE_ABOVE_BAR_X1, L.C_RULE_ABOVE_BAR_Y, L.C_RULE_ABOVE_BAR_X2)
    _black_bar(c, L.C_BAR_X, L.C_BAR_Y, L.C_BAR_W, L.C_BAR_H)
    _bar_caption(c, L.C_BAR_X, L.C_BAR_W, L.C_BAR_TEXT_Y, L.TXT_SENDER_COPY)


def _page_border(c: rl_canvas.Canvas) -> None:
    c.setLineWidth(L.RULE_W)
    c.setDash()
    c.line(0.0, L.BORDER_TOP_Y, L.PAGE_W, L.BORDER_TOP_Y)
    c.line(L.BORDER_LEFT_X, L.PAGE_H + 1.0, L.BORDER_LEFT_X, 1.0)
    c.line(L.BORDER_RIGHT_X, L.PAGE_H, L.BORDER_RIGHT_X, 0.0)
    c.line(1.0, L.BORDER_BOTTOM_Y, L.PAGE_W - 2.0, L.BORDER_BOTTOM_Y)


# ---------------------------------------------------------------------------
# public entry point
# ---------------------------------------------------------------------------
def render_waybill(order: OrderDTO | dict, out_path: str | Path) -> Path:
    """Render one waybill to *out_path* and return the path actually written."""
    o = order if isinstance(order, OrderDTO) else OrderDTO.from_dict(order)
    path = Path(out_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    register_fonts()

    c = rl_canvas.Canvas(str(path), pagesize=L.PAGE_SIZE, invariant=1, pageCompression=1)
    c.setTitle(o.tracking_no)
    c.setAuthor("J&T Express (Malaysia) Sdn Bhd")
    c.setSubject(o.customer_order_no or o.tracking_no)
    c.setCreator("jt-clone waybill renderer")

    c.setStrokeColor(black)
    c.setFillColor(black)

    if o.cod_amount and float(o.cod_amount) > 0:
        _watermark(c)

    _page_border(c)
    _section_receiver(c, o)
    _section_dispatcher(c, o)
    _section_sender(c, o)

    c.showPage()
    c.save()
    return path
