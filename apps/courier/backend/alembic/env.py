"""Alembic environment - runs through the same asyncpg driver as the app.

Using the async engine here keeps the project on a single database driver; no
psycopg2 is required anywhere.

The courier module's tables - and Alembic's own version table - live in the
courier schema of the platform database.  The schema, the courier_app role and
the shared ``core`` tables are created by the platform bootstrap
(database/init), which must have run first.
"""
from __future__ import annotations

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool, text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import get_settings
from app.db.models import Base
from app.db.session import connect_args

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

settings = get_settings()
config.set_main_option("sqlalchemy.url", settings.database_url)
target_metadata = Base.metadata
SCHEMA = settings.db_schema


def _include_object(obj, name, type_, reflected, compare_to):
    """The shared core tables belong to the platform, not to this module's migrations."""
    return getattr(obj, "schema", None) != "core"


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        version_table_schema=SCHEMA,
        include_object=_include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    ready = connection.execute(
        text("SELECT to_regnamespace(:schema) IS NOT NULL AND to_regclass('core.users') IS NOT NULL"),
        {"schema": SCHEMA},
    ).scalar()
    if not ready:
        raise RuntimeError(
            f"The platform database is not initialised: schema {SCHEMA!r} or core.users is missing. "
            "Run database/init first (docker compose runs it as the db-init service)."
        )
    # The check above began a transaction. Ending it here matters: Alembic will
    # not commit a transaction it did not begin, and every migration would be
    # rolled back silently when the connection closes.
    connection.commit()
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        version_table_schema=SCHEMA,
        include_object=_include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    connectable = create_async_engine(
        settings.database_url, poolclass=pool.NullPool, connect_args=connect_args()
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
