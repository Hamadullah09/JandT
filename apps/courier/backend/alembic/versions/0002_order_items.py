"""orders.items: several items in one parcel

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-16

Adds a JSONB list of ``{"name", "variant", "quantity"}`` per order and fills it
in for every existing order from its single-item columns, so code reading
``items`` never has to special-case older orders.  Nothing is removed: the
single-item columns stay filled in (see ``app/core/items.py``).
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("items", postgresql.JSONB(), nullable=True))
    op.execute(
        """
        UPDATE orders
           SET items = jsonb_build_array(jsonb_build_object(
                   'name', btrim(goods_name),
                   'variant', coalesce(btrim(item_variant), ''),
                   'quantity', greatest(quantity, 1)))
         WHERE items IS NULL
           AND goods_name IS NOT NULL
           AND btrim(goods_name) <> ''
        """
    )


def downgrade() -> None:
    op.drop_column("orders", "items")
