"""Card override for the REGISTERED DRIVER who asked. RBAC lives in mytrion — see _client."""

from __future__ import annotations

from pydantic import BaseModel, Field

from ..base import BaseTool, ToolResult
from ._client import err, ok, post_backend, sender_spoke_recently


class OctaneOverrideArgs(BaseModel):
    chat_id: int = Field(description="Group chat id the request came from")
    telegram_user_id: int = Field(description="Telegram id of the DRIVER who asked (the message sender, never someone else)")


class OctaneOverrideTool(BaseTool[OctaneOverrideArgs]):
    name = "octane_override"
    description = (
        "Unlock (override) the asking driver's own fuel card for ~30 minutes. ONLY call after the "
        "driver explicitly confirmed in chat. Registered drivers of this group's company only; "
        "owners are refused (they pick a card in the mini-app)."
    )
    args_model = OctaneOverrideArgs

    async def run(self, args: OctaneOverrideArgs) -> ToolResult:
        if not await sender_spoke_recently(self.ctx.database, args.chat_id, args.telegram_user_id):
            return err("refused: that user has not sent a recent message in this chat")
        status, data = await post_backend("/support-bot/override", {"telegramUserId": str(args.telegram_user_id)})
        if status != 200:
            return err(f"backend refused ({status}): {data.get('message', '')}")
        return ok(f"Override active on card •••• {data.get('last6', '?')} for ~{data.get('minutes', 30)} minutes.")
