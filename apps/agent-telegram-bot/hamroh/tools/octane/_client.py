"""Shared plumbing for Octane tools: env config, backend HTTP, sender verification.

Every Octane tool is a thin, paranoid pipe: the model's arguments are cross-checked against
the bot's OWN message DB (the claimed asker must have actually spoken in this chat recently),
and the mytrion backend re-verifies identity/role/carrier on its side (see mytrion
src/routes/v1/supportBot.routes.ts — the RBAC gate lives THERE, not here).
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from ...db.database import Database
from ...db.messages import RecentMessagesQuery, fetch_recent_messages
from ..base import ToolResult

RECENT_WINDOW = timedelta(minutes=5)


def ok(content: str) -> ToolResult:
    return ToolResult(content=content)


def err(content: str) -> ToolResult:
    return ToolResult(content=content, is_error=True)


def octane_env() -> tuple[str, str, str] | None:
    base = os.environ.get("OCTANE_API_BASE", "").rstrip("/")
    key = os.environ.get("OCTANE_INTERNAL_API_KEY", "")
    carrier = os.environ.get("OCTANE_CARRIER_ID", "")
    if not (base and key and carrier):
        return None
    return base, key, carrier


async def post_backend(path: str, payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    cfg = octane_env()
    if cfg is None:
        return 0, {"message": "Octane integration is not configured on this instance"}
    base, key, carrier = cfg
    body = {"carrierId": carrier, **payload}
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{base}/v1{path}",
            headers={"Authorization": f"Bearer {key}"},
            json=body,
        )
    try:
        data = resp.json()
    except Exception:  # noqa: BLE001 - body may not be JSON
        data = {"message": resp.text[:200]}
    return resp.status_code, data


def _recent_enough(raw_ts: object) -> bool:
    try:
        ts = datetime.fromisoformat(str(raw_ts))
    except ValueError:
        return False
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - ts <= RECENT_WINDOW


async def sender_spoke_recently(db: Database | None, chat_id: int, user_id: int) -> bool:
    """The claimed asker must have sent a recent INBOUND message in this chat — the model
    cannot point a tool at someone who never spoke."""
    if db is None:
        return False
    rows = await fetch_recent_messages(
        db, RecentMessagesQuery(limit=50, include_unprocessed=True, chat_id=chat_id)
    )
    return any(
        r.get("direction") == "in" and r.get("user_id") == user_id and _recent_enough(r.get("timestamp"))
        for r in rows
    )
