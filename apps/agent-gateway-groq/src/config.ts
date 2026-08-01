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

function optionalBoundedNumber(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`env ${name} must be between ${min} and ${max}`);
  }
  return value;
}

export const config = {
  botToken: req('TELEGRAM_BOT_TOKEN'),
  openaiApiKey: req('OPENAI_API_KEY'),
  openaiModel: process.env['OPENAI_MODEL'] ?? 'gpt-5.6-luna',
  /** Small structured-output model call that decides engagement and tool scope. */
  openaiRouterModel:
    process.env['OPENAI_ROUTER_MODEL'] ??
    process.env['OPENAI_MODEL'] ??
    'gpt-5.6-luna',
  openaiRouterMaxOutputTokens: optionalBoundedNumber(
    'OPENAI_ROUTER_MAX_OUTPUT_TOKENS',
    320,
    128,
    2_048,
  ),
  openaiRouterMaxConcurrent: optionalBoundedNumber(
    'OPENAI_ROUTER_MAX_CONCURRENT',
    16,
    1,
    128,
  ),
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
  /** Collect consecutive Telegram fragments after this much typing silence. */
  telegramBurstQuietMs: optionalBoundedNumber(
    'TELEGRAM_BURST_QUIET_MS',
    3_000,
    0,
    60_000,
  ),
  /** A continuously typing user cannot postpone their turn beyond this bound. */
  telegramBurstMaxMs: optionalBoundedNumber(
    'TELEGRAM_BURST_MAX_MS',
    120_000,
    1_000,
    120_000,
  ),
};
