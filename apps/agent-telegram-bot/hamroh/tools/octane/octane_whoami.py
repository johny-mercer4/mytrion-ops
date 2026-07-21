"""Who is this group member to Octane — role-aware greeting/menus. RBAC in mytrion."""

from __future__ import annotations

from pydantic import BaseModel, Field

from ..base import BaseTool, ToolResult
from ._client import err, ok, post_backend, sender_spoke_recently


class OctaneWhoamiArgs(BaseModel):
    chat_id: int = Field(description="Group chat id")
    telegram_user_id: int = Field(description="Telegram id of the message sender")


class OctaneWhoamiTool(BaseTool[OctaneWhoamiArgs]):
    name = "octane_whoami"
    description = (
        "Look up whether the message sender is a registered Octane mini-app user of this group's "
        "company, and their role (owner/driver). Use before offering account services."
    )
    args_model = OctaneWhoamiArgs

    async def run(self, args: OctaneWhoamiArgs) -> ToolResult:
        if not await sender_spoke_recently(self.ctx.database, args.chat_id, args.telegram_user_id):
            return err("refused: that user has not sent a recent message in this chat")
        status, data = await post_backend("/support-bot/whoami", {"telegramUserId": str(args.telegram_user_id)})
        if status != 200:
            return err(f"not registered or refused ({status}): {data.get('message', '')}")
        return ok(f"role={data.get('role')} name={data.get('name')} company={data.get('companyName')}")
