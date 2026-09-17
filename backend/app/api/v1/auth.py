"""Login, logout, sign-up, and who is logged in."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import current_user, end_session, start_session
from app.api.errors import Problem
from app.api.schemas import LoginIn, MeOut, SignupIn, SignupOut
from app.core import auth
from app.db.models import SenderProfile, User
from app.db.session import get_session

router = APIRouter(prefix="/auth", tags=["auth"])

#: checked when the login is unknown, so a wrong username takes as long as a wrong password
_NOBODY = auth.hash_password("not-a-real-password")


async def me_out(session: AsyncSession, user: User) -> MeOut:
    sender = await session.scalar(select(SenderProfile).where(SenderProfile.is_active.is_(True)))
    return MeOut(
        username=user.username,
        name=user.name,
        role=user.role,
        account_code=sender.account_code if sender else None,
        company_name=sender.company_name if sender else None,
    )


@router.post("/login", response_model=MeOut)
async def login(
    body: LoginIn, response: Response, session: AsyncSession = Depends(get_session)
) -> MeOut:
    """Log in with a username, phone number or email."""
    if not body.login.strip() or not body.password:
        raise Problem(status=422, title="Login failed", detail="Enter your username and password.")
    column, value = auth.login_lookup(body.login)
    user = await session.scalar(select(User).where(getattr(User, column) == value))
    if user is None:
        auth.verify_password(body.password, _NOBODY)
        raise Problem(status=401, title="Login failed", detail="Wrong username or password.")
    if not auth.verify_password(body.password, user.password_hash):
        raise Problem(status=401, title="Login failed", detail="Wrong username or password.")
    if user.status == auth.STATUS_PENDING:
        raise Problem(
            status=403,
            title="Waiting for approval",
            detail="Your account is waiting for the admin to approve it.",
        )
    if user.status != auth.STATUS_ACTIVE:
        raise Problem(
            status=403,
            title="Account blocked",
            detail="Your account has been blocked. Please contact the admin.",
        )
    await start_session(session, user, response)
    return await me_out(session, user)


@router.post("/logout", status_code=204)
async def logout(request: Request, session: AsyncSession = Depends(get_session)) -> Response:
    response = Response(status_code=204)
    await end_session(session, request, response)
    return response


@router.get("/me", response_model=MeOut)
async def me(
    user: User = Depends(current_user), session: AsyncSession = Depends(get_session)
) -> MeOut:
    return await me_out(session, user)


@router.post("/signup", response_model=SignupOut, status_code=201)
async def signup(body: SignupIn, session: AsyncSession = Depends(get_session)) -> SignupOut:
    """Create an account that can log in once the admin approves it."""
    name = " ".join(body.name.split())
    username = auth.clean_username(body.username)
    email = auth.clean_email(body.email)

    if len(name) < 2:
        raise Problem(status=422, title="Sign-up failed", detail="Enter your name.")
    if not auth.USERNAME.fullmatch(username):
        raise Problem(
            status=422,
            title="Sign-up failed",
            detail="Username must be 3-32 letters or numbers (dots, dashes and underscores are fine).",
        )
    try:
        phone = auth.clean_phone(body.phone)
    except auth.PhoneError:
        raise Problem(
            status=422, title="Sign-up failed", detail="Enter a Malaysian mobile number, e.g. 0123456789."
        ) from None
    if email and not auth.EMAIL.fullmatch(email):
        raise Problem(status=422, title="Sign-up failed", detail="Enter a valid email, or leave it empty.")
    if len(body.password) < auth.MIN_PASSWORD:
        raise Problem(
            status=422,
            title="Sign-up failed",
            detail=f"Password must be at least {auth.MIN_PASSWORD} characters.",
        )
    if body.password != body.confirm_password:
        raise Problem(status=422, title="Sign-up failed", detail="The two passwords are not the same.")

    clauses = [User.username == username, User.phone == phone]
    if email:
        clauses.append(User.email == email)
    taken = await session.scalar(select(User).where(or_(*clauses)))
    if taken is not None:
        what = (
            "username" if taken.username == username
            else "phone number" if taken.phone == phone
            else "email"
        )
        raise Problem(
            status=409, title="Sign-up failed", detail=f"An account with this {what} already exists."
        )

    session.add(
        User(
            username=username,
            name=name,
            phone=phone,
            email=email or None,
            password_hash=auth.hash_password(body.password),
            role=auth.ROLE_MERCHANT,
            status=auth.STATUS_PENDING,
        )
    )
    await session.commit()
    return SignupOut(
        username=username,
        status=auth.STATUS_PENDING,
        message="Your account has been created. You can log in once the admin approves it.",
    )
