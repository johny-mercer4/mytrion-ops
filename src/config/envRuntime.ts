import { databaseUrl, env, isProduction } from './env.js';

/** Verify required runtime secrets once during server/worker startup. */
export function assertRuntimeSecrets(): void {
  const missing: string[] = [];
  const invalid: string[] = [];
  if (!databaseUrl) missing.push('MYTRION_OPS_DATABASE_URL');
  if (!env.JWT_SECRET) missing.push('JWT_SECRET');
  if (!env.ENCRYPTION_KEY) missing.push('ENCRYPTION_KEY');
  if (!env.OPENAI_API_KEY) missing.push('OPENAI_API_KEY');
  if (!env.SUPPORT_BOT_GATEWAY_API_KEY) missing.push('SUPPORT_BOT_GATEWAY_API_KEY');
  if (isProduction && !env.SUPPORT_BOT_GATEWAY_MONITOR_URL) {
    missing.push('SUPPORT_BOT_GATEWAY_MONITOR_URL');
  }
  if (isProduction && !env.SUPPORT_BOT_GATEWAY_MONITOR_TOKEN) {
    missing.push('SUPPORT_BOT_GATEWAY_MONITOR_TOKEN');
  }
  if (isProduction && env.SUPPORT_BOT_GATEWAY_API_KEY) {
    if (env.SUPPORT_BOT_GATEWAY_API_KEY.length < 32) {
      invalid.push('SUPPORT_BOT_GATEWAY_API_KEY must contain at least 32 characters');
    }
    if (env.API_KEY && env.SUPPORT_BOT_GATEWAY_API_KEY === env.API_KEY) {
      invalid.push('SUPPORT_BOT_GATEWAY_API_KEY must not reuse API_KEY');
    }
  }
  if (
    isProduction &&
    env.SUPPORT_BOT_GATEWAY_MONITOR_TOKEN &&
    env.SUPPORT_BOT_GATEWAY_MONITOR_TOKEN.length < 32
  ) {
    invalid.push('SUPPORT_BOT_GATEWAY_MONITOR_TOKEN must contain at least 32 characters');
  }
  if (isProduction && !env.FF_SUPPORT_BOT_IDEMPOTENCY) {
    missing.push('FF_SUPPORT_BOT_IDEMPOTENCY=1');
  }
  if (env.FF_GROQ_ENABLED && !env.GROQ_API_KEY) missing.push('GROQ_API_KEY');
  if (env.FF_ZOHO_MCP_ENABLED && !env.ZOHO_MCP_URL) missing.push('ZOHO_MCP_URL');
  // dbt discovery is optional outside production; production requires its full credential set.
  if (env.FF_DBT_MCP_ENABLED && isProduction) {
    if (!env.DBT_MCP_URL) missing.push('DBT_MCP_URL');
    if (!env.DBT_MCP_CLIENT_ID) missing.push('DBT_MCP_CLIENT_ID');
    if (!env.DBT_MCP_CLIENT_SECRET) missing.push('DBT_MCP_CLIENT_SECRET');
  }
  if (env.FF_COMPOSIO_ENABLED && !env.COMPOSIO_API_KEY) missing.push('COMPOSIO_API_KEY');
  if (env.FF_TELEGRAM_ENABLED && !env.TELEGRAM_BOT_TOKEN) missing.push('TELEGRAM_BOT_TOKEN');
  if (env.FF_ZOHO_OAUTH_ENABLED) {
    if (!env.ZOHO_SERVER_CLIENT_ID) missing.push('ZOHO_SERVER_CLIENT_ID');
    if (!env.ZOHO_SERVER_CLIENT_SECRET) missing.push('ZOHO_SERVER_CLIENT_SECRET');
    if (!env.JWT_SECRET) missing.push('JWT_SECRET');
  }
  if (env.FF_FILES_ENABLED) {
    if (!env.S3_ENDPOINT) missing.push('S3_ENDPOINT');
    if (!env.S3_ACCESS_KEY_ID) missing.push('S3_ACCESS_KEY_ID');
    if (!env.S3_SECRET_ACCESS_KEY) missing.push('S3_SECRET_ACCESS_KEY');
    if (!env.S3_BUCKET) missing.push('S3_BUCKET');
  }

  if (missing.length === 0 && invalid.length === 0) return;
  if (isProduction) {
    const parts = [
      ...(missing.length ? [`Missing required secrets: ${missing.join(', ')}`] : []),
      ...invalid,
    ];
    throw new Error(`Invalid production configuration: ${parts.join('; ')}`);
  }
  console.warn(
    `[env] Secret checks (${[...missing, ...invalid].join(', ')}). Using insecure dev fallbacks — do not use in production.`,
  );
}
