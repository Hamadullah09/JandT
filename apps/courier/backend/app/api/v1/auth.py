"""Login, logout, sign-up, and who is logged in."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import client_ip, current_user, end_session, start_session
from app.api.errors import Problem
from app.api.schemas import LoginIn, MeOut, SignupIn, SignupOut
from app.core import audit, auth
from app.db.models import SenderProfile, User
from app.db.session import get_session

router = APIRouter(prefix="/auth", tags=["auth"])

#: checked when the login is unknown, so a wrong username takes as long as a wrong password
_NOBODY = auth.hash_password("not-a-real-password")


async def me_out(session: AsyncSession, user: User) -> MeOut:
    sender = await session.scalar(select(SenderProfile).where(SenderProfile.is_active.is_(True)))
    return MeOut(
        id=user.id,
        username=user.username,
        name=user.name,
        role=user.role,
        account_code=sender.account_code if sender else None,
        company_name=sender.company_name if sender else None,
    )


@router.post("/login", response_model=MeOut)
async def login(
    body: LoginIn,
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> MeOut:
    """Log in with a username, phone number or email - one login for the whole platform."""
    if not body.login.strip() or not body.password:
        raise Problem(status=422, title="Login failed", detail="Enter your username and password.")
    column, value = auth.login_lookup(body.login)
    user = await session.scalar(select(User).where(getattr(User, column) == value))
    if user is None:
        auth.verify_password(body.password, _NOBODY)
        await audit.record("auth.login", outcome="failure", username=value,
                           detail={"reason": "unknown_user"}, ip=client_ip(request))
        raise Problem(status=401, title="Login failed", detail="Wrong username or password.")
    if not auth.verify_password(body.password, user.password_hash):
        await audit.record("auth.login", outcome="failure", username=user.username,
                           detail={"reason": "wrong_password"}, ip=client_ip(request))
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
    if auth.needs_rehash(user.password_hash):
        # a warehouse bcrypt hash, or an older iteration count: one format from now on
        user.password_hash = auth.hash_password(body.password)
    await start_session(session, user, request, response)
    await audit.record("auth.login", actor_id=user.id, username=user.username,
                       entity="user", entity_id=user.id, ip=client_ip(request))
    return await me_out(session, user)


@router.post("/logout", status_code=204)
async def logout(request: Request, session: AsyncSession = Depends(get_session)) -> Response:
    response = Response(status_code=204)
    user = await end_session(session, request, response)
    if user is not None:
        await audit.record("auth.logout", actor_id=user.id, username=user.username, ip=client_ip(request))
    return response


@router.get("/me", response_model=MeOut)
async def me(
    user: User = Depends(current_user), session: AsyncSession = Depends(get_session)
) -> MeOut:
    return await me_out(session, user)


async def new_account(
    session: AsyncSession,
    *,
    name: str,
    username: str,
    phone: str,
    email: str,
    password: str,
    phone_required: bool,
    title: str,
) -> dict:
    """Check a new account's details - each problem gets one plain message.

    Returns the cleaned fields for a :class:`User`.
    """
    name = " ".join(name.split())
    username = auth.clean_username(username)
    email = auth.clean_email(email)

    if len(name) < 2:
        raise Problem(status=422, title=title, detail="Enter a name.")
    if not auth.USERNAME.fullmatch(username):
        raise Problem(
            status=422,
            title=title,
            detail="Username must be 3-32 letters or numbers (dots, dashes and underscores are fine).",
        )
    clean_phone = None
    if phone.strip() or phone_required:
        try:
            clean_phone = auth.clean_phone(phone)
        except auth.PhoneError:
            raise Problem(
                status=422, title=title, detail="Enter a Malaysian mobile number, e.g. 0123456789."
            ) from None
    if email and not auth.EMAIL.fullmatch(email):
        raise Problem(status=422, title=title, detail="Enter a valid email, or leave it empty.")
    if len(password) < auth.MIN_PASSWORD:
        raise Problem(
            status=422, title=title, detail=f"Password must be at least {auth.MIN_PASSWORD} characters."
        )

    clauses = [User.username == username]
    if clean_phone:
        clauses.append(User.phone == clean_phone)
    if email:
        clauses.append(User.email == email)
    taken = await session.scalar(select(User).where(or_(*clauses)))
    if taken is not None:
        what = (
            "username" if taken.username.lower() == username
            else "phone number" if clean_phone and taken.phone == clean_phone
            else "email"
        )
        raise Problem(status=409, title=title, detail=f"An account with this {what} already exists.")

    return {
        "username": username,
        "name": name,
        "phone": clean_phone,
        "email": email or None,
        "password_hash": auth.hash_password(password),
    }


@router.post("/signup", response_model=SignupOut, status_code=201)
async def signup(
    body: SignupIn, request: Request, session: AsyncSession = Depends(get_session)
) -> SignupOut:
    """Create an account that can log in once the admin approves it."""
    if body.name.strip() and body.password and body.password != body.confirm_password:
        raise Problem(status=422, title="Sign-up failed", detail="The two passwords are not the same.")
    fields = await new_account(
        session,
        name=body.name,
        username=body.username,
        phone=body.phone,
        email=body.email,
        password=body.password,
        phone_required=True,
        title="Sign-up failed",
    )
    username = fields["username"]
    user = User(**fields, role=auth.ROLE_MERCHANT, status=auth.STATUS_PENDING)
    session.add(user)
    await session.commit()
    await audit.record("user.signed_up", username=username, entity="user", entity_id=user.id,
                       ip=client_ip(request))
    return SignupOut(
        username=username,
        status=auth.STATUS_PENDING,
        message="Your account has been created. You can log in once the admin approves it.",
    )
