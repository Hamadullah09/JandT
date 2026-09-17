"""The two accounts every install starts with."""
from __future__ import annotations

import logging

from sqlalchemy import func, select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import auth
from app.db.models import SenderProfile, User

log = logging.getLogger(__name__)

#: kept simple on purpose, as the merchant asked - change them in the admin portal
DEFAULT_ADMIN = {"username": "admin", "name": "Administrator", "password": "admin123"}
DEFAULT_SHOP = {"username": "linked", "password": "linked123"}


async def ensure_default_users(session: AsyncSession) -> list[str]:
    """Create the admin and the shop account - only while no account exists at all.

    Returns the usernames it created.  Once anyone exists nothing is touched,
    so a changed password is never put back.
    """
    if await session.scalar(select(func.count()).select_from(User)):
        return []

    sender = await session.scalar(select(SenderProfile).where(SenderProfile.is_active.is_(True)))
    phone = None
    if sender is not None:
        try:
            phone = auth.clean_phone(sender.phone)
        except auth.PhoneError:
            phone = None

    session.add_all([
        User(
            username=DEFAULT_ADMIN["username"],
            name=DEFAULT_ADMIN["name"],
            password_hash=auth.hash_password(DEFAULT_ADMIN["password"]),
            role=auth.ROLE_ADMIN,
            status=auth.STATUS_ACTIVE,
        ),
        User(
            username=DEFAULT_SHOP["username"],
            name=sender.company_name if sender else "Shop",
            phone=phone,
            password_hash=auth.hash_password(DEFAULT_SHOP["password"]),
            role=auth.ROLE_MERCHANT,
            status=auth.STATUS_ACTIVE,
        ),
    ])
    await session.commit()
    return [DEFAULT_ADMIN["username"], DEFAULT_SHOP["username"]]


async def ensure_default_users_safely(session: AsyncSession) -> None:
    """At API start: a database without the users table (migration 0005 not run)
    must not stop the API from starting."""
    try:
        created = await ensure_default_users(session)
    except DBAPIError:
        await session.rollback()
        log.warning("users table missing - run `alembic upgrade head` to enable logins")
        return
    if created:
        log.info("created the default accounts: %s", ", ".join(created))
