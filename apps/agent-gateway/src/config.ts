import 'dotenv/config';

// The container runs as ROOT (Render/Docker default). The Claude Code CLI that the Agent SDK
// spawns for permissionMode 'bypassPermissions' refuses --dangerously-skip-permissions under
// root ("exited with code 1 ... root/sudo privileges") UNLESS IS_SANDBOX is set. We force it in
// CODE — not just start-prod.sh / the env group — so it can never be lost to env-propagation
// quirks between PID1, the shell, pnpm and the spawned CLI. Safe here: the gateway's allowedTools
// are our MCP tools only (Bash/Read/Write/Edit disallowed), so skip-permissions grants the model
// no filesystem or shell reach. Set BEFORE any SDK import runs a query.
if (!process.env['IS_SANDBOX']) process.env['IS_SANDBOX'] = '1';

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`env ${name} is required`);
  return v;
}

export const config = {
  botToken: req('TELEGRAM_BOT_TOKEN'),
  model: process.env.GATEWAY_MODEL ?? 'claude-sonnet-4-5',
  octaneBase: req('OCTANE_API_BASE').replace(/\/+$/, ''),
  octaneKey: req('OCTANE_INTERNAL_API_KEY'),
  /** MVP single-group mode; multi-chat resolves via mytrion /support-bot/chat-map. */
  botUsername: process.env.TELEGRAM_BOT_USERNAME ?? '',
  groupChatId: process.env.OCTANE_GROUP_CHAT_ID ?? '',
  carrierId: process.env.OCTANE_CARRIER_ID ?? '',
  /** Public mini-app link appended to the unregistered-user nudge (optional). */
  miniAppLink: process.env.OCTANE_MINIAPP_LINK ?? '',
};
