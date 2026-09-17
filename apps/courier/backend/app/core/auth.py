"""Passwords, platform tokens and the login identifier.

Passwords are PBKDF2-SHA256 (standard library).  Accounts that came over from
the warehouse carry bcrypt hashes; those verify too and are rewritten as
PBKDF2 the first time their owner logs in, so both modules end up writing one
format.

A login is a platform token: an HS256 JWT naming the account and its session
row in ``core.user_sessions``.  The warehouse API issues and accepts exactly the
same token (Warehouse.Api/Auth.cs), which is what makes one login work across
the whole platform.  The claim names below are that contract.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

import bcrypt
import jwt

from app.core.phone import PhoneError, normalise_my_mobile

ALGORITHM = "pbkdf2_sha256"
ITERATIONS = 390_000
SALT_BYTES = 16

ROLE_ADMIN = "admin"
ROLE_OPERATOR = "operator"
ROLE_MERCHANT = "merchant"
ROLES = (ROLE_ADMIN, ROLE_OPERATOR, ROLE_MERCHANT)

STATUS_ACTIVE = "active"
#: signed up, waiting for the admin to approve
STATUS_PENDING = "pending"
STATUS_BLOCKED = "blocked"

USERNAME = re.compile(r"[a-z0-9][a-z0-9._-]{2,31}")
EMAIL = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")
MIN_PASSWORD = 6

# ---- the platform token contract (see Warehouse.Api/Auth.cs TokenClaims) ----
TOKEN_ISSUER = "inaaya-platform"
TOKEN_AUDIENCE = "inaaya-platform"
TOKEN_ALGORITHM = "HS256"
COOKIE_NAME = "inaaya_session"


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def hash_password(password: str, *, salt: bytes | None = None, iterations: int = ITERATIONS) -> str:
    """``pbkdf2_sha256$<iterations>$<salt>$<hash>``"""
    salt = salt or secrets.token_bytes(SALT_BYTES)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"{ALGORITHM}${iterations}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, stored: str) -> bool:
    if not stored:
        return False
    if stored.startswith("$2"):
        try:
            return bcrypt.checkpw(password.encode("utf-8"), stored.encode("utf-8"))
        except ValueError:
            return False
    try:
        algorithm, iterations, salt, expected = stored.split("$")
        if algorithm != ALGORITHM:
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), base64.b64decode(salt), int(iterations)
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(_b64(digest), expected)


def needs_rehash(stored: str) -> bool:
    """True for a hash worth rewriting after a successful login."""
    return not stored.startswith(f"{ALGORITHM}${ITERATIONS}$")


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    """SHA-256 of a secret, for anything that must be stored but never shown."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# platform tokens
# ---------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class TokenClaims:
    user_id: int
    username: str
    name: str
    role: str
    session_id: uuid.UUID
    expires_at: datetime


class TokenError(ValueError):
    """The token is missing, forged, expired or not a platform token."""


def issue_token(
    *, secret: str, user_id: int, username: str, name: str, role: str,
    session_id: uuid.UUID, expires_at: datetime,
) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "iss": TOKEN_ISSUER,
        "aud": TOKEN_AUDIENCE,
        "iat": int(now.timestamp()),
        "nbf": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
        "uid": str(user_id),
        "username": username,
        "name": name,
        "role": role,
        "sid": str(session_id),
    }
    return jwt.encode(payload, secret, algorithm=TOKEN_ALGORITHM)


def read_token(token: str, *, secret: str, verify_expiry: bool = True) -> TokenClaims:
    try:
        claims = jwt.decode(
            token,
            secret,
            algorithms=[TOKEN_ALGORITHM],
            audience=TOKEN_AUDIENCE,
            issuer=TOKEN_ISSUER,
            options={"require": ["exp", "uid", "sid"], "verify_exp": verify_expiry},
        )
        return TokenClaims(
            user_id=int(claims["uid"]),
            username=str(claims.get("username", "")),
            name=str(claims.get("name", "")),
            role=str(claims.get("role", "")),
            session_id=uuid.UUID(str(claims["sid"])),
            expires_at=datetime.fromtimestamp(int(claims["exp"]), timezone.utc),
        )
    except (jwt.PyJWTError, KeyError, ValueError, TypeError) as exc:
        raise TokenError(str(exc)) from None


# ---------------------------------------------------------------------------
# the login box
# ---------------------------------------------------------------------------
def clean_username(value: str) -> str:
    return value.strip().lower()


def clean_email(value: str) -> str:
    return value.strip().lower()


def clean_phone(value: str) -> str:
    """``012-345 6789`` -> ``+60 123456789``; raises PhoneError when not a mobile."""
    return normalise_my_mobile(value)


def login_lookup(identifier: str) -> tuple[str, str]:
    """What the "Username / Phone Number / Email" box holds: ``(column, value)``.

    An ``@`` means an email; digits that make a Malaysian mobile mean a phone;
    anything else is a username.
    """
    text = identifier.strip()
    if "@" in text:
        return "email", clean_email(text)
    if re.fullmatch(r"[\d\s()+-]{9,}", text):
        try:
            return "phone", clean_phone(text)
        except PhoneError:
            pass
    return "username", clean_username(text)
