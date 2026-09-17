"""Request/response models.  Every API boundary is typed (harness rule H9)."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    computed_field,
    field_validator,
    model_validator,
)


class SenderProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    account_code: str
    company_name: str
    phone: str
    postcode: str
    state: str
    address: str
    payment_type: str
    default_service: str


class SenderProfileIn(BaseModel):
    company_name: str = Field(min_length=1, max_length=128)
    phone: str = Field(min_length=3, max_length=32)
    postcode: str = Field(pattern=r"^\d{5}$")
    state: str = Field(min_length=1, max_length=128)
    address: str = Field(min_length=5, max_length=500)
    account_code: str | None = Field(default=None, max_length=32)
    payment_type: str | None = Field(default=None, max_length=16)
    default_service: str | None = Field(default=None, max_length=24)


class OrderItemIn(BaseModel):
    """One line of a parcel's contents."""

    goods_name: str = Field(min_length=1, max_length=255)
    item_variant: str = Field(default="", max_length=32)
    quantity: int = Field(default=1, ge=1)
    #: the supplier holds this item (a paid order of only these goes to them)
    dropship: bool = False


class NormalOrderIn(BaseModel):
    """The Normal Order form.  The sender is never supplied by the client.

    ``items`` lists every item in the parcel.  When it is empty, the order is
    the single item in ``goods_name`` / ``item_variant`` / ``quantity``, as
    before items existed.
    """

    receiver_name: str = Field(min_length=1, max_length=60)
    receiver_phone: str = Field(min_length=3, max_length=32)
    receiver_postcode: str = Field(pattern=r"^\d{5}$")
    receiver_address: str = Field(min_length=5, max_length=200)
    receiver_city: str = ""
    receiver_state: str = ""
    address_type: Literal["HOME", "OFFICE"] = "HOME"

    goods_type: Literal["PARCEL", "DOCUMENT"] = "PARCEL"
    goods_name: str = Field(min_length=1, max_length=255)
    # orders.item_variant is VARCHAR(32): longer failed the insert with a 500
    item_variant: str = Field(default="", max_length=32)
    quantity: int = Field(default=1, ge=1)
    items: list[OrderItemIn] = Field(default_factory=list)
    actual_weight: Decimal = Field(gt=0, le=30)
    length_cm: Decimal = Field(default=Decimal("0"), ge=0)
    width_cm: Decimal = Field(default=Decimal("0"), ge=0)
    height_cm: Decimal = Field(default=Decimal("0"), ge=0)
    #: Optional manual override; otherwise max(actual, volumetric) rounded up.
    chargeable_weight: Decimal | None = Field(default=None, gt=0)

    # Required: order numbers are how orders are found, deleted and re-posted,
    # and how a duplicate is caught.  VARCHAR(64), like a CSV's order_no.
    customer_order_no: str = Field(max_length=64)
    cod_amount: Decimal = Field(default=Decimal("0"), ge=0)
    order_value: Decimal = Field(default=Decimal("0"), ge=0)
    order_payment_type: Literal["PREPAID", "COD"] = "PREPAID"
    #: how the parcel reaches J&T: a courier collects it, or it is dropped off
    service_mode: Literal["PICK_UP", "DROP_OFF"] = "PICK_UP"
    #: where the order came from: Website, Daraz, Amazon...
    source: str = Field(default="Website", max_length=64)
    remark: str = ""
    output_dir: str | None = None

    @field_validator("customer_order_no")
    @classmethod
    def _order_no_required(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Customer Order Number is required")
        return v

    @model_validator(mode="after")
    def _cod_needs_an_amount(self) -> "NormalOrderIn":
        """A COD parcel with nothing to collect is a mistake, not a prepaid one."""
        if self.order_payment_type == "COD" and self.cod_amount <= 0:
            raise ValueError("COD Amount must be more than 0 when COD Value is Yes")
        if self.order_payment_type == "PREPAID":
            self.cod_amount = Decimal("0")
        return self


class OrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    tracking_no: str
    customer_order_no: str | None
    receiver_name: str
    receiver_phone: str
    receiver_postcode: str
    receiver_city: str | None
    receiver_state: str
    receiver_address: str
    address_type: str
    goods_type: str
    goods_name: str | None
    item_variant: str | None
    quantity: int
    items: list[dict[str, Any]] | None = None
    service_mode: str | None = None
    source: str = "Website"
    actual_weight: Decimal
    volumetric_weight: Decimal
    chargeable_weight: Decimal
    service_type: str
    service_scope: str | None
    sortation_code: str | None
    route_code: str | None
    payment_type: str
    order_payment_type: str | None
    cod_amount: Decimal
    order_value: Decimal
    freight_fee: Decimal | None
    remark: str | None
    waybill_filename: str | None
    waybill_path: str | None
    order_date: date | None
    status: str
    batch_id: int | None
    created_at: datetime
    tracking_status: str = "CREATED"
    tracking_updated_at: datetime | None = None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def waybill_url(self) -> str:
        return f"/api/v1/waybills/{self.tracking_no}.pdf"


class OrderCreatedOut(BaseModel):
    tracking_no: str
    sortation_code: str | None
    route_code: str | None
    waybill_url: str
    freight_fee: Decimal | None
    order: OrderOut


class QuoteIn(BaseModel):
    """A draft parcel, for the live totals on the Normal Order footer."""

    receiver_postcode: str = ""
    receiver_state: str = ""
    goods_type: Literal["PARCEL", "DOCUMENT"] = "PARCEL"
    actual_weight: Decimal = Decimal("0")
    length_cm: Decimal = Decimal("0")
    width_cm: Decimal = Decimal("0")
    height_cm: Decimal = Decimal("0")
    chargeable_weight: Decimal | None = None
    cod_amount: Decimal = Decimal("0")
    item_value: Decimal = Decimal("0")


class QuoteOut(BaseModel):
    volumetric_weight: Decimal
    chargeable_weight: Decimal
    service_scope: str
    #: shipping + COD fee before tax - what orders.freight_fee stores
    freight_fee: Decimal
    # the Chargeable Information section, see app/core/pricing.py FeeBreakdown
    base_shipping_fee: Decimal
    base_price_tax: Decimal
    discounted_shipping_fee: Decimal
    discounted_tax: Decimal
    cod_fee: Decimal
    cod_tax: Decimal
    cod_handling_fee: Decimal
    insurance_fee: Decimal | None = None
    total_sst: Decimal
    total_shipping_fee: Decimal


class OrderPage(BaseModel):
    items: list[OrderOut]
    page: int
    size: int
    total: int
    pages: int


# ---------------------------------------------------------------------------
# bulk
# ---------------------------------------------------------------------------
class RowError(BaseModel):
    row_no: int
    status: str
    field: str | None = None
    message: str | None = None


class BulkRowOut(BaseModel):
    """One staged row, shaped for the grid."""

    id: int
    row_no: int
    status: str
    error_field: str | None = None
    error_message: str | None = None
    tracking_no: str | None = None
    data: dict[str, Any] = Field(default_factory=dict)
    raw: dict[str, Any] = Field(default_factory=dict)


class BulkUploadOut(BaseModel):
    batch_id: int
    filename: str
    total: int
    ok: int
    errors: int
    warnings: list[str] = Field(default_factory=list)
    rows: list[BulkRowOut] = Field(default_factory=list)
    row_errors: list[RowError] = Field(default_factory=list)


class BulkCommitIn(BaseModel):
    output_dir: str
    row_ids: list[int] | None = None
    merge_pdf: bool | None = None


class PackingFileOut(BaseModel):
    """One packing PDF: every label of one product, ready to print."""

    title: str
    orders: int
    pieces: int
    url: str


class BulkCommitOut(BaseModel):
    batch_id: int
    total: int
    created: int
    failed: int
    duplicates: int
    duration_ms: int
    output_dir: str
    manifest_path: str | None = None
    errors_path: str | None = None
    merged_path: str | None = None
    manifest_url: str
    zip_url: str
    row_errors: list[RowError] = Field(default_factory=list)
    #: WhatsApp group messages queued for the new orders (0 when WhatsApp is off)
    whatsapp_queued: int = 0
    whatsapp_to_dropship: int = 0
    #: one PDF per product, e.g. "Embroidered Maxi Chic - 25 orders.pdf"
    packing_files: list[PackingFileOut] = Field(default_factory=list)
    #: paid all-drop-ship orders, left out of the packing PDFs
    packing_left_out: int = 0


class BulkProgressOut(BaseModel):
    batch_id: int
    stage: str
    status: str
    processed: int
    total: int
    percent: float
    eta_ms: int | None = None


class DeleteRowsIn(BaseModel):
    row_ids: list[int]


class DeleteRowsOut(BaseModel):
    deleted: int


class OutputDirCheckIn(BaseModel):
    output_dir: str


class OutputDirCheckOut(BaseModel):
    ok: bool
    resolved: str | None = None
    message: str | None = None


# ---------------------------------------------------------------------------
# address: smart filling and the postcode check
# ---------------------------------------------------------------------------
class AddressCheckIn(BaseModel):
    postcode: str = ""
    state: str = ""
    city: str = ""


class AddressCheckOut(BaseModel):
    postcode: str
    #: the postcode is on the post-office list
    known: bool
    #: the postcode's state and post-office town(s), to fill in blanks
    state: str = ""
    city: str = ""
    cities: list[str] = Field(default_factory=list)
    ok: bool
    #: receiver_state or receiver_city - what does not match the postcode
    field: str | None = None
    message: str | None = None
    #: the postcode is not on the list at all - shown, but the order may go ahead
    notice: str | None = None
    #: postcodes of the city and state that were entered, closest first
    suggestions: list[str] = Field(default_factory=list)
    suggestions_total: int = 0
    suggestions_for: str = ""


class AddressParseIn(BaseModel):
    text: str = Field(default="", max_length=2000)


class AddressParseOut(BaseModel):
    name: str
    phone: str
    postcode: str
    city: str
    state: str
    address: str
    check: AddressCheckOut


# ---------------------------------------------------------------------------
# track & trace
# ---------------------------------------------------------------------------
class EventTypeOut(BaseModel):
    code: str
    label: str
    status: str
    template: str
    without_location: str


class TrackingEventOut(BaseModel):
    #: None for the "Order Created" line, which is the order itself
    id: int | None
    event_type: str
    label: str
    location: str
    description: str
    occurred_at: datetime
    date_label: str
    time_label: str


class TrackingDayOut(BaseModel):
    date_label: str
    events: list[TrackingEventOut]


class TrackingStepOut(BaseModel):
    key: str
    label: str
    reached: bool


class TrackingOut(BaseModel):
    """One waybill on the public tracking page - no names or addresses."""

    tracking_no: str
    found: bool
    status: str | None = None
    status_label: str | None = None
    #: hidden on the public tracking page
    origin: str = "***"
    destination: str = "***"
    steps: list[TrackingStepOut] = Field(default_factory=list)
    days: list[TrackingDayOut] = Field(default_factory=list)


class TrackingUpdateIn(BaseModel):
    """A status update for one or several parcels (the dashboard's bulk bar)."""

    tracking_nos: list[str] = Field(min_length=1, max_length=500)
    event_type: str
    location: str = Field(default="", max_length=128)
    #: blank: J&T's wording for the event type and location
    description: str = Field(default="", max_length=500)
    #: blank: now.  A time without a zone is Malaysia time.
    occurred_at: datetime | None = None


class TrackingUpdateOut(BaseModel):
    updated: int
    not_found: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# admin portal
# ---------------------------------------------------------------------------
class AdminLastEventOut(BaseModel):
    label: str
    location: str
    occurred_at: datetime


class AdminOrderOut(BaseModel):
    id: int
    tracking_no: str
    customer_order_no: str | None
    created_at: datetime
    receiver_name: str
    receiver_phone: str
    receiver_postcode: str
    receiver_city: str | None
    receiver_state: str
    receiver_address: str
    items: list[dict[str, Any]]
    pieces: int
    order_payment_type: str | None
    cod_amount: Decimal
    order_value: Decimal
    freight_fee: Decimal | None
    chargeable_weight: Decimal
    #: paid and every item drop-shipped: the supplier sends it
    supplier_ships: bool
    source: str
    tracking_status: str
    status_label: str
    tracking_updated_at: datetime | None
    last_event: AdminLastEventOut | None = None
    tracking_url: str
    waybill_url: str


class SourceCountOut(BaseModel):
    name: str
    count: int


class AdminOrderPage(BaseModel):
    items: list[AdminOrderOut]
    page: int
    size: int
    total: int
    pages: int
    #: orders per status for the current search, date range and source
    counts: dict[str, int]
    #: orders per source for the current search, date range and status - every
    #: known source in display order (zero counts included), then any others
    sources: list[SourceCountOut]
    today: int
    #: the highest order id, to spot orders created since the last look
    newest_id: int


class CalendarDayOut(BaseModel):
    """One day of the admin calendar, in Malaysia time."""

    day: date
    #: orders created that day
    orders: int
    #: those orders by their status now
    statuses: dict[str, int]
    #: cash to collect for that day's COD orders
    cod_amount: Decimal
    #: parcels delivered / returned that day, whenever they were ordered
    delivered: int
    returned: int


class CalendarOut(BaseModel):
    #: "2026-09"
    month: str
    #: today in Malaysia, to highlight it
    today: date
    days: list[CalendarDayOut]
    total_orders: int
    total_delivered: int
    total_returned: int
    #: orders created this month per source, for the source filter
    sources: list[SourceCountOut]


class AdminOrderDetailOut(BaseModel):
    order: AdminOrderOut
    events: list[TrackingEventOut]


# ---------------------------------------------------------------------------
# login, sign-up and accounts
# ---------------------------------------------------------------------------
class LoginIn(BaseModel):
    #: a username, phone number or email
    login: str = Field(default="", max_length=254)
    password: str = Field(default="", max_length=128)


class MeOut(BaseModel):
    username: str
    name: str
    role: str
    #: the shop the portal belongs to, for the top bar: "JTMY027288"
    account_code: str | None = None
    company_name: str | None = None


class SignupIn(BaseModel):
    """Checked by the endpoint itself, so each problem gets a plain message."""

    name: str = Field(default="", max_length=128)
    username: str = Field(default="", max_length=64)
    phone: str = Field(default="", max_length=32)
    email: str = Field(default="", max_length=254)
    password: str = Field(default="", max_length=128)
    confirm_password: str = Field(default="", max_length=128)


class SignupOut(BaseModel):
    username: str
    status: str
    message: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    name: str
    phone: str | None
    email: str | None
    role: str
    status: str
    created_at: datetime
    last_login_at: datetime | None


class UserCreateIn(BaseModel):
    """An account the admin makes: active at once, no approval needed."""

    name: str = Field(default="", max_length=128)
    username: str = Field(default="", max_length=64)
    phone: str = Field(default="", max_length=32)
    email: str = Field(default="", max_length=254)
    password: str = Field(default="", max_length=128)
    role: Literal["admin", "merchant"] = "merchant"


class UserUpdateIn(BaseModel):
    #: active (approve / unblock) or blocked
    status: Literal["active", "blocked"] | None = None
    #: a new password, when resetting it
    password: str | None = Field(default=None, max_length=128)
