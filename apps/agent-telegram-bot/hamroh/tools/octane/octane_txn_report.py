"""Transaction report — built by mytrion and delivered to the asker's PRIVATE Octane bot chat
(never into the group: fleet figures are not for every group member's eyes)."""

from __future__ import annotations

from pydantic import BaseModel, Field

from ..base import BaseTool, ToolResult
from ._client import post_backend, sender_spoke_recently


class OctaneTxnReportArgs(BaseModel):
    chat_id: int = Field(description="Group chat id")
    telegram_user_id: int = Field(description="Telegram id of the message sender")
    range: str = Field(default="week", description="Period: day|week|month|quarter")
    format: str = Field(default="xlsx", description="File format: xlsx|pdf|csv")


class OctaneTxnReportTool(BaseTool[OctaneTxnReportArgs]):
    name = "octane_txn_report"
    description = (
        "Send the asking user their transaction report as a file — INTO THEIR PRIVATE Octane bot "
        "chat, not this group. Driver: own card, retail prices. Owner: whole fleet. After calling, "
        "tell them in the group that the file was sent to their private chat."
    )
    args_model = OctaneTxnReportArgs

    async def run(self, args: OctaneTxnReportArgs) -> ToolResult:
        if not await sender_spoke_recently(self.ctx.database, args.chat_id, args.telegram_user_id):
            return ToolResult.error("refused: that user has not sent a recent message in this chat")
        status, data = await post_backend(
            "/support-bot/txn-report",
            {"telegramUserId": str(args.telegram_user_id), "range": args.range, "format": args.format},
        )
        if status != 200:
            return ToolResult.error(f"backend refused ({status}): {data.get('message', '')}")
        return ToolResult.ok(f"Report ({data.get('rows', '?')} rows) sent to the user's private Octane bot chat.")
