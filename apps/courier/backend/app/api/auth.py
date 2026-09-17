"""Who is calling: the platform session, and the admin-only guard.

A login creates a row in ``core.user_sessions`` and a signed platform token that
names it.  Browsers carry the token in the ``inaaya_session`` HttpOnly cookie,
which the gateway serves on the same origin as the warehouse dashboard - so
logging in here logs in there too.  API clients (the warehouse API booking a
parcel for its user) send the same token as ``Authorization: Bearer``.

A token is only as good as its session row: logging out or blocking an account
deletes the rows, and every request checks.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import Depends, Request, Response
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import Problem
from app.config import get_settings
from app.core import auth
from app.db.models import User, UserSession
from app.db.session import get_session

SESSION_COOKIE = auth.COOKIE_NAME
#: last_seen_at is refreshed at most this often per session
_TOUCH_EVERY = timedelta(minutes=1)
_UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    return request.client.host if request.client else None


def _token_from(request: Request) -> tuple[str | None, bool]:
    """The token, and whether it came from the cookie (which needs a CSRF check)."""
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip() or None, False
    return request.cookies.get(SESSION_COOKIE), True


def _cross_site(request: Request) -> bool:
    """A cookie-authenticated change that the browser says came from another site.

    Sec-Fetch-Site is sent by every current browser; Origin covers the rest.  A
    request with neither is not from a browser page, so the cookie was not sent
    on somebody's behalf.
    """
    site = request.headers.get("sec-fetch-site", "")
    if site:
        return site in {"cross-site", "same-site"}
    origin = request.headers.get("origin", "")
    if not origin:
        return False
    host = request.headers.get("x-forwarded-host") or request.headers.get("host", "")
    return origin.split("://", 1)[-1].rstrip("/").lower() != host.lower()


async def start_session(
    session: AsyncSession, user: User, request: Request, response: Response
) -> str:
    """Record the login, set the cookie, and return the token."""
    settings = get_settings()
    now = _now()
    expires = now + timedelta(hours=settings.auth_session_hours)
    session_id = uuid.uuid4()

    session.add(
        UserSession(
            id=session_id,
            user_id=user.id,
            client="web",
            expires_at=expires,
            last_seen_at=now,
            ip=client_ip(request),
            user_agent=(request.headers.get("user-agent") or "")[:256] or None,
        )
    )
    user.last_login_at = now
    # expired logins are cleared whenever someone logs in
    await session.execute(delete(UserSession).where(UserSession.expires_at <= now - timedelta(days=1)))
    await session.commit()

    token = auth.issue_token(
        secret=settings.signing_secret,
        user_id=user.id,
        username=user.username,
        name=user.name,
        role=user.role,
        session_id=session_id,
        expires_at=expires,
    )
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=int((expires - now).total_seconds()),
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )
    return token


async def end_session(session: AsyncSession, request: Request, response: Response) -> User | None:
    """Delete the session row (wherever the token was issued) and the cookie."""
    token, from_cookie = _token_from(request)
    if token and from_cookie and _cross_site(request):
        raise Problem(status=403, title="Refused", detail="That request did not come from this site.")
    user: User | None = None
    if token:
        try:
            claims = auth.read_token(token, secret=get_settings().signing_secret, verify_expiry=False)
        except auth.TokenError:
            claims = None
        if claims is not None:
            user = await session.get(User, claims.user_id)
            await session.execute(delete(UserSession).where(UserSession.id == claims.session_id))
            await session.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")
    return user


async def current_user(request: Request, session: AsyncSession = Depends(get_session)) -> User:
    """The logged-in, active account - or 401."""
    token, from_cookie = _token_from(request)
    if not token:
        raise Problem(status=401, title="Not logged in", detail="Please log in.")

    try:
        claims = auth.read_token(token, secret=get_settings().signing_secret)
    except auth.TokenError:
        raise Problem(
            status=401, title="Not logged in", detail="Your login has expired. Please log in again."
        ) from None

    login = await session.get(UserSession, claims.session_id)
    now = _now()
    if (
        login is None
        or login.user_id != claims.user_id
        or login.revoked_at is not None
        or login.expires_at <= now
    ):
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

    if from_cookie and request.method in _UNSAFE_METHODS and _cross_site(request):
        raise Problem(status=403, title="Refused", detail="That request did not come from this site.")

    if login.last_seen_at is None or now - login.last_seen_at > _TOUCH_EVERY:
        login.last_seen_at = now
        await session.commit()

    request.state.user = user
    return user


async def require_admin(user: User = Depends(current_user)) -> User:
    if user.role != auth.ROLE_ADMIN:
        raise Problem(status=403, title="Admins only", detail="Only the admin can do this.")
    return user
