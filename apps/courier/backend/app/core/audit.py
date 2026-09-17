"""The platform audit trail (``core.audit_log``), from the courier side.

Logins, sign-ups and account changes are recorded next to the warehouse's own
entries, so an admin reads one trail for the whole platform.

Written on its own short connection and never inside the caller's transaction:
a failed audit insert must not roll back - or even delay - the change it
describes.  Failures are logged and swallowed.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy import text

from app.db.session import get_engine

log = logging.getLogger(__name__)

_INSERT = text(
    """
    INSERT INTO core.audit_log (module, action, outcome, actor_user_id, actor_username,
                                entity, entity_id, detail, ip)
    VALUES ('courier', :action, :outcome, :actor_id, :username,
            :entity, :entity_id, CAST(:detail AS jsonb), :ip)
    """
)


async def record(
    action: str,
    *,
    outcome: str = "success",
    actor_id: int | None = None,
    username: str | None = None,
    entity: str | None = None,
    entity_id: str | int | None = None,
    detail: dict[str, Any] | None = None,
    ip: str | None = None,
) -> None:
    try:
        async with get_engine().begin() as conn:
            await conn.execute(
                _INSERT,
                {
                    "action": action,
                    "outcome": outcome,
                    "actor_id": actor_id,
                    "username": username,
                    "entity": entity,
                    "entity_id": None if entity_id is None else str(entity_id),
                    "detail": None if detail is None else json.dumps(detail, default=str),
                    "ip": ip,
                },
            )
    except Exception:                               # noqa: BLE001 - see the module docstring
        log.warning("audit: could not record %s", action, exc_info=True)
