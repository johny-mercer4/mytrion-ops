"""Card status — driver: own card only; owner: fleet statuses. RBAC in mytrion."""

from __future__ import annotations

import json

from pydantic import BaseModel, Field

from ..base import BaseTool, ToolResult
from ._client import err, ok, post_backend, sender_spoke_recently


class OctaneCardStatusArgs(BaseModel):
    chat_id: int = Field(description="Group chat id")
    telegram_user_id: int = Field(description="Telegram id of the message sender")


class OctaneCardStatusTool(BaseTool[OctaneCardStatusArgs]):
    name = "octane_card_status"
    description = (
        "Card status for the asking user: a driver gets THEIR card's status/last-used, an owner "
        "gets fleet-wide statuses. Never call for a user other than the message sender."
    )
    args_model = OctaneCardStatusArgs

    async def run(self, args: OctaneCardStatusArgs) -> ToolResult:
        if not await sender_spoke_recently(self.ctx.database, args.chat_id, args.telegram_user_id):
            return err("refused: that user has not sent a recent message in this chat")
        status, data = await post_backend("/support-bot/card-status", {"telegramUserId": str(args.telegram_user_id)})
        if status != 200:
            return err(f"backend refused ({status}): {data.get('message', '')}")
        return ok(json.dumps(data, ensure_ascii=False))
