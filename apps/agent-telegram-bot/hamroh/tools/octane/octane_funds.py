"""Funds — owner: figures; driver: boolean only (company money is the owner's business)."""

from __future__ import annotations

import json

from pydantic import BaseModel, Field

from ..base import BaseTool, ToolResult
from ._client import post_backend, sender_spoke_recently


class OctaneFundsArgs(BaseModel):
    chat_id: int = Field(description="Group chat id")
    telegram_user_id: int = Field(description="Telegram id of the message sender")


class OctaneFundsTool(BaseTool[OctaneFundsArgs]):
    name = "octane_funds"
    description = (
        "Does the asking user's account have funds? Driver gets yes/no + their card status (no "
        "amounts — never invent figures for drivers). Owner gets live balance figures."
    )
    args_model = OctaneFundsArgs

    async def run(self, args: OctaneFundsArgs) -> ToolResult:
        if not await sender_spoke_recently(self.ctx.database, args.chat_id, args.telegram_user_id):
            return ToolResult.error("refused: that user has not sent a recent message in this chat")
        status, data = await post_backend("/support-bot/funds", {"telegramUserId": str(args.telegram_user_id)})
        if status != 200:
            return ToolResult.error(f"backend refused ({status}): {data.get('message', '')}")
        return ToolResult.ok(json.dumps(data, ensure_ascii=False))
