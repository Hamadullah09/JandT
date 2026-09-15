"""Request/response models.  Every API boundary is typed (harness rule H9)."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, computed_field


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


class NormalOrderIn(BaseModel):
    """The Normal Order form.  The sender is never supplied by the client."""

    receiver_name: str = Field(min_length=1, max_length=60)
    receiver_phone: str = Field(min_length=3, max_length=32)
    receiver_postcode: str = Field(pattern=r"^\d{5}$")
    receiver_address: str = Field(min_length=5, max_length=200)
    receiver_city: str = ""
    receiver_state: str = ""
    address_type: Literal["HOME", "OFFICE"] = "HOME"

    goods_type: Literal["PARCEL", "DOCUMENT"] = "PARCEL"
    goods_name: str = Field(min_length=1, max_length=255)
    item_variant: str = ""
    quantity: int = Field(default=1, ge=1)
    actual_weight: Decimal = Field(gt=0, le=30)
    length_cm: Decimal = Field(default=Decimal("0"), ge=0)
    width_cm: Decimal = Field(default=Decimal("0"), ge=0)
    height_cm: Decimal = Field(default=Decimal("0"), ge=0)
    #: Optional manual override; otherwise max(actual, volumetric) rounded up.
    chargeable_weight: Decimal | None = Field(default=None, gt=0)

    customer_order_no: str = ""
    cod_amount: Decimal = Field(default=Decimal("0"), ge=0)
    order_value: Decimal = Field(default=Decimal("0"), ge=0)
    order_payment_type: Literal["PREPAID", "COD"] = "PREPAID"
    remark: str = ""
    output_dir: str | None = None


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


class QuoteOut(BaseModel):
    volumetric_weight: Decimal
    chargeable_weight: Decimal
    service_scope: str
    freight_fee: Decimal


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
