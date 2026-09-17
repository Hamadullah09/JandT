"""Accounts, for the admin: approve sign-ups, block, reset passwords.

These are the platform's accounts (``core.users``): the same list the warehouse
dashboard's Users page shows, so a change made on either is made on both.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy import case, delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import client_ip, require_admin
from app.api.errors import Problem
from app.api.schemas import UserCreateIn, UserOut, UserUpdateIn
from app.api.v1.auth import new_account
from app.core import audit, auth
from app.db.models import User, UserSession
from app.db.session import get_session

router = APIRouter(prefix="/admin/users", tags=["admin"])


@router.get("", response_model=list[UserOut])
async def list_users(
    admin: User = Depends(require_admin), session: AsyncSession = Depends(get_session)
) -> list[UserOut]:
    """Waiting for approval first, then everyone else, newest first."""
    waiting_first = case((User.status == auth.STATUS_PENDING, 0), else_=1)
    users = await session.scalars(select(User).order_by(waiting_first, User.id.desc()))
    return [UserOut.model_validate(user) for user in users]


async def _user(session: AsyncSession, user_id: int) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise Problem(status=404, title="Account not found", detail=str(user_id))
    return user


@router.post("", response_model=UserOut, status_code=201)
async def create_user(
    body: UserCreateIn,
    request: Request,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> UserOut:
    """Add an account that can log in straight away - no approval step."""
    fields = await new_account(
        session,
        name=body.name,
        username=body.username,
        phone=body.phone,
        email=body.email,
        password=body.password,
        phone_required=False,
        title="Account not added",
    )
    user = User(**fields, role=body.role, status=auth.STATUS_ACTIVE)
    session.add(user)
    await session.commit()
    await session.refresh(user)
    await audit.record("user.created", actor_id=admin.id, username=admin.username, entity="user",
                       entity_id=user.id, detail={"username": user.username, "role": user.role},
                       ip=client_ip(request))
    return UserOut.model_validate(user)


@router.patch("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: int,
    body: UserUpdateIn,
    request: Request,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> UserOut:
    """Approve or unblock (status active), block, or set a new password."""
    user = await _user(session, user_id)
    changes: dict[str, str] = {}
    if body.status is not None and body.status != user.status:
        if user.id == admin.id:
            raise Problem(status=409, title="Not allowed", detail="You cannot block your own account.")
        user.status = body.status
        changes["status"] = body.status
        if body.status == auth.STATUS_BLOCKED:
            # blocking logs them out everywhere - this portal, the warehouse, the handhelds
            await session.execute(delete(UserSession).where(UserSession.user_id == user.id))
    if body.password is not None:
        if len(body.password) < auth.MIN_PASSWORD:
            raise Problem(
                status=422,
                title="Password too short",
                detail=f"A password needs at least {auth.MIN_PASSWORD} characters.",
            )
        user.password_hash = auth.hash_password(body.password)
        changes["password"] = "reset"
    await session.commit()
    if changes:
        await audit.record("user.updated", actor_id=admin.id, username=admin.username, entity="user",
                           entity_id=user.id, detail=changes, ip=client_ip(request))
    return UserOut.model_validate(user)


@router.delete("/{user_id}", status_code=204)
async def delete_user(
    user_id: int,
    request: Request,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> None:
    """Remove an account - to turn down a sign-up, say.  Orders are not touched."""
    user = await _user(session, user_id)
    if user.id == admin.id:
        raise Problem(status=409, title="Not allowed", detail="You cannot delete your own account.")
    username = user.username
    await session.delete(user)
    await session.commit()
    await audit.record("user.deleted", actor_id=admin.id, username=admin.username, entity="user",
                       entity_id=user_id, detail={"username": username}, ip=client_ip(request))
