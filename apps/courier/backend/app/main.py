"""FastAPI application entry point - the courier (J&T) module of the platform."""
from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import APIRouter, Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import text

from app.api import errors
from app.api.auth import current_user, require_admin
from app.api.v1 import (
    address,
    admin,
    auth,
    bulk,
    orders,
    settings as settings_router,
    sources,
    tracking,
    users,
    waybills,
)
from app.config import BACKEND_DIR, get_settings
from app.db.session import dispose_engine, get_engine, get_sessionmaker
from app.db.users import ensure_default_users_safely
from app.waybill.text import register_fonts

TEMPLATE_CSV = BACKEND_DIR / "samples" / "bulk_orders_template.csv"

log = logging.getLogger("courier")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    settings.signing_secret  # noqa: B018 - refuses to start in production without a real secret
    register_fonts()
    settings.default_output_dir.mkdir(parents=True, exist_ok=True)
    async with get_sessionmaker()() as session:
        await ensure_default_users_safely(session)
    yield
    await dispose_engine()


app = FastAPI(
    title="Inaaya Commerce Platform - Courier API",
    version="2.0.0",
    description=(
        "The courier (J&T Express) module of the Inaaya Commerce Platform: single orders, "
        "bulk CSV import, waybills, WhatsApp order messages, tracking and the admin portal. "
        "Accounts and logins are shared with the warehouse module."
    ),
    lifespan=lifespan,
)

errors.install(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RequestContext:
    """A request id on every response (the gateway's, when it set one), and the
    same basic hardening headers the warehouse API sends.

    Plain ASGI rather than ``@app.middleware("http")``: the bulk progress
    endpoint is a server-sent event stream, and this wraps it without buffering.
    """

    def __init__(self, inner):
        self.inner = inner

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.inner(scope, receive, send)
            return

        incoming = dict(scope.get("headers") or [])
        request_id = (incoming.get(b"x-request-id", b"").decode("latin-1") or uuid.uuid4().hex)[:64]
        scope.setdefault("state", {})["request_id"] = request_id

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers") or [])
                names = {name.lower() for name, _ in headers}
                headers.append((b"x-request-id", request_id.encode("latin-1")))
                if b"x-content-type-options" not in names:
                    headers.append((b"x-content-type-options", b"nosniff"))
                if b"referrer-policy" not in names:
                    headers.append((b"referrer-policy", b"strict-origin-when-cross-origin"))
                message = {**message, "headers": headers}
            await send(message)

        await self.inner(scope, receive, send_with_headers)


app.add_middleware(RequestContext)


api = APIRouter(prefix="/api/v1")
# logged out: login, sign-up and the public tracking page (tracking.py guards
# its own admin routes)
api.include_router(auth.router)
api.include_router(tracking.router)
# any logged-in account: the merchant portal
LOGGED_IN = [Depends(current_user)]
api.include_router(settings_router.router, dependencies=LOGGED_IN)
api.include_router(orders.router, dependencies=LOGGED_IN)
api.include_router(bulk.router, dependencies=LOGGED_IN)
api.include_router(waybills.router, dependencies=LOGGED_IN)
api.include_router(address.router, dependencies=LOGGED_IN)
api.include_router(sources.router, dependencies=LOGGED_IN)
# the admin only: the admin portal
api.include_router(admin.router, dependencies=[Depends(require_admin)])
api.include_router(users.router)


@api.get(
    "/templates/bulk.csv",
    tags=["templates"],
    summary="Template Download",
    dependencies=[Depends(current_user)],
)
async def bulk_template() -> FileResponse:
    """The CSV template offered by the toolbar's Template Download button."""
    return FileResponse(
        TEMPLATE_CSV,
        media_type="text/csv",
        filename="bulk_orders_template.csv",
    )


app.include_router(api)


@app.get("/health", tags=["meta"])
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/live", tags=["meta"])
async def health_live() -> dict[str, str]:
    """The process answers."""
    return {"status": "ok", "service": "courier-api"}


@app.get("/health/ready", tags=["meta"])
async def health_ready() -> JSONResponse:
    """It can do its job: the database answers and this module's tables are migrated."""
    database = migrated = False
    try:
        async with get_engine().connect() as conn:
            database = (await conn.execute(text("SELECT 1"))).scalar() == 1
            migrated = bool(
                (await conn.execute(text("SELECT to_regclass('orders') IS NOT NULL"))).scalar()
            )
    except Exception:                                   # noqa: BLE001 - reported, not raised
        log.warning("readiness: database unavailable", exc_info=True)
    ok = database and migrated
    return JSONResponse(
        {"status": "ok" if ok else "unavailable", "service": "courier-api",
         "database": database, "migrated": migrated},
        status_code=200 if ok else 503,
    )
