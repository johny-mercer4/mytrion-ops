import 'dotenv/config';

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
