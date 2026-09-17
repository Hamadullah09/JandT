"""Every coordinate on the waybill, as a named constant.

All values were measured off the reference artefact ``OrderNo_12808.pdf`` by
decoding its content stream (text matrices, ``re``/``m``/``l`` operators and
XObject placements) and cross-checking against a 4x raster of the same page.

Coordinate system is ReportLab's native one: origin **bottom-left**, units are
points, page is 280 x 510.  ``*_Y`` values are text **baselines**, matching both
the reference's ``Tm`` operands and ``canvas.drawString``.

The renderer contains no numeric literals - if a position looks wrong, it is
wrong here.
"""
from __future__ import annotations

# ---------------------------------------------------------------------------
# page
# ---------------------------------------------------------------------------
PAGE_W = 280.0
PAGE_H = 510.0
PAGE_SIZE = (PAGE_W, PAGE_H)

BORDER_LEFT_X = 0.5
BORDER_RIGHT_X = 279.5
BORDER_TOP_Y = 509.5
BORDER_BOTTOM_Y = 1.5

RULE_W = 1.0
CUT_W = 0.5
CUT_DASH = (2.5, 1.5)

# ---------------------------------------------------------------------------
# fonts  (Helvetica is metrically equivalent to the reference's Arial;
#         DejaVuSans is registered at runtime as a non-Latin fallback)
# ---------------------------------------------------------------------------
FONT = "Helvetica"
FONT_BOLD = "Helvetica-Bold"
FONT_BOLD_ITALIC = "Helvetica-BoldOblique"

SIZE_TRACKING = 8.0
SIZE_GUTTER_LG = 9.0          # TO / FROM / postcode on receiver + sender copies
SIZE_GUTTER_SM = 7.0          # TO / postcode on the dispatcher copy
SIZE_BODY = 7.0               # names, phones, addresses, goods
SIZE_DATE = 6.0
SIZE_STRIP = 5.0              # receiver-copy bottom strip
SIZE_COPYNAME = 8.0           # white text in the black bars
SIZE_SORTATION = 24.0
SIZE_ROUTE = 24.0
SIZE_ADDR_TYPE = 10.0         # HOME / OFFICE
SIZE_SIGNATURE = 8.0
SIZE_PARCEL_LABEL_B = 7.0
SIZE_PARCEL_LABEL_C = 5.0
SIZE_REMARKS = 5.0
SIZE_GOODS_MIN = 5.0          # an item list shrinks to this before "+N more"
SIZE_WEIGHT_C = 8.0
SIZE_LEGAL_B = 5.0
SIZE_LEGAL_C = 4.0
SIZE_BADGE = 13.0

LEADING_BODY = 9.235          # measured gap between wrapped address lines

# ---------------------------------------------------------------------------
# SECTION A - RECEIVER COPY   (y 379 .. 510)
# ---------------------------------------------------------------------------
A_BARCODE_X = 79.25
A_BARCODE_Y = 482.0
A_BARCODE_W = 105.75
A_BARCODE_H = 22.0

A_TRACKING_X = 220.74
A_TRACKING_Y = 485.31

A_RULE_UNDER_BARCODE_Y = 481.5
A_RULE_UNDER_BARCODE_X1 = 0.0
A_RULE_UNDER_BARCODE_X2 = 279.0
A_GUTTER_X = 40.5             # vertical divider, y 380 -> 481
A_GUTTER_TOP_Y = 481.0
A_GUTTER_BOTTOM_Y = 380.0
A_QR_DIVIDER_X = 199.5        # vertical divider, y 389 -> 481
A_QR_DIVIDER_TOP_Y = 481.0
A_QR_DIVIDER_BOTTOM_Y = 389.0

# Everything in a TO/FROM gutter is centred in its cell - verified against the
# reference for all nine gutter strings (TO, FROM and the four postcodes).
A_GUTTER_CELL = (0.0, 40.5)
A_TO_Y = 467.92
A_TO_POSTCODE_Y = 447.42

A_NAME_X = 41.0
A_NAME_Y = 472.21
A_PHONE_X = 106.75            # measured: masked phone column
A_NAME_MAX_W = A_PHONE_X - A_NAME_X - 4.0

A_ADDR_X = 41.0
A_ADDR_Y = 461.59
A_ADDR_MAX_W = 158.0          # up to the QR divider
A_ADDR_LINES = 3

A_QR_X = 196.62
A_QR_Y = 395.62
A_QR_SIZE = 82.76
QR_LEVEL = "M"                            # error correction
QR_BORDER = 4                            # quiet-zone modules on every side

A_RULE_MID_Y = 417.5          # x 0 -> 200 only (QR occupies the right)
A_RULE_MID_X1 = 0.0
A_RULE_MID_X2 = 200.0

A_FROM_Y = 407.42
A_FROM_POSTCODE_Y = 394.92
A_SENDER_NAME_X = 42.0
A_SENDER_NAME_Y = 409.21
A_SENDER_PHONE_X = 43.0
A_SENDER_PHONE_Y = 399.21
A_SENDER_NAME_MAX_W = 155.0

A_RULE_ABOVE_STRIP_Y = 388.5
A_RULE_ABOVE_STRIP_X1 = 1.0
A_RULE_ABOVE_STRIP_X2 = 279.0

A_STRIP_BAR_X = 41.0
A_STRIP_BAR_Y = 379.0
A_STRIP_BAR_W = 189.0
A_STRIP_BAR_H = 10.0
A_STRIP_TEXT_Y = 381.10
A_STRIP_WEIGHT_CELL = (0.0, 41.0)        # centred
A_STRIP_PAYMENT_CELL = (230.0, 279.0)    # centred
A_STRIP_LABEL_Y = 382.51

CUT_A_B_Y = 379.5
CUT_A_B_X1 = 1.0
CUT_A_B_X2 = 280.0

# ---------------------------------------------------------------------------
# SECTION B - DISPATCHER COPY  (y 190 .. 379)
# ---------------------------------------------------------------------------
B_SORTATION_Y = 348.44                   # centred across the page
B_RULE_UNDER_SORTATION_Y = 338.5
B_RULE_UNDER_SORTATION_X1 = 0.0
B_RULE_UNDER_SORTATION_X2 = 281.0

B_BARCODE_X = 63.75
B_BARCODE_Y = 315.0
B_BARCODE_W = 154.50
B_BARCODE_H = 23.0

B_ROUTE_RIGHT_X = 272.25                 # right-aligned
B_ROUTE_Y = 311.94

B_RULE_UNDER_BARCODE_Y = 302.5
B_RULE_UNDER_BARCODE_X1 = 1.0
B_RULE_UNDER_BARCODE_X2 = 279.0

B_DATE_X = 6.34
B_DATE_Y = 304.57
B_TRACKING_X = 125.87
B_TRACKING_Y = 306.81

B_GUTTER_X = 42.5
B_GUTTER_TOP_Y = 303.0
B_GUTTER_BOTTOM_Y = 270.0

B_GUTTER_CELL = (1.0, 42.5)
B_TO_Y = 293.21
B_TO_POSTCODE_Y = 277.71

B_NAME_X = 43.0
B_NAME_Y = 293.21
B_PHONE_X = 108.75
B_NAME_MAX_W = B_PHONE_X - B_NAME_X - 4.0

B_ADDR_X = 43.0
B_ADDR_Y = 282.59
B_ADDR_MAX_W = 234.0
B_ADDR_LINES = 2

B_RULE_UNDER_ADDR_Y = 269.5
B_RULE_UNDER_ADDR_X1 = 1.0
B_RULE_UNDER_ADDR_X2 = 280.0

# service badge
B_BADGE_X = 1.0
B_BADGE_Y = 236.0
B_BADGE_W = 159.0
B_BADGE_H = 33.0
B_BADGE_TEXT_CX = 73.5                   # measured centre of NORMAL / SAME CITY
B_BADGE_LINE1_Y = 260.75
B_BADGE_LINE2_Y = 244.25
B_BADGE_UNDERLINE_DROP = 2.2
B_BADGE_UNDERLINE_W = 1.0
B_GLYPH_CX = 134.0
B_GLYPH_CY = 252.5
B_GLYPH_W = 22.0
B_GLYPH_H = 21.0

B_BADGE_DIVIDER_X = 160.5
B_BADGE_DIVIDER_TOP_Y = 269.0
B_BADGE_DIVIDER_BOTTOM_Y = 236.0

B_ADDR_TYPE_CELL = (161.0, 279.0)        # centred
B_ADDR_TYPE_Y = 256.02

B_RULE_UNDER_TYPE_Y = 250.5
B_RULE_UNDER_TYPE_X1 = 161.0
B_RULE_UNDER_TYPE_X2 = 279.0

B_COD_X = 191.65
B_COD_Y = 241.21
B_EZ_X = 268.82
B_EZ_Y = 241.21

B_RULE_UNDER_BADGE_Y = 236.5
B_RULE_UNDER_BADGE_X1 = 0.0
B_RULE_UNDER_BADGE_X2 = 279.0

B_PARCEL_LABEL_X = 5.0
B_PARCEL_LABEL_Y = 227.21
B_GOODS_X = 5.0
B_GOODS_Y = 216.59
B_GOODS_MAX_W = 163.0                    # up to the signature divider

B_SIG_DIVIDER_X = 170.5
B_SIG_DIVIDER_TOP_Y = 237.0
B_SIG_DIVIDER_BOTTOM_Y = 190.0

B_SIGNATURE_X = 173.0
B_SIGNATURE_Y = 226.81
B_IC_X = 173.0
B_IC_Y = 215.21
B_PAYMENT_CELL = (236.0, 279.0)
B_PAYMENT_Y = 215.21

B_RULE_ABOVE_LEGAL_Y = 210.5
B_RULE_ABOVE_LEGAL_X1 = 0.0
B_RULE_ABOVE_LEGAL_X2 = 279.0

B_LEGAL_X = 6.0
B_LEGAL_Y = 204.68
B_LEGAL_LEADING = 6.0

B_BAR_X = 171.0
B_BAR_Y = 190.0
B_BAR_W = 108.0
B_BAR_H = 20.0
B_BAR_TEXT_Y = 197.10

CUT_B_C_Y = 190.5
CUT_B_C_X1 = 1.0
CUT_B_C_X2 = 176.0

B_RULE_SECTION_END_Y = 186.5
B_RULE_SECTION_END_X1 = 1.0
B_RULE_SECTION_END_X2 = 280.0

# COD watermark - rotated bounding box measured off the reference raster
WM_TEXT = "COD"
WM_SIZE = 60.0
WM_ANGLE = 20.0
WM_CX = 142.5
WM_CY = 264.0
WM_GREY = 0.784                          # #C8C8C8 (reference: #808080 @ ~40% alpha)

# ---------------------------------------------------------------------------
# SECTION C - SENDER COPY  (y 1 .. 186)
# ---------------------------------------------------------------------------
C_BARCODE_X = 63.25
C_BARCODE_Y = 152.0
C_BARCODE_W = 160.0
C_BARCODE_H = 20.0

C_TRACKING_X = 120.87
C_TRACKING_Y = 143.31

C_RULE_UNDER_BARCODE_Y = 139.5
C_RULE_UNDER_BARCODE_X1 = 0.0
C_RULE_UNDER_BARCODE_X2 = 279.0
C_GUTTER_X = 42.5
C_GUTTER_TOP_Y = 139.0
C_GUTTER_BOTTOM_Y = 12.0

C_GUTTER_CELL = (1.0, 42.5)
C_TO_Y = 127.92
C_TO_POSTCODE_Y = 106.42

C_NAME_X = 43.0
C_NAME_Y = 130.21
C_PHONE_X = 208.0
C_NAME_MAX_W = C_PHONE_X - C_NAME_X - 4.0

C_ADDR_X = 44.0
C_ADDR_Y = 119.59
C_ADDR_MAX_W = 233.0
C_ADDR_LINES = 2

C_RULE_MID_Y = 102.5
C_RULE_MID_X1 = 1.0
C_RULE_MID_X2 = 279.0

C_FROM_Y = 92.42
C_FROM_POSTCODE_Y = 75.92
C_SENDER_NAME_X = 44.0
C_SENDER_NAME_Y = 94.71
C_SENDER_PHONE_X = 208.0
C_SENDER_NAME_MAX_W = C_SENDER_PHONE_X - C_SENDER_NAME_X - 4.0
C_SENDER_ADDR_X = 44.0
C_SENDER_ADDR_Y = 84.59
C_SENDER_ADDR_MAX_W = 233.0

C_RULE_UNDER_FROM_Y = 70.5
C_RULE_UNDER_FROM_X1 = 0.0
C_RULE_UNDER_FROM_X2 = 279.0

C_STACK_CELL = (0.0, 42.0)
C_DATE_Y = 59.61
C_PARCEL_LABEL_X = 46.0
C_PARCEL_LABEL_Y = 64.51
C_GOODS_X = 44.0
C_GOODS_Y = 55.59
C_GOODS_MAX_W = 233.0

C_RULE_GUTTER_1_Y = 53.5                 # x 0 -> 42
C_RULE_GUTTER_1_X1 = 0.0
C_RULE_GUTTER_1_X2 = 42.0

C_PAYMENT_Y = 40.71

# the reference draws this divider very slightly off-level
C_SLANT_X1, C_SLANT_Y1 = 43.0, 41.0
C_SLANT_X2, C_SLANT_Y2 = 279.0, 39.0

C_RULE_GUTTER_2_Y = 33.5                 # x 1 -> 42
C_RULE_GUTTER_2_X1 = 1.0
C_RULE_GUTTER_2_X2 = 42.0

C_REMARKS_X = 45.0
C_REMARKS_Y = 29.51
C_WEIGHT_Y = 24.31

C_RULE_ABOVE_LEGAL_Y = 22.5
C_RULE_ABOVE_LEGAL_X1 = 0.0
C_RULE_ABOVE_LEGAL_X2 = 279.0

C_LEGAL_X = 3.0
C_LEGAL_Y = 18.35
C_LEGAL_LEADING = 4.6

C_RULE_ABOVE_BAR_Y = 11.5
C_RULE_ABOVE_BAR_X1 = 0.0
C_RULE_ABOVE_BAR_X2 = 279.0

C_BAR_X = 0.0
C_BAR_Y = 1.0
C_BAR_W = 279.0
C_BAR_H = 10.0
C_BAR_TEXT_Y = 3.10

# ---------------------------------------------------------------------------
# static strings (reproduced verbatim from the reference)
# ---------------------------------------------------------------------------
TXT_TO = "TO"
TXT_FROM = "FROM"
TXT_RECEIVER_COPY = "Receiver Copy"
TXT_DISPATCHER_COPY = "Dispatcher Copy"
TXT_SENDER_COPY = "Sender Copy"
TXT_PARCEL_INFORMATION = "Parcel  Information"   # two spaces, as printed
TXT_SIGNATURE = "Signature"
TXT_IC = " IC"                                   # leading space, as printed
TXT_COD = "COD"
TXT_EZ = "EZ"
TXT_REMARKS = "Remarks:"

LEGAL_DISPATCHER = (
    "By signing this package, receiver confirms all of the information",
    "of the customer and parcel are true, and understand and agree",
    "to all the rules and regulation of using J&T Express",
)

LEGAL_SENDER = (
    "This invoice services provided by J&T Express (Malaysia) Sdn Bhd is "
    "subjected to T&C of Services and Deliveries and Insurance Coverage for",
    "Parcel as stated in the Official Website",
)
