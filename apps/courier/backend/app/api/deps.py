"""Shared FastAPI dependencies."""
from __future__ import annotations

from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import Problem
from app.config import get_settings
from app.core.naming import OutputDirError, validate_output_dir
from app.db.models import SenderProfile


async def active_sender(session: AsyncSession) -> SenderProfile:
    """The one active sender profile, or a loud 500 if seeding never ran."""
    sender = await session.scalar(
        select(SenderProfile).where(SenderProfile.is_active.is_(True))
    )
    if sender is None:
        raise Problem(
            status=500,
            title="No sender profile",
            detail=(
                "No active sender profile exists. Run `python -m app.db.seed` "
                "or restart the API container."
            ),
        )
    return sender


def resolve_output_dir(raw: str | None) -> Path:
    """Validate a caller-supplied output directory, or fall back to the default."""
    target = raw or str(get_settings().default_output_dir)
    try:
        return validate_output_dir(target)
    except OutputDirError as exc:
        raise Problem(
            status=400,
            title="Output directory unusable",
            detail=str(exc),
            type_="urn:jt:output-dir",
        ) from exc
