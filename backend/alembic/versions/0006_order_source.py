"""orders.source: where the order came from

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-17

Website, WhatsApp, Daraz, Amazon, eBay... (app/core/sources.py).  The admin
portal filters by it.  Orders created before it existed are "Website".
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "orders",
        sa.Column("source", sa.String(32), nullable=False, server_default="Website"),
    )
    op.create_index("ix_orders_source", "orders", ["source"])


def downgrade() -> None:
    op.drop_index("ix_orders_source", table_name="orders")
    op.drop_column("orders", "source")
