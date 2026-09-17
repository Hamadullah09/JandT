"""FastAPI application entry point."""
from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import APIRouter, Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app.api import errors
from app.api.auth import current_user, require_admin
from app.api.v1 import (
    address,
    admin,
    auth,
    bulk,
    orders,
    settings as settings_router,
    tracking,
    users,
    waybills,
)
from app.config import BACKEND_DIR, get_settings
from app.db.session import dispose_engine, get_sessionmaker
from app.db.users import ensure_default_users_safely
from app.waybill.text import register_fonts

TEMPLATE_CSV = BACKEND_DIR / "samples" / "bulk_orders_template.csv"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    register_fonts()
    get_settings().default_output_dir.mkdir(parents=True, exist_ok=True)
    async with get_sessionmaker()() as session:
        await ensure_default_users_safely(session)
    yield
    await dispose_engine()


app = FastAPI(
    title="JT-CLONE API",
    version="1.0.0",
    description=(
        "Self-hosted replica of the J&T Express merchant portal: single order "
        "creation, bulk CSV import and J&T-format waybill rendering."
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
