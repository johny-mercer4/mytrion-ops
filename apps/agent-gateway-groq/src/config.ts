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

function optionalBoundedNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`env ${name} must be between ${min} and ${max}`);
  }
  return value;
}

function optionalBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (raw === '1' || raw.toLowerCase() === 'true') return true;
  if (raw === '0' || raw.toLowerCase() === 'false') return false;
  throw new Error(`env ${name} must be true/false or 1/0`);
}

function messageLogMode(): 'engaged' | 'all' | 'off' {
  const value = process.env['MESSAGE_LOG_MODE'] ?? 'engaged';
  if (value === 'engaged' || value === 'all' || value === 'off') return value;
  throw new Error('env MESSAGE_LOG_MODE must be engaged, all, or off');
}

function telegramEngagementMode(): 'direct' | 'all_registered' {
  const value =
    process.env['TELEGRAM_ENGAGEMENT_MODE'] ??
    (nodeEnv === 'production' ? 'direct' : 'all_registered');
  if (value === 'direct' || value === 'all_registered') return value;
  throw new Error('env TELEGRAM_ENGAGEMENT_MODE must be direct or all_registered');
}

const nodeEnv = process.env['NODE_ENV'] ?? 'development';
const supportBotKey =
  process.env['OCTANE_SUPPORT_BOT_API_KEY'] ??
  (nodeEnv === 'production' ? '' : process.env['OCTANE_INTERNAL_API_KEY'] ?? '');
if (!supportBotKey) {
  throw new Error(
    'env OCTANE_SUPPORT_BOT_API_KEY is required (OCTANE_INTERNAL_API_KEY is a development-only fallback)',
  );
}
if (nodeEnv === 'production' && supportBotKey.length < 32) {
  throw new Error('env OCTANE_SUPPORT_BOT_API_KEY must contain at least 32 characters in production');
}
const monitorToken = process.env['MONITOR_TOKEN'] ?? '';
if (nodeEnv === 'production' && monitorToken.length < 32) {
  throw new Error('env MONITOR_TOKEN must contain at least 32 characters in production');
}
const botUsername = (process.env['TELEGRAM_BOT_USERNAME'] ?? '').replace(/^@/, '');
const engagementMode = telegramEngagementMode();
if (nodeEnv === 'production' && engagementMode === 'direct' && !botUsername) {
  throw new Error('env TELEGRAM_BOT_USERNAME is required for production direct engagement');
}
const gatewayLeaseTtlSeconds = optionalBoundedNumber('GATEWAY_LEASE_TTL_SECONDS', 45, 15, 120);
const gatewayLeaseRenewMs = optionalBoundedNumber('GATEWAY_LEASE_RENEW_MS', 10_000, 1_000, 60_000);
if (gatewayLeaseRenewMs >= gatewayLeaseTtlSeconds * 500) {
  throw new Error('env GATEWAY_LEASE_RENEW_MS must be less than half GATEWAY_LEASE_TTL_SECONDS');
}

export const config = {
  botToken: req('TELEGRAM_BOT_TOKEN'),
  openaiApiKey: req('OPENAI_API_KEY'),
  openaiModel: process.env['OPENAI_MODEL'] ?? 'gpt-5.6-luna',
  /** Small structured-output model call that decides engagement and tool scope. */
  openaiRouterModel:
    process.env['OPENAI_ROUTER_MODEL'] ?? process.env['OPENAI_MODEL'] ?? 'gpt-5.6-luna',
  openaiRouterMaxOutputTokens: optionalBoundedNumber(
    'OPENAI_ROUTER_MAX_OUTPUT_TOKENS',
    320,
    128,
    2_048,
  ),
  openaiRouterMaxConcurrent: optionalBoundedNumber('OPENAI_ROUTER_MAX_CONCURRENT', 16, 1, 128),
  openaiRouterQueueMax: optionalBoundedNumber('OPENAI_ROUTER_QUEUE_MAX', 200, 1, 10_000),
  openaiMaxOutputTokens: optionalBoundedNumber('OPENAI_MAX_OUTPUT_TOKENS', 1_024, 128, 16_384),
  openaiRequestTimeoutMs: optionalBoundedNumber('OPENAI_TIMEOUT_MS', 90_000, 1_000, 300_000),
  openaiRpmLimit: optionalBoundedNumber('OPENAI_RPM_LIMIT', 60, 1, 1_000_000),
  openaiTpmLimit: optionalBoundedNumber('OPENAI_TPM_LIMIT', 100_000, 1_000, 1_000_000_000),
  openaiRateWaitMaxMs: optionalBoundedNumber('OPENAI_RATE_WAIT_MAX_MS', 30_000, 1, 300_000),
  openai429RetryMax: optionalBoundedNumber('OPENAI_429_RETRY_MAX', 1, 0, 5),
  openaiCircuit429Threshold: optionalBoundedNumber('OPENAI_CIRCUIT_429_THRESHOLD', 3, 1, 100),
  openaiCircuitCooldownMs: optionalBoundedNumber(
    'OPENAI_CIRCUIT_COOLDOWN_MS',
    30_000,
    1_000,
    600_000,
  ),
  openaiReasoningEffort: openAIReasoningEffort(),
  octaneBase: req('OCTANE_API_BASE').replace(/\/+$/, ''),
  nodeEnv,
  tenantId: process.env['OCTANE_TENANT_ID'] ?? 'octane',
  environment: nodeEnv,
  octaneSupportBotKey: supportBotKey,
  messageLogMode: messageLogMode(),
  messageLogLocalEnabled: optionalBoolean('MESSAGE_LOG_LOCAL_ENABLED', nodeEnv !== 'production'),
  messageLogStoreNames: optionalBoolean('MESSAGE_LOG_STORE_NAMES', false),
  messageLogMaxChars: optionalBoundedNumber('MESSAGE_LOG_MAX_CHARS', 2_000, 100, 8_000),
  messageLogRetentionDays: optionalBoundedNumber('MESSAGE_LOG_RETENTION_DAYS', 30, 1, 365),
  turnLogLocalEnabled: optionalBoolean('TURN_LOG_LOCAL_ENABLED', nodeEnv !== 'production'),
  monitorToken,
  monitorHost: process.env['MONITOR_HOST'] ?? '0.0.0.0',
  accessSnapshotRefreshMs: optionalBoundedNumber(
    'ACCESS_SNAPSHOT_REFRESH_MS',
    120_000,
    10_000,
    30 * 60_000,
  ),
  accessSnapshotStaleGraceMs: optionalBoundedNumber(
    'ACCESS_SNAPSHOT_STALE_GRACE_MS',
    30 * 60_000,
    60_000,
    24 * 60 * 60_000,
  ),
  accessSnapshotMaxUsers: optionalBoundedNumber(
    'ACCESS_SNAPSHOT_MAX_USERS',
    100_000,
    100,
    500_000,
  ),
  /** MVP single-group mode; multi-chat resolves via mytrion /support-bot/chat-map. */
  botUsername,
  botIdentity: botUsername || 'octane-support-bot',
  telegramEngagementMode: engagementMode,
  gatewayLeaseEnabled: optionalBoolean('GATEWAY_LEASE_ENABLED', nodeEnv === 'production'),
  gatewayLeaseTtlSeconds,
  gatewayLeaseRenewMs,
  groupChatId: process.env.OCTANE_GROUP_CHAT_ID ?? '',
  carrierId: process.env.OCTANE_CARRIER_ID ?? '',
  allowLegacyChatFallback: optionalBoolean(
    'ALLOW_LEGACY_CHAT_FALLBACK',
    nodeEnv !== 'production',
  ),
  maxManagedGroups: optionalBoundedNumber('MAX_MANAGED_GROUPS', 800, 1, 800),
  chatMapStaleGraceMs: optionalBoundedNumber(
    'CHAT_MAP_STALE_GRACE_MS',
    30 * 60_000,
    60_000,
    24 * 60 * 60_000,
  ),
  /** Public mini-app link appended to the unregistered-user nudge (optional). */
  miniAppLink: process.env.OCTANE_MINIAPP_LINK ?? '',
  /** Collect consecutive Telegram fragments after this much typing silence. */
  telegramBurstQuietMs: optionalBoundedNumber('TELEGRAM_BURST_QUIET_MS', 3_000, 0, 60_000),
  /** A continuously typing user cannot postpone their turn beyond this bound. */
  telegramBurstMaxMs: optionalBoundedNumber('TELEGRAM_BURST_MAX_MS', 120_000, 1_000, 120_000),
  telegramBurstMaxKeys: optionalBoundedNumber('TELEGRAM_BURST_MAX_KEYS', 5_000, 100, 50_000),
  telegramBurstMaxItemsPerKey: optionalBoundedNumber(
    'TELEGRAM_BURST_MAX_ITEMS_PER_KEY',
    12,
    2,
    100,
  ),
};
