"""The flat, picklable payload a waybill is rendered from.

Deliberately a plain dataclass of primitives: instances cross a
``ProcessPoolExecutor`` boundary, so nothing here may hold a DB session, a
Decimal-bearing ORM object or anything else expensive to pickle.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any


def _s(value: Any) -> str:
    return "" if value is None else str(value)


@dataclass(frozen=True, slots=True)
class OrderDTO:
    tracking_no: str

    sender_name: str
    sender_phone: str
    sender_postcode: str
    sender_address: str

    receiver_name: str
    receiver_phone: str
    receiver_postcode: str
    receiver_state: str
    receiver_address: str
    receiver_city: str = ""

    address_type: str = "HOME"
    goods_name: str = ""
    item_variant: str = ""
    chargeable_weight: float = 0.0

    service_type: str = "NORMAL"
    service_scope: str = "WEST"
    sortation_code: str = ""
    route_code: str = ""
    payment_type: str = "MONTHLY"
    cod_amount: float = 0.0

    customer_order_no: str = ""
    order_date: str = ""
    remark: str = ""

    # -- derived presentation strings -------------------------------------
    @property
    def weight_label(self) -> str:
        return f"{self.chargeable_weight:.1f} KG"

    @property
    def goods_label(self) -> str:
        """``"<goods name> -  <variant>"`` - two spaces, as the reference prints."""
        if self.item_variant:
            return f"{self.goods_name} -  {self.item_variant}"
        return self.goods_name

    @property
    def goods_label_short(self) -> str:
        """Dispatcher-copy form: the name plus the variant separator only.

        The reference prints ``"... Farshi Palazzo -"`` on the dispatcher copy
        and the full ``"... Farshi Palazzo -  M"`` on the sender copy - the
        variant itself is carried only by the sender's tear-off.
        """
        return f"{self.goods_name} -" if self.item_variant else self.goods_name

    @property
    def full_receiver_address(self) -> str:
        """Street address plus postcode / city / state / country, uppercased.

        Reproduces the reference exactly::

            F-08-07, RESIDENSI IDAMAN ABADI, PERSIARAN TROPICANA HEIGHTS,
            43000 KAJANG SELANGOR MALAYSIA
        """
        tail = " ".join(
            p for p in (self.receiver_postcode, self.receiver_city, self.receiver_state)
            if p
        )
        parts = [self.receiver_address.strip().rstrip(",")]
        if tail:
            parts.append(tail)
        return (", ".join(parts) + " MALAYSIA").upper()

    @property
    def full_sender_address(self) -> str:
        return self.sender_address.strip().upper()

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "OrderDTO":
        allowed = {f for f in cls.__dataclass_fields__}
        return cls(**{k: v for k, v in data.items() if k in allowed})

    @classmethod
    def from_order(cls, order: Any, sender: Any | None = None) -> "OrderDTO":
        """Build from an ``orders`` ORM row (sender fields are snapshotted on it)."""
        def num(v: Any) -> float:
            return float(v) if isinstance(v, (Decimal, int, float)) else 0.0

        od = order.order_date
        return cls(
            tracking_no=_s(order.tracking_no),
            sender_name=_s(order.sender_name),
            sender_phone=_s(order.sender_phone),
            sender_postcode=_s(order.sender_postcode),
            sender_address=_s(order.sender_address),
            receiver_name=_s(order.receiver_name),
            receiver_phone=_s(order.receiver_phone),
            receiver_postcode=_s(order.receiver_postcode),
            receiver_city=_s(order.receiver_city),
            receiver_state=_s(order.receiver_state),
            receiver_address=_s(order.receiver_address),
            address_type=_s(order.address_type) or "HOME",
            goods_name=_s(order.goods_name),
            item_variant=_s(order.item_variant),
            chargeable_weight=num(order.chargeable_weight),
            service_type=_s(order.service_type) or "NORMAL",
            service_scope=_s(order.service_scope),
            sortation_code=_s(order.sortation_code),
            route_code=_s(order.route_code),
            payment_type=_s(order.payment_type) or "MONTHLY",
            cod_amount=num(order.cod_amount),
            customer_order_no=_s(order.customer_order_no),
            order_date=od.isoformat() if isinstance(od, date) else _s(od),
            remark=_s(order.remark),
        )
