"""The order sources the forms offer: Website, WhatsApp, Daraz, Amazon..."""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app.core.sources import DEFAULT_SOURCE, SOURCES

router = APIRouter(prefix="/sources", tags=["orders"])


class SourceOut(BaseModel):
    name: str
    kind: str
    default: bool


@router.get("", response_model=list[SourceOut])
async def list_sources() -> list[SourceOut]:
    return [
        SourceOut(name=source.name, kind=source.kind, default=source.name == DEFAULT_SOURCE)
        for source in SOURCES
    ]
