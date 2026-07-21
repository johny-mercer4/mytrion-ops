#!/usr/bin/env python3
"""Sync hamroh's access.json from Octane's mini-app registrations.

One identity source: whoever is an ACTIVE mini-app registration of this instance's carrier
may use the bot (DMs via allowed_users); the carrier's Telegram group rides in allowed_chats
from OCTANE_GROUP_CHAT_ID. Revoked in the mini-app -> dropped here on the next sync.

Run at container start and on a timer (e.g. every 10 min):
    OCTANE_API_BASE=... OCTANE_INTERNAL_API_KEY=... OCTANE_CARRIER_ID=... \
    OCTANE_GROUP_CHAT_ID=-100123456 python scripts/sync_octane_access.py
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request

ACCESS_PATH = os.environ.get("HAMROH_ACCESS_PATH", "access.json")


def main() -> int:
    base = os.environ["OCTANE_API_BASE"].rstrip("/")
    key = os.environ["OCTANE_INTERNAL_API_KEY"]
    carrier = os.environ["OCTANE_CARRIER_ID"]
    group_chat = os.environ.get("OCTANE_GROUP_CHAT_ID", "")

    req = urllib.request.Request(
        f"{base}/v1/support-bot/access?carrierId={carrier}",
        headers={"Authorization": f"Bearer {key}"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310 - internal API over env-config URL
        payload = json.load(resp)

    users = sorted({int(u["telegramUserId"]) for u in payload.get("users", []) if str(u.get("telegramUserId", "")).lstrip("-").isdigit()})
    access = {
        "policy": "allowlist",
        "allowed_users": users,
        "allowed_chats": [int(group_chat)] if group_chat.lstrip("-").isdigit() else [],
    }

    previous = None
    if os.path.exists(ACCESS_PATH):
        with open(ACCESS_PATH, encoding="utf-8") as f:
            previous = json.load(f)
    if previous == access:
        print(f"access.json unchanged ({len(users)} users)")
        return 0
    with open(ACCESS_PATH, "w", encoding="utf-8") as f:
        json.dump(access, f, indent=2)
    print(f"access.json updated: {len(users)} registered users, group={access['allowed_chats']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
