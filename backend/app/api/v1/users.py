"""Accounts, for the admin: approve sign-ups, block, reset passwords."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import case, delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import require_admin
from app.api.errors import Problem
from app.api.schemas import UserOut, UserUpdateIn
from app.core import auth
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


@router.patch("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: int,
    body: UserUpdateIn,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> UserOut:
    """Approve or unblock (status active), block, or set a new password."""
    user = await _user(session, user_id)
    if body.status is not None and body.status != user.status:
        if user.id == admin.id:
            raise Problem(status=409, title="Not allowed", detail="You cannot block your own account.")
        user.status = body.status
        if body.status == auth.STATUS_BLOCKED:
            # blocking logs them out everywhere
            await session.execute(delete(UserSession).where(UserSession.user_id == user.id))
    if body.password is not None:
        if len(body.password) < auth.MIN_PASSWORD:
            raise Problem(
                status=422,
                title="Password too short",
                detail=f"A password needs at least {auth.MIN_PASSWORD} characters.",
            )
        user.password_hash = auth.hash_password(body.password)
    await session.commit()
    return UserOut.model_validate(user)


@router.delete("/{user_id}", status_code=204)
async def delete_user(
    user_id: int,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> None:
    """Remove an account - to turn down a sign-up, say.  Orders are not touched."""
    user = await _user(session, user_id)
    if user.id == admin.id:
        raise Problem(status=409, title="Not allowed", detail="You cannot delete your own account.")
    await session.delete(user)
    await session.commit()
