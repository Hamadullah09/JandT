"""The reference order.

``OrderNo_12808.pdf`` shipped with the spec is the ground truth for the waybill
renderer.  These are the exact field values that produced it, recovered by
decoding the PDF's content stream.  The golden-PDF regression test renders this
order and asserts the result against the reference.
"""
from __future__ import annotations

from app.waybill.dto import OrderDTO

REFERENCE_ORDER = OrderDTO(
    tracking_no="632158571544",
    sender_name="LINKED INTERNATIONAL SDN BHD",
    sender_phone="+60 135763706",
    sender_postcode="43300",
    sender_address="B-09-09, PERDANA SELATAN, TAMAN SERDANG PERDANA, 43300",
    receiver_name="Nalini Sinnasamy",
    receiver_phone="+60 123456794",
    receiver_postcode="43000",
    receiver_city="Kajang",
    receiver_state="Selangor",
    receiver_address="F-08-07, Residensi Idaman Abadi, Persiaran Tropicana Heights",
    address_type="HOME",
    goods_name="Chiffon Georgette Party Set with Farshi Palazzo",
    item_variant="M",
    chargeable_weight=0.6,
    service_type="NORMAL",
    service_scope="SAME CITY",
    sortation_code="300-K41-SG496",
    route_code="E03",
    payment_type="MONTHLY",
    cod_amount=78.0,
    customer_order_no="12808",
    order_date="2026-09-14",
    remark="",
)
