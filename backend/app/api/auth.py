"""Who is calling: the session cookie, and the admin-only guard.

A login sets an HttpOnly cookie holding a random token; ``user_sessions``
stores only the token's SHA-256.  The website on localhost:3000 and the API on
localhost:8000 share the cookie - cookies are per host, not per port - so the
browser sends it with every API call made with ``credentials: 'include'``.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import Depends, Request, Response
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import Problem
from app.core import auth
from app.db.models import User, UserSession
from app.db.session import get_session

SESSION_COOKIE = "jt_session"
SESSION_DAYS = 7


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def start_session(session: AsyncSession, user: User, response: Response) -> None:
    token = auth.new_token()
    now = _now()
    session.add(
        UserSession(
            token_hash=auth.token_hash(token),
            user_id=user.id,
            expires_at=now + timedelta(days=SESSION_DAYS),
        )
    )
    user.last_login_at = now
    # expired logins are cleared whenever someone logs in
    await session.execute(delete(UserSession).where(UserSession.expires_at <= now))
    await session.commit()
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_DAYS * 24 * 3600,
        httponly=True,
        samesite="lax",
        path="/",
    )


async def end_session(session: AsyncSession, request: Request, response: Response) -> None:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        await session.execute(
            delete(UserSession).where(UserSession.token_hash == auth.token_hash(token))
        )
        await session.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")


async def current_user(request: Request, session: AsyncSession = Depends(get_session)) -> User:
    """The logged-in, active account - or 401."""
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise Problem(status=401, title="Not logged in", detail="Please log in.")
    login = await session.get(UserSession, auth.token_hash(token))
    if login is None or login.expires_at <= _now():
        raise Problem(
            status=401, title="Not logged in", detail="Your login has expired. Please log in again."
        )
    user = await session.get(User, login.user_id)
    if user is None or user.status != auth.STATUS_ACTIVE:
        raise Problem(
            status=401,
            title="Not logged in",
            detail="This account can no longer log in. Please contact the admin.",
        )
    return user


async def require_admin(user: User = Depends(current_user)) -> User:
    if user.role != auth.ROLE_ADMIN:
        raise Problem(status=403, title="Admins only", detail="Only the admin can do this.")
    return user
