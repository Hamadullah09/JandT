"""SQLAlchemy 2.0 ORM models (spec section 6).

Three deliberate additions to the spec's table list, all documented in the
README:

``orders.receiver_city`` / ``orders.order_payment_type`` / ``orders.order_value``
    Columns present in the **real** production CSV (spec section 16 - "do not
    drop columns it does contain").  ``order_payment_type`` is the CSV's
    ``PREPAID``/``COD`` flag and is distinct from ``payment_type``, which is the
    freight billing mode snapshotted from the sender profile and printed on the
    waybill as ``MONTHLY``.

``import_row``
    Staging table for parsed-but-not-yet-committed CSV rows.  Required by the
    API contract (``commit`` takes ``row_ids``, ``DELETE .../rows``) and by the
    grid's "click a data row to modify" behaviour.

``tracking_seq``
    A native PostgreSQL ``SEQUENCE`` rather than a counter table - lock-free,
    collision-free under concurrency and allocatable in a single round trip.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


ADDRESS_TYPE = sa.Enum("HOME", "OFFICE", name="address_type")
GOODS_TYPE = sa.Enum("PARCEL", "DOCUMENT", name="goods_type")
ORDER_STATUS = sa.Enum("created", "failed", name="order_status")
BATCH_STATUS = sa.Enum(
    "pending", "parsing", "creating", "rendering", "done", "failed",
    name="batch_status",
)
ROW_STATUS = sa.Enum("ok", "error", "duplicate", "created", name="import_row_status")

TRACKING_SEQ = "tracking_seq"


def _now() -> datetime:
    return datetime.now()


class SenderProfile(Base):
    __tablename__ = "sender_profile"

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True)
    account_code: Mapped[str] = mapped_column(sa.String(32), nullable=False)
    company_name: Mapped[str] = mapped_column(sa.String(128), nullable=False)
    phone: Mapped[str] = mapped_column(sa.String(32), nullable=False)
    postcode: Mapped[str] = mapped_column(sa.String(5), nullable=False)
    state: Mapped[str] = mapped_column(sa.String(128), nullable=False)
    address: Mapped[str] = mapped_column(sa.Text, nullable=False)
    payment_type: Mapped[str] = mapped_column(
        sa.String(16), nullable=False, server_default="MONTHLY"
    )
    default_service: Mapped[str] = mapped_column(
        sa.String(24), nullable=False, server_default="NORMAL"
    )
    is_active: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.true()
    )
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=_now
    )

    __table_args__ = (
        sa.Index(
            "uq_sender_profile_active",
            "is_active",
            unique=True,
            postgresql_where=sa.text("is_active"),
        ),
    )


class PostcodeZone(Base):
    __tablename__ = "postcode_zone"

    postcode: Mapped[str] = mapped_column(sa.String(5), primary_key=True)
    state: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    city: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    zone_code: Mapped[str] = mapped_column(sa.String(8), nullable=False)
    hub_code: Mapped[str] = mapped_column(sa.String(8), nullable=False)
    dp_code: Mapped[str] = mapped_column(sa.String(8), nullable=False)
    route_code: Mapped[str] = mapped_column(sa.String(8), nullable=False)


class ImportBatch(Base):
    __tablename__ = "import_batch"

    id: Mapped[int] = mapped_column(sa.BigInteger, primary_key=True, autoincrement=True)
    filename: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    source_path: Mapped[str | None] = mapped_column(sa.Text)
    output_dir: Mapped[str | None] = mapped_column(sa.Text)
    total_rows: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    ok_rows: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    failed_rows: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    duplicate_rows: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(
        BATCH_STATUS, nullable=False, server_default="pending"
    )
    stage: Mapped[str | None] = mapped_column(sa.String(24))
    processed: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    started_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    duration_ms: Mapped[int | None] = mapped_column(sa.Integer)
    created_by: Mapped[str | None] = mapped_column(sa.String(64))
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now()
    )

    rows: Mapped[list["ImportRow"]] = relationship(
        back_populates="batch", cascade="all, delete-orphan"
    )


class ImportRow(Base):
    """One parsed CSV row, staged between ``/bulk/upload`` and ``/bulk/commit``."""

    __tablename__ = "import_row"

    id: Mapped[int] = mapped_column(sa.BigInteger, primary_key=True, autoincrement=True)
    batch_id: Mapped[int] = mapped_column(
        sa.ForeignKey("import_batch.id", ondelete="CASCADE"), index=True, nullable=False
    )
    row_no: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    status: Mapped[str] = mapped_column(ROW_STATUS, nullable=False, server_default="ok")
    error_field: Mapped[str | None] = mapped_column(sa.String(64))
    error_message: Mapped[str | None] = mapped_column(sa.Text)
    tracking_no: Mapped[str | None] = mapped_column(sa.String(12))
    #: Validated + enriched payload, ready to become an ``orders`` row.
    payload: Mapped[dict] = mapped_column(sa.JSON, nullable=False, default=dict)
    #: Raw CSV cells exactly as read, so the grid can show what the user gave us.
    raw: Mapped[dict] = mapped_column(sa.JSON, nullable=False, default=dict)

    batch: Mapped[ImportBatch] = relationship(back_populates="rows")

    __table_args__ = (sa.UniqueConstraint("batch_id", "row_no", name="uq_import_row"),)


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(sa.BigInteger, primary_key=True, autoincrement=True)
    batch_id: Mapped[int | None] = mapped_column(
        sa.ForeignKey("import_batch.id", ondelete="SET NULL"), index=True
    )
    row_no: Mapped[int | None] = mapped_column(sa.Integer)

    tracking_no: Mapped[str] = mapped_column(sa.String(12), nullable=False)
    customer_order_no: Mapped[str | None] = mapped_column(sa.String(64))

    # --- sender snapshot (frozen at creation time) -------------------------
    sender_name: Mapped[str] = mapped_column(sa.String(128), nullable=False)
    sender_phone: Mapped[str] = mapped_column(sa.String(32), nullable=False)
    sender_postcode: Mapped[str] = mapped_column(sa.String(5), nullable=False)
    sender_state: Mapped[str] = mapped_column(sa.String(128), nullable=False)
    sender_address: Mapped[str] = mapped_column(sa.Text, nullable=False)

    # --- receiver ----------------------------------------------------------
    receiver_name: Mapped[str] = mapped_column(sa.String(60), nullable=False)
    receiver_phone: Mapped[str] = mapped_column(sa.String(32), nullable=False)
    receiver_postcode: Mapped[str] = mapped_column(sa.String(5), nullable=False)
    receiver_city: Mapped[str | None] = mapped_column(sa.String(64))
    receiver_state: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    receiver_address: Mapped[str] = mapped_column(sa.Text, nullable=False)
    address_type: Mapped[str] = mapped_column(
        ADDRESS_TYPE, nullable=False, server_default="HOME"
    )

    # --- item --------------------------------------------------------------
    goods_type: Mapped[str] = mapped_column(
        GOODS_TYPE, nullable=False, server_default="PARCEL"
    )
    goods_name: Mapped[str | None] = mapped_column(sa.Text)
    item_variant: Mapped[str | None] = mapped_column(sa.String(32))
    quantity: Mapped[int] = mapped_column(sa.Integer, nullable=False, server_default="1")
    # [{"name", "variant", "quantity"(, "image")}] - see app/core/items.py
    items: Mapped[list[dict] | None] = mapped_column(JSONB)
    # PICK_UP / DROP_OFF from the Normal Order page; NULL when never chosen
    service_mode: Mapped[str | None] = mapped_column(sa.String(16))
    actual_weight: Mapped[Decimal] = mapped_column(sa.Numeric(8, 2), nullable=False)
    length_cm: Mapped[Decimal] = mapped_column(
        sa.Numeric(8, 2), nullable=False, server_default="0"
    )
    width_cm: Mapped[Decimal] = mapped_column(
        sa.Numeric(8, 2), nullable=False, server_default="0"
    )
    height_cm: Mapped[Decimal] = mapped_column(
        sa.Numeric(8, 2), nullable=False, server_default="0"
    )
    volumetric_weight: Mapped[Decimal] = mapped_column(sa.Numeric(8, 2), nullable=False)
    chargeable_weight: Mapped[Decimal] = mapped_column(sa.Numeric(8, 2), nullable=False)

    # --- carrier-derived ---------------------------------------------------
    service_type: Mapped[str] = mapped_column(
        sa.String(24), nullable=False, server_default="NORMAL"
    )
    service_scope: Mapped[str | None] = mapped_column(sa.String(24))
    sortation_code: Mapped[str | None] = mapped_column(sa.String(24))
    route_code: Mapped[str | None] = mapped_column(sa.String(8))
    #: Freight billing mode from the sender profile - prints as MONTHLY.
    payment_type: Mapped[str] = mapped_column(
        sa.String(16), nullable=False, server_default="MONTHLY"
    )
    #: The real CSV's PREPAID / COD flag for the goods value.
    order_payment_type: Mapped[str | None] = mapped_column(sa.String(16))
    cod_amount: Mapped[Decimal] = mapped_column(
        sa.Numeric(10, 2), nullable=False, server_default="0"
    )
    order_value: Mapped[Decimal] = mapped_column(
        sa.Numeric(10, 2), nullable=False, server_default="0"
    )
    freight_fee: Mapped[Decimal | None] = mapped_column(sa.Numeric(10, 2))
    remark: Mapped[str | None] = mapped_column(sa.Text)

    # --- artefacts ---------------------------------------------------------
    waybill_path: Mapped[str | None] = mapped_column(sa.Text)
    waybill_filename: Mapped[str | None] = mapped_column(sa.String(128))
    order_date: Mapped[date | None] = mapped_column(sa.Date)
    status: Mapped[str] = mapped_column(
        ORDER_STATUS, nullable=False, server_default="created"
    )
    error_message: Mapped[str | None] = mapped_column(sa.Text)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), index=True
    )

    # --- track & trace (app/core/trace.py) --------------------------------
    #: the status of the latest tracking event, CREATED until the first one
    tracking_status: Mapped[str] = mapped_column(
        sa.String(16), nullable=False, server_default="CREATED"
    )
    tracking_updated_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))

    __table_args__ = (
        # H5: a tracking number is never reused - enforced by the database.
        sa.Index("uq_orders_tracking_no", "tracking_no", unique=True),
        # H4 / AC8: re-importing the same CSV creates zero new orders.
        sa.Index(
            "uq_orders_customer_order_no",
            "customer_order_no",
            unique=True,
            postgresql_where=sa.text("customer_order_no IS NOT NULL"),
        ),
        # Spec section 6 states the per-batch constraint explicitly.
        sa.Index(
            "uq_orders_batch_customer_order_no",
            "batch_id",
            "customer_order_no",
            unique=True,
            postgresql_where=sa.text("customer_order_no IS NOT NULL"),
        ),
        sa.Index("ix_orders_receiver_name", "receiver_name"),
        sa.Index("ix_orders_tracking_status", "tracking_status"),
    )


class TrackingEvent(Base):
    """One scan on a parcel's journey, as the tracking page lists it."""

    __tablename__ = "tracking_event"

    id: Mapped[int] = mapped_column(sa.BigInteger, primary_key=True, autoincrement=True)
    order_id: Mapped[int] = mapped_column(
        sa.ForeignKey("orders.id", ondelete="CASCADE"), nullable=False
    )
    #: a key of app.core.trace.EVENT_TYPES, e.g. DEPARTURE
    event_type: Mapped[str] = mapped_column(sa.String(16), nullable=False)
    location: Mapped[str] = mapped_column(sa.String(128), nullable=False, server_default="")
    description: Mapped[str] = mapped_column(sa.Text, nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now()
    )

    __table_args__ = (
        sa.Index("ix_tracking_event_order", "order_id", "occurred_at"),
    )


class User(Base):
    """Someone who can log in: the admin, the shop, and approved sign-ups."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(sa.BigInteger, primary_key=True, autoincrement=True)
    #: stored lower case; every account has one
    username: Mapped[str] = mapped_column(sa.String(32), nullable=False)
    name: Mapped[str] = mapped_column(sa.String(128), nullable=False)
    #: "+60 1XXXXXXXX", like orders.receiver_phone
    phone: Mapped[str | None] = mapped_column(sa.String(32))
    email: Mapped[str | None] = mapped_column(sa.String(254))
    #: app.core.auth.hash_password - never the password itself
    password_hash: Mapped[str] = mapped_column(sa.String(256), nullable=False)
    #: admin or merchant
    role: Mapped[str] = mapped_column(sa.String(16), nullable=False, server_default="merchant")
    #: active, pending (signed up, not approved yet) or blocked
    status: Mapped[str] = mapped_column(sa.String(16), nullable=False, server_default="pending")
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now()
    )
    last_login_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))

    __table_args__ = (
        sa.Index("uq_users_username", "username", unique=True),
        sa.Index("uq_users_phone", "phone", unique=True, postgresql_where=sa.text("phone IS NOT NULL")),
        sa.Index("uq_users_email", "email", unique=True, postgresql_where=sa.text("email IS NOT NULL")),
    )


class UserSession(Base):
    """A login.  The cookie holds a random token; only its SHA-256 is stored here."""

    __tablename__ = "user_sessions"

    token_hash: Mapped[str] = mapped_column(sa.String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(
        sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
