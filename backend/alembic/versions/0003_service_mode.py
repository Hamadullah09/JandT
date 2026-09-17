"""orders.service_mode: PICK_UP or DROP_OFF

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-16

The Normal Order page's Service Type - whether a J&T courier collects the
parcel or it is dropped off at a counter.  NULL for orders that never said,
such as CSV imports and everything created before this column existed.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("service_mode", sa.String(16), nullable=True))


def downgrade() -> None:
    op.drop_column("orders", "service_mode")
