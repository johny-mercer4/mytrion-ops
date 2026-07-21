"""Shared plumbing for Octane tools: env config, backend HTTP, sender verification.

Every Octane tool is a thin, paranoid pipe: the model's arguments are cross-checked against
the bot's OWN message DB (the claimed asker must have actually spoken in this chat recently),
and the mytrion backend re-verifies identity/role/carrier on its side (see mytrion
src/routes/v1/supportBot.routes.ts — the RBAC gate lives THERE, not here).
"""

from __future__ import annotations

import os
import time
from typing import Any

import httpx

RECENT_WINDOW_SECONDS = 300


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
        resp = await client.post(f"{base}/v1{path}", headers={"Authorization": f"Bearer {key}"}, json=body)
    try:
        data = resp.json()
    except Exception:  # noqa: BLE001 - body may not be JSON
        data = {"message": resp.text[:200]}
    return resp.status_code, data


async def sender_spoke_recently(database: Any, chat_id: int, user_id: int) -> bool:
    """The claimed asker must have sent a recent message in this chat — the model cannot
    point a tool at someone who never spoke."""
    cutoff = time.time() - RECENT_WINDOW_SECONDS
    rows = await database.get_recent_messages(chat_id=chat_id, limit=50)
    return any(
        getattr(m, "sender_id", None) == user_id and getattr(m, "timestamp", 0) >= cutoff
        for m in rows
    )
