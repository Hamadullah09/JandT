"""Logins: passwords, the login box, and who may call what."""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.core import auth
from app.main import app
from tests.conftest import requires_db


class TestPasswords:
    def test_a_password_is_stored_as_a_salted_hash(self):
        stored = auth.hash_password("admin123")
        assert stored.startswith("pbkdf2_sha256$") and "admin123" not in stored
        assert stored != auth.hash_password("admin123")          # a new salt every time

    def test_the_right_password_passes_and_a_wrong_one_does_not(self):
        stored = auth.hash_password("linked123", iterations=1000)
        assert auth.verify_password("linked123", stored)
        assert not auth.verify_password("Linked123", stored)
        assert not auth.verify_password("", stored)

    @pytest.mark.parametrize("broken", ["", "plain-text", "md5$1$abc$def", "pbkdf2_sha256$x$y$z"])
    def test_a_damaged_hash_never_logs_anyone_in(self, broken):
        assert auth.verify_password("anything", broken) is False

    def test_only_a_hash_of_the_session_token_is_kept(self):
        token = auth.new_token()
        assert len(token) >= 40
        assert auth.token_hash(token) != token and len(auth.token_hash(token)) == 64


class TestTheLoginBox:
    @pytest.mark.parametrize(
        ("typed", "lookup"),
        [
            ("admin", ("username", "admin")),
            ("  Linked ", ("username", "linked")),
            ("0135763706", ("phone", "+60 135763706")),
            ("+60 13-576 3706", ("phone", "+60 135763706")),
            ("Shop@Example.com", ("email", "shop@example.com")),
            ("123", ("username", "123")),
        ],
    )
    def test_username_phone_or_email(self, typed, lookup):
        assert auth.login_lookup(typed) == lookup

    @pytest.mark.parametrize("name", ["ali", "shop.staff", "linked_2", "a-b-c"])
    def test_good_usernames(self, name):
        assert auth.USERNAME.fullmatch(name)

    @pytest.mark.parametrize("name", ["ab", "Ali", "has space", "_ali", "x" * 33])
    def test_bad_usernames(self, name):
        assert not auth.USERNAME.fullmatch(name)


ANONYMOUS_REFUSED = [
    ("get", "/api/v1/auth/me"),
    ("get", "/api/v1/orders"),
    ("post", "/api/v1/orders"),
    ("post", "/api/v1/bulk/upload"),
    ("get", "/api/v1/waybills/632158575344.pdf"),
    ("get", "/api/v1/settings/sender"),
    ("post", "/api/v1/address/parse"),
    ("get", "/api/v1/templates/bulk.csv"),
    ("get", "/api/v1/admin/orders"),
    ("post", "/api/v1/tracking/events"),
    ("get", "/api/v1/admin/users"),
]
ADMIN_ONLY = [
    ("get", "/api/v1/admin/orders"),
    ("get", "/api/v1/admin/orders/export.csv"),
    ("get", "/api/v1/admin/orders/632158575344"),
    ("get", "/api/v1/tracking/event-types"),
    ("post", "/api/v1/tracking/events"),
    ("delete", "/api/v1/tracking/events/1"),
    ("get", "/api/v1/admin/users"),
    ("post", "/api/v1/admin/users"),
    ("patch", "/api/v1/admin/users/1"),
    ("delete", "/api/v1/admin/users/1"),
]


async def call(method: str, path: str):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        kwargs = {"json": {}} if method in {"post", "patch"} else {}
        return await getattr(client, method)(path, **kwargs)


@pytest.fixture
def logged_in_shop():
    from app.api.auth import current_user
    from app.db.models import User

    shop = User(id=2, username="linked", name="Shop", role="merchant", status="active", password_hash="x")
    app.dependency_overrides[current_user] = lambda: shop
    yield shop
    app.dependency_overrides.pop(current_user, None)


class TestWhoMayCallWhat:
    """Answered before the database is touched, so these run without one."""

    @pytest.mark.parametrize(("method", "path"), ANONYMOUS_REFUSED)
    async def test_without_a_login_the_portals_answer_401(self, method, path):
        response = await call(method, path)
        assert response.status_code == 401, response.text
        assert response.json()["detail"] == "Please log in."

    @pytest.mark.parametrize(("method", "path"), ADMIN_ONLY)
    async def test_the_shop_account_cannot_use_the_admin_portal(self, logged_in_shop, method, path):
        response = await call(method, path)
        assert response.status_code == 403, response.text
        assert response.json()["detail"] == "Only the admin can do this."

    async def test_the_tracking_page_needs_no_login(self):
        response = await call("get", "/api/v1/tracking?awb=")
        assert (response.status_code, response.json()) == (200, [])

    async def test_login_and_sign_up_need_no_login(self):
        login = await call("post", "/api/v1/auth/login")
        assert (login.status_code, login.json()["detail"]) == (422, "Enter your username and password.")
        signup = await call("post", "/api/v1/auth/signup")
        assert (signup.status_code, signup.json()["detail"]) == (422, "Enter a name.")


# ---------------------------------------------------------------------------
# the whole flow, against the test database
# ---------------------------------------------------------------------------
@pytest.fixture
async def accounts(session):
    from sqlalchemy import text

    from app.db.users import ensure_default_users

    await session.execute(text("TRUNCATE users RESTART IDENTITY CASCADE"))
    await session.commit()
    assert await ensure_default_users(session) == ["admin", "linked"]
    return session


@pytest.fixture
async def browser(accounts):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client


async def log_in(client, login, password):
    return await client.post("/api/v1/auth/login", json={"login": login, "password": password})


@requires_db
@pytest.mark.db
class TestLoginFlow:
    async def test_the_admin_logs_in_and_out(self, browser):
        response = await log_in(browser, "admin", "admin123")
        assert response.status_code == 200 and response.json()["role"] == "admin"
        assert "inaaya_session" in response.cookies
        assert (await browser.get("/api/v1/admin/orders")).status_code == 200

        assert (await browser.post("/api/v1/auth/logout")).status_code == 204
        assert (await browser.get("/api/v1/auth/me")).status_code == 401

    async def test_the_shop_logs_in_with_username_or_phone_but_is_not_the_admin(self, browser):
        response = await log_in(browser, "0135763706", "linked123")
        assert response.status_code == 200, response.text
        me = response.json()
        assert (me["username"], me["role"], me["account_code"]) == ("linked", "merchant", "JTMY027288")
        assert (await browser.get("/api/v1/orders")).status_code == 200
        assert (await browser.get("/api/v1/admin/orders")).status_code == 403

    async def test_a_wrong_password_says_nothing_about_which_part_was_wrong(self, browser):
        assert (await log_in(browser, "admin", "nope")).json()["detail"] == "Wrong username or password."
        assert (await log_in(browser, "nobody", "nope")).json()["detail"] == "Wrong username or password."

    async def test_a_sign_up_waits_for_the_admin_then_gets_in(self, browser):
        signup = {
            "name": "Aina Staff", "username": "aina", "phone": "0171234567",
            "email": "", "password": "secret1", "confirm_password": "secret1",
        }
        response = await browser.post("/api/v1/auth/signup", json=signup)
        assert response.status_code == 201 and response.json()["status"] == "pending"
        assert (await browser.post("/api/v1/auth/signup", json=signup)).status_code == 409

        waiting = await log_in(browser, "aina", "secret1")
        assert waiting.status_code == 403
        assert waiting.json()["detail"] == "Your account is waiting for the admin to approve it."

        await log_in(browser, "admin", "admin123")
        users = (await browser.get("/api/v1/admin/users")).json()
        assert users[0]["username"] == "aina"                        # waiting first
        approved = await browser.patch(f"/api/v1/admin/users/{users[0]['id']}", json={"status": "active"})
        assert approved.json()["status"] == "active"
        await browser.post("/api/v1/auth/logout")

        assert (await log_in(browser, "aina", "secret1")).status_code == 200

    async def test_blocking_logs_the_account_out(self, browser):
        await log_in(browser, "linked", "linked123")
        shop_cookie = browser.cookies.get("inaaya_session")

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as admin:
            await log_in(admin, "admin", "admin123")
            users = {u["username"]: u for u in (await admin.get("/api/v1/admin/users")).json()}
            await admin.patch(f"/api/v1/admin/users/{users['linked']['id']}", json={"status": "blocked"})
            refused = await admin.patch(
                f"/api/v1/admin/users/{users['admin']['id']}", json={"status": "blocked"}
            )
            assert refused.status_code == 409

        browser.cookies.set("inaaya_session", shop_cookie)
        assert (await browser.get("/api/v1/orders")).status_code == 401
        assert (await log_in(browser, "linked", "linked123")).status_code == 403

    async def test_the_default_accounts_are_made_only_once(self, accounts):
        from app.db.users import ensure_default_users

        assert await ensure_default_users(accounts) == []


@requires_db
@pytest.mark.db
class TestAdminAddsUsers:
    async def test_an_added_account_can_log_in_straight_away(self, browser):
        await log_in(browser, "admin", "admin123")
        response = await browser.post(
            "/api/v1/admin/users",
            json={"name": "Packing Staff", "username": "packer", "password": "secret1", "role": "merchant"},
        )
        assert response.status_code == 201 and response.json()["status"] == "active"
        again = await browser.post(
            "/api/v1/admin/users", json={"name": "Someone", "username": "packer", "password": "secret1"}
        )
        assert again.status_code == 409
        await browser.post("/api/v1/auth/logout")
        assert (await log_in(browser, "packer", "secret1")).status_code == 200
