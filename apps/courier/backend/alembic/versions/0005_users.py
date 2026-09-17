"""users and login sessions - now the platform's

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-17

This migration used to create ``users`` and ``user_sessions`` in this module's
own schema.  Since the courier portal and the warehouse became one platform,
accounts and sessions live in the shared ``core`` schema, created by the
platform bootstrap (database/init/10-core.sql) - one account, one login, for
both modules.

It now only checks that the platform tables are there, so a database that skips
the bootstrap fails here with a message that says why, instead of on the first
login.  Accounts from a standalone J&T database are carried over by
database/tools/migrate_legacy.py.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    present = bind.execute(
        sa.text(
            "SELECT to_regclass('core.users') IS NOT NULL "
            "AND to_regclass('core.user_sessions') IS NOT NULL"
        )
    ).scalar()
    if not present:
        raise RuntimeError(
            "core.users / core.user_sessions are missing. Run database/init before migrating "
            "the courier module."
        )


def downgrade() -> None:
    # The platform owns these tables; the courier module never drops them.
    pass
