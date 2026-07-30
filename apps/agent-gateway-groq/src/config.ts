import 'dotenv/config';

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`env ${name} is required`);
  return v;
}

function openAIReasoningEffort(): 'none' | 'low' | 'medium' | 'high' {
  const value = process.env['OPENAI_REASONING_EFFORT'];
  if (value === 'none' || value === 'medium' || value === 'high') return value;
  return 'low';
}

export const config = {
  botToken: req('TELEGRAM_BOT_TOKEN'),
  openaiApiKey: req('OPENAI_API_KEY'),
  openaiModel: process.env['OPENAI_MODEL'] ?? 'gpt-5.6-luna',
  openaiMaxOutputTokens: Number(process.env['OPENAI_MAX_OUTPUT_TOKENS'] ?? '1024'),
  openaiRequestTimeoutMs: Number(process.env['OPENAI_TIMEOUT_MS'] ?? '90000'),
  openaiReasoningEffort: openAIReasoningEffort(),
  octaneBase: req('OCTANE_API_BASE').replace(/\/+$/, ''),
  octaneKey: req('OCTANE_INTERNAL_API_KEY'),
  /** MVP single-group mode; multi-chat resolves via mytrion /support-bot/chat-map. */
  botUsername: process.env.TELEGRAM_BOT_USERNAME ?? '',
  groupChatId: process.env.OCTANE_GROUP_CHAT_ID ?? '',
  carrierId: process.env.OCTANE_CARRIER_ID ?? '',
  /** Public mini-app link appended to the unregistered-user nudge (optional). */
  miniAppLink: process.env.OCTANE_MINIAPP_LINK ?? '',
};
