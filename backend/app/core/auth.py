"""Passwords, session tokens and the login identifier.

Standard library only: PBKDF2-SHA256 for passwords, random URL-safe tokens for
sessions.  The database keeps only a password's hash and a token's SHA-256 -
never the password or the token itself - so a copy of the database logs no
one in.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets

from app.core.phone import PhoneError, normalise_my_mobile

ALGORITHM = "pbkdf2_sha256"
ITERATIONS = 390_000
SALT_BYTES = 16

ROLE_ADMIN = "admin"
ROLE_MERCHANT = "merchant"

STATUS_ACTIVE = "active"
#: signed up, waiting for the admin to approve
STATUS_PENDING = "pending"
STATUS_BLOCKED = "blocked"

USERNAME = re.compile(r"[a-z0-9][a-z0-9._-]{2,31}")
EMAIL = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")
MIN_PASSWORD = 6


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def hash_password(password: str, *, salt: bytes | None = None, iterations: int = ITERATIONS) -> str:
    """``pbkdf2_sha256$<iterations>$<salt>$<hash>``"""
    salt = salt or secrets.token_bytes(SALT_BYTES)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"{ALGORITHM}${iterations}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, stored: str) -> bool:
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


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    """What the sessions table stores instead of the token."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


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
