"""The bulk-import CSV contract.

Derived from the **real** production file supplied with the spec
(``bulk_orders.csv``), whose header row is::

    order_no, receiver_name, receiver_phone, receiver_postcode, receiver_city,
    receiver_state, receiver_address, address_type, goods_name, item_variant,
    quantity, actual_weight, length, width, height, payment_type, cod_amount,
    order_value, remark

Three of those columns are not in the spec's provisional contract and are
carried through rather than dropped (spec section 16): ``receiver_city``,
``payment_type`` and ``order_value``.

Header matching is case-insensitive and whitespace/underscore-insensitive, so
``Receiver Name``, ``receiver_name`` and ``RECEIVER NAME`` are the same column.
:data:`ALIASES` maps other real-world spellings onto the canonical names without
anyone having to edit their file.
"""
from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.phone import PhoneError, normalise_my_mobile

MAX_WEIGHT_KG = Decimal("30")
MAX_NAME = 60
MAX_ADDRESS = 200
MIN_ADDRESS = 5

CANONICAL: tuple[str, ...] = (
    "order_no",
    "receiver_name",
    "receiver_phone",
    "receiver_postcode",
    "receiver_city",
    "receiver_state",
    "receiver_address",
    "address_type",
    "goods_name",
    "item_variant",
    "quantity",
    "actual_weight",
    "length",
    "width",
    "height",
    "payment_type",
    "cod_amount",
    "order_value",
    "remark",
)

REQUIRED: frozenset[str] = frozenset(
    {
        "order_no",
        "receiver_name",
        "receiver_phone",
        "receiver_postcode",
        "receiver_address",
        "goods_name",
        "actual_weight",
    }
)

#: Sender columns are ignored with a warning - the sender is a fixed profile.
SENDER_COLUMNS: frozenset[str] = frozenset(
    {
        "sendername",
        "senderphone",
        "senderphonenumber",
        "senderpostcode",
        "sendersstate",
        "senderstate",
        "senderaddress",
        "delivererpostcode",
    }
)


def normalise_header(header: str) -> str:
    """``"  Receiver  Phone Number "`` -> ``"receiverphonenumber"``.

    Separators and bracketed units are dropped, so ``Weight (kg)`` and
    ``Length (cm)`` land on ``weightkg`` / ``lengthcm`` like their aliases.
    """
    return re.sub(r"[\s_\-./()\[\]{}]+", "", str(header or "")).strip().lower()


#: alias (normalised) -> canonical column name
ALIASES: dict[str, str] = {
    # order number
    "orderno": "order_no",
    "ordernumber": "order_no",
    "customerorderno": "order_no",
    "customerordernumber": "order_no",
    "reference": "order_no",
    "refno": "order_no",
    "invoiceno": "order_no",
    # receiver
    "receivername": "receiver_name",
    "recipientname": "receiver_name",
    "consigneename": "receiver_name",
    "name": "receiver_name",
    "receiverphone": "receiver_phone",
    "receiverphonenumber": "receiver_phone",
    "recipientphone": "receiver_phone",
    "contactnumber": "receiver_phone",
    "phone": "receiver_phone",
    "mobile": "receiver_phone",
    "receiverpostcode": "receiver_postcode",
    "receiverpostalcode": "receiver_postcode",
    "postcode": "receiver_postcode",
    "postalcode": "receiver_postcode",
    "zip": "receiver_postcode",
    "receivercity": "receiver_city",
    "city": "receiver_city",
    "town": "receiver_city",
    "receiverstate": "receiver_state",
    "state": "receiver_state",
    "receiveraddress": "receiver_address",
    "recipientaddress": "receiver_address",
    "address": "receiver_address",
    "addressdetails": "receiver_address",
    "deliveryaddress": "receiver_address",
    "addresstype": "address_type",
    # item
    "goodsname": "goods_name",
    "itemname": "goods_name",
    "productname": "goods_name",
    "description": "goods_name",
    "itemvariant": "item_variant",
    "variant": "item_variant",
    "size": "item_variant",
    "qty": "quantity",
    "quantity": "quantity",
    "actualweight": "actual_weight",
    "weight": "actual_weight",
    "weightkg": "actual_weight",
    "length": "length",
    "lengthcm": "length",
    "width": "width",
    "widthcm": "width",
    "height": "height",
    "heightcm": "height",
    # money
    "paymenttype": "payment_type",
    "paymentmethod": "payment_type",
    "codamount": "cod_amount",
    "cod": "cod_amount",
    "ordervalue": "order_value",
    "value": "order_value",
    "amount": "order_value",
    "remark": "remark",
    "remarks": "remark",
    "note": "remark",
    "notes": "remark",
}
# every canonical name is trivially its own alias
ALIASES.update({normalise_header(c): c for c in CANONICAL})


class HeaderMapping(BaseModel):
    """Result of reconciling a file's header row against the contract."""

    model_config = ConfigDict(frozen=True)

    columns: dict[str, str] = Field(default_factory=dict)   # csv header -> canonical
    unknown: list[str] = Field(default_factory=list)
    ignored_sender: list[str] = Field(default_factory=list)
    missing_required: list[str] = Field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.missing_required

    @property
    def warnings(self) -> list[str]:
        out: list[str] = []
        if self.ignored_sender:
            out.append(
                "Sender columns are ignored - the sender is a fixed profile: "
                + ", ".join(self.ignored_sender)
            )
        if self.unknown:
            out.append("Unrecognised columns ignored: " + ", ".join(self.unknown))
        return out


def map_headers(headers: list[str]) -> HeaderMapping:
    columns: dict[str, str] = {}
    unknown: list[str] = []
    ignored: list[str] = []

    for raw in headers:
        key = normalise_header(raw)
        if key in SENDER_COLUMNS:
            ignored.append(str(raw))
            continue
        canonical = ALIASES.get(key)
        if canonical is None:
            unknown.append(str(raw))
            continue
        # first occurrence wins; a duplicate header is reported as unknown
        if canonical in columns.values():
            unknown.append(str(raw))
            continue
        columns[str(raw)] = canonical

    missing = sorted(REQUIRED - set(columns.values()))
    return HeaderMapping(
        columns=columns,
        unknown=unknown,
        ignored_sender=ignored,
        missing_required=missing,
    )


# ---------------------------------------------------------------------------
# row model
# ---------------------------------------------------------------------------
def _blank(value: Any) -> bool:
    return value is None or str(value).strip() == ""


def _to_decimal(value: Any, field: str) -> Decimal:
    try:
        return Decimal(str(value).strip().replace(",", ""))
    except (InvalidOperation, ValueError, AttributeError) as exc:
        raise ValueError(f"{field} is not a number: {value!r}") from exc


class BulkRow(BaseModel):
    """One validated CSV row.  Field errors are collected, never raised early."""

    model_config = ConfigDict(str_strip_whitespace=True, extra="ignore")

    order_no: str
    receiver_name: str
    receiver_phone: str
    receiver_postcode: str
    receiver_address: str
    goods_name: str

    receiver_city: str = ""
    receiver_state: str = ""
    address_type: str = "HOME"
    item_variant: str = ""
    quantity: int = 1
    actual_weight: Decimal = Decimal("0")
    length: Decimal = Decimal("0")
    width: Decimal = Decimal("0")
    height: Decimal = Decimal("0")
    payment_type: str = "PREPAID"
    cod_amount: Decimal = Decimal("0")
    order_value: Decimal = Decimal("0")
    remark: str = ""

    # -- required strings -------------------------------------------------
    @field_validator("order_no")
    @classmethod
    def _order_no(cls, v: str) -> str:
        if _blank(v):
            raise ValueError("order_no is required")
        if len(v) > 64:
            raise ValueError("order_no must be 64 characters or fewer")
        return v

    @field_validator("receiver_name")
    @classmethod
    def _name(cls, v: str) -> str:
        if _blank(v):
            raise ValueError("receiver_name is required")
        if len(v) > MAX_NAME:
            raise ValueError(f"receiver_name must be 1-{MAX_NAME} characters")
        return v

    @field_validator("goods_name")
    @classmethod
    def _goods(cls, v: str) -> str:
        if _blank(v):
            raise ValueError("goods_name is required")
        return v

    @field_validator("receiver_address")
    @classmethod
    def _address(cls, v: str) -> str:
        if _blank(v):
            raise ValueError("receiver_address is required")
        if not MIN_ADDRESS <= len(v) <= MAX_ADDRESS:
            raise ValueError(
                f"receiver_address must be {MIN_ADDRESS}-{MAX_ADDRESS} characters "
                f"(got {len(v)})"
            )
        return v

    @field_validator("receiver_phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        try:
            return normalise_my_mobile(v)
        except PhoneError as exc:
            raise ValueError(str(exc)) from exc

    @field_validator("receiver_postcode")
    @classmethod
    def _postcode(cls, v: str) -> str:
        digits = re.sub(r"\D", "", str(v or ""))
        if len(digits) != 5:
            raise ValueError(f"receiver_postcode must be exactly 5 digits: {v!r}")
        return digits

    # -- optional / defaulted ---------------------------------------------
    @field_validator("address_type", mode="before")
    @classmethod
    def _addr_type(cls, v: Any) -> str:
        if _blank(v):
            return "HOME"
        value = str(v).strip().upper()
        if value not in {"HOME", "OFFICE"}:
            raise ValueError(f"address_type must be HOME or OFFICE: {v!r}")
        return value

    @field_validator("payment_type", mode="before")
    @classmethod
    def _pay_type(cls, v: Any) -> str:
        if _blank(v):
            return "PREPAID"
        value = str(v).strip().upper()
        if value not in {"PREPAID", "COD"}:
            raise ValueError(f"payment_type must be PREPAID or COD: {v!r}")
        return value

    @field_validator("quantity", mode="before")
    @classmethod
    def _qty(cls, v: Any) -> int:
        if _blank(v):
            return 1
        try:
            qty = int(Decimal(str(v).strip()))
        except (InvalidOperation, ValueError) as exc:
            raise ValueError(f"quantity is not an integer: {v!r}") from exc
        if qty < 1:
            raise ValueError(f"quantity must be 1 or more: {v!r}")
        return qty

    @field_validator("actual_weight", mode="before")
    @classmethod
    def _weight(cls, v: Any) -> Decimal:
        if _blank(v):
            raise ValueError("actual_weight is required")
        weight = _to_decimal(v, "actual_weight")
        if weight <= 0:
            raise ValueError(f"actual_weight must be greater than 0: {v!r}")
        if weight > MAX_WEIGHT_KG:
            raise ValueError(f"actual_weight must not exceed {MAX_WEIGHT_KG} kg: {v!r}")
        return weight

    @field_validator("length", "width", "height", mode="before")
    @classmethod
    def _dimension(cls, v: Any) -> Decimal:
        if _blank(v):
            return Decimal("0")
        value = _to_decimal(v, "dimension")
        if value < 0:
            raise ValueError(f"dimensions must not be negative: {v!r}")
        return value

    @field_validator("cod_amount", "order_value", mode="before")
    @classmethod
    def _money(cls, v: Any) -> Decimal:
        if _blank(v):
            return Decimal("0")
        value = _to_decimal(v, "amount")
        if value < 0:
            raise ValueError(f"amount must not be negative: {v!r}")
        return value

    @field_validator("receiver_city", "receiver_state", "item_variant", "remark",
                     mode="before")
    @classmethod
    def _optional_text(cls, v: Any) -> str:
        return "" if _blank(v) else str(v).strip()

    # -- cross-field ------------------------------------------------------
    @model_validator(mode="after")
    def _cod_consistency(self) -> "BulkRow":
        if self.payment_type == "COD" and self.cod_amount <= 0:
            raise ValueError("cod_amount must be greater than 0 when payment_type is COD")
        if self.payment_type == "PREPAID" and self.cod_amount > 0:
            # Not an error - a prepaid parcel simply collects nothing.
            object.__setattr__(self, "cod_amount", Decimal("0"))
        return self
