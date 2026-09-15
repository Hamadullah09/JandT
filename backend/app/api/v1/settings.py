"""Sender profile - the single source of truth for who is shipping."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import active_sender
from app.api.schemas import SenderProfileIn, SenderProfileOut
from app.db.session import get_session

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/sender", response_model=SenderProfileOut)
async def read_sender(session: AsyncSession = Depends(get_session)) -> SenderProfileOut:
    return SenderProfileOut.model_validate(await active_sender(session))


@router.put("/sender", response_model=SenderProfileOut)
async def update_sender(
    body: SenderProfileIn, session: AsyncSession = Depends(get_session)
) -> SenderProfileOut:
    """Update the profile.

    Orders already created keep their snapshotted sender fields - this only
    affects orders created from now on.
    """
    sender = await active_sender(session)
    for name, value in body.model_dump(exclude_none=True).items():
        setattr(sender, name, value)
    sender.updated_at = datetime.now()
    await session.commit()
    await session.refresh(sender)
    return SenderProfileOut.model_validate(sender)
