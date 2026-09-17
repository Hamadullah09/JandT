"""track & trace: tracking_event, orders.tracking_status

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-17

Each scan on a parcel's journey - Picked Up, Departure, Delivered - is a row
in tracking_event, recorded from the admin portal.  orders.tracking_status
keeps the status of the latest one, so the dashboard can filter and count
by status without reading every event.  Existing orders start as CREATED.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "orders",
        sa.Column("tracking_status", sa.String(16), nullable=False, server_default="CREATED"),
    )
    op.add_column(
        "orders", sa.Column("tracking_updated_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.create_index("ix_orders_tracking_status", "orders", ["tracking_status"])

    op.create_table(
        "tracking_event",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column(
            "order_id",
            sa.BigInteger,
            sa.ForeignKey("orders.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("event_type", sa.String(16), nullable=False),
        sa.Column("location", sa.String(128), nullable=False, server_default=""),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
    )
    op.create_index("ix_tracking_event_order", "tracking_event", ["order_id", "occurred_at"])


def downgrade() -> None:
    op.drop_index("ix_tracking_event_order", table_name="tracking_event")
    op.drop_table("tracking_event")
    op.drop_index("ix_orders_tracking_status", table_name="orders")
    op.drop_column("orders", "tracking_updated_at")
    op.drop_column("orders", "tracking_status")
