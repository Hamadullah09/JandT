"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-09-15
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.config import get_settings

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

# create_type=False: the types are created once, explicitly, in upgrade().
# Leaving it True makes every create_table() re-issue CREATE TYPE and fail.
ADDRESS_TYPE = postgresql.ENUM("HOME", "OFFICE", name="address_type", create_type=False)
GOODS_TYPE = postgresql.ENUM(
    "PARCEL", "DOCUMENT", name="goods_type", create_type=False
)
ORDER_STATUS = postgresql.ENUM(
    "created", "failed", name="order_status", create_type=False
)
BATCH_STATUS = postgresql.ENUM(
    "pending", "parsing", "creating", "rendering", "done", "failed",
    name="batch_status", create_type=False,
)
ROW_STATUS = postgresql.ENUM(
    "ok", "error", "duplicate", "created", name="import_row_status", create_type=False
)

_ENUMS = (ADDRESS_TYPE, GOODS_TYPE, ORDER_STATUS, BATCH_STATUS, ROW_STATUS)


def upgrade() -> None:
    bind = op.get_bind()
    for enum in _ENUMS:
        enum.create(bind, checkfirst=True)

    # ---- tracking sequence (spec 8.1) ------------------------------------
    start = get_settings().tracking_seq_start
    op.execute(
        f"CREATE SEQUENCE IF NOT EXISTS tracking_seq "
        f"START WITH {start} INCREMENT BY 1 MINVALUE 0 NO MAXVALUE CACHE 50"
    )

    # ---- sender_profile ---------------------------------------------------
    op.create_table(
        "sender_profile",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("account_code", sa.String(32), nullable=False),
        sa.Column("company_name", sa.String(128), nullable=False),
        sa.Column("phone", sa.String(32), nullable=False),
        sa.Column("postcode", sa.String(5), nullable=False),
        sa.Column("state", sa.String(128), nullable=False),
        sa.Column("address", sa.Text, nullable=False),
        sa.Column("payment_type", sa.String(16), nullable=False, server_default="MONTHLY"),
        sa.Column("default_service", sa.String(24), nullable=False, server_default="NORMAL"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index(
        "uq_sender_profile_active",
        "sender_profile",
        ["is_active"],
        unique=True,
        postgresql_where=sa.text("is_active"),
    )

    # ---- postcode_zone ----------------------------------------------------
    op.create_table(
        "postcode_zone",
        sa.Column("postcode", sa.String(5), primary_key=True),
        sa.Column("state", sa.String(64), nullable=False),
        sa.Column("city", sa.String(64), nullable=False),
        sa.Column("zone_code", sa.String(8), nullable=False),
        sa.Column("hub_code", sa.String(8), nullable=False),
        sa.Column("dp_code", sa.String(8), nullable=False),
        sa.Column("route_code", sa.String(8), nullable=False),
    )

    # ---- import_batch -----------------------------------------------------
    op.create_table(
        "import_batch",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("source_path", sa.Text),
        sa.Column("output_dir", sa.Text),
        sa.Column("total_rows", sa.Integer, nullable=False, server_default="0"),
        sa.Column("ok_rows", sa.Integer, nullable=False, server_default="0"),
        sa.Column("failed_rows", sa.Integer, nullable=False, server_default="0"),
        sa.Column("duplicate_rows", sa.Integer, nullable=False, server_default="0"),
        sa.Column("status", BATCH_STATUS, nullable=False, server_default="pending"),
        sa.Column("stage", sa.String(24)),
        sa.Column("processed", sa.Integer, nullable=False, server_default="0"),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("duration_ms", sa.Integer),
        sa.Column("created_by", sa.String(64)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ---- import_row -------------------------------------------------------
    op.create_table(
        "import_row",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column(
            "batch_id",
            sa.BigInteger,
            sa.ForeignKey("import_batch.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("row_no", sa.Integer, nullable=False),
        sa.Column("status", ROW_STATUS, nullable=False, server_default="ok"),
        sa.Column("error_field", sa.String(64)),
        sa.Column("error_message", sa.Text),
        sa.Column("tracking_no", sa.String(12)),
        sa.Column("payload", sa.JSON, nullable=False),
        sa.Column("raw", sa.JSON, nullable=False),
        sa.UniqueConstraint("batch_id", "row_no", name="uq_import_row"),
    )
    op.create_index("ix_import_row_batch_id", "import_row", ["batch_id"])

    # ---- orders -----------------------------------------------------------
    op.create_table(
        "orders",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column(
            "batch_id",
            sa.BigInteger,
            sa.ForeignKey("import_batch.id", ondelete="SET NULL"),
        ),
        sa.Column("row_no", sa.Integer),
        sa.Column("tracking_no", sa.String(12), nullable=False),
        sa.Column("customer_order_no", sa.String(64)),
        sa.Column("sender_name", sa.String(128), nullable=False),
        sa.Column("sender_phone", sa.String(32), nullable=False),
        sa.Column("sender_postcode", sa.String(5), nullable=False),
        sa.Column("sender_state", sa.String(128), nullable=False),
        sa.Column("sender_address", sa.Text, nullable=False),
        sa.Column("receiver_name", sa.String(60), nullable=False),
        sa.Column("receiver_phone", sa.String(32), nullable=False),
        sa.Column("receiver_postcode", sa.String(5), nullable=False),
        sa.Column("receiver_city", sa.String(64)),
        sa.Column("receiver_state", sa.String(64), nullable=False),
        sa.Column("receiver_address", sa.Text, nullable=False),
        sa.Column("address_type", ADDRESS_TYPE, nullable=False, server_default="HOME"),
        sa.Column("goods_type", GOODS_TYPE, nullable=False, server_default="PARCEL"),
        sa.Column("goods_name", sa.Text),
        sa.Column("item_variant", sa.String(32)),
        sa.Column("quantity", sa.Integer, nullable=False, server_default="1"),
        sa.Column("actual_weight", sa.Numeric(8, 2), nullable=False),
        sa.Column("length_cm", sa.Numeric(8, 2), nullable=False, server_default="0"),
        sa.Column("width_cm", sa.Numeric(8, 2), nullable=False, server_default="0"),
        sa.Column("height_cm", sa.Numeric(8, 2), nullable=False, server_default="0"),
        sa.Column("volumetric_weight", sa.Numeric(8, 2), nullable=False),
        sa.Column("chargeable_weight", sa.Numeric(8, 2), nullable=False),
        sa.Column("service_type", sa.String(24), nullable=False, server_default="NORMAL"),
        sa.Column("service_scope", sa.String(24)),
        sa.Column("sortation_code", sa.String(24)),
        sa.Column("route_code", sa.String(8)),
        sa.Column("payment_type", sa.String(16), nullable=False, server_default="MONTHLY"),
        sa.Column("order_payment_type", sa.String(16)),
        sa.Column("cod_amount", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("order_value", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("freight_fee", sa.Numeric(10, 2)),
        sa.Column("remark", sa.Text),
        sa.Column("waybill_path", sa.Text),
        sa.Column("waybill_filename", sa.String(128)),
        sa.Column("order_date", sa.Date),
        sa.Column("status", ORDER_STATUS, nullable=False, server_default="created"),
        sa.Column("error_message", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("uq_orders_tracking_no", "orders", ["tracking_no"], unique=True)
    op.create_index(
        "uq_orders_customer_order_no",
        "orders",
        ["customer_order_no"],
        unique=True,
        postgresql_where=sa.text("customer_order_no IS NOT NULL"),
    )
    op.create_index(
        "uq_orders_batch_customer_order_no",
        "orders",
        ["batch_id", "customer_order_no"],
        unique=True,
        postgresql_where=sa.text("customer_order_no IS NOT NULL"),
    )
    op.create_index("ix_orders_batch_id", "orders", ["batch_id"])
    op.create_index("ix_orders_created_at", "orders", ["created_at"])
    op.create_index("ix_orders_receiver_name", "orders", ["receiver_name"])


def downgrade() -> None:
    op.drop_table("orders")
    op.drop_table("import_row")
    op.drop_table("import_batch")
    op.drop_table("postcode_zone")
    op.drop_table("sender_profile")
    op.execute("DROP SEQUENCE IF EXISTS tracking_seq")
    bind = op.get_bind()
    for enum in reversed(_ENUMS):
        enum.drop(bind, checkfirst=True)
