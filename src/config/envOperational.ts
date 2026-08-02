import { z } from 'zod';

/** Parse a '0'/'1'/'true'/'false' style flag into a boolean, with a default. */
const flag = (def: '0' | '1') =>
  z
    .string()
    .default(def)
    .transform((value) => value === '1' || value.toLowerCase() === 'true');

/** Operational feature flags, retention routing, and background-worker configuration. */
export const operationalEnvShape = {
  // Long-term agent and tenant-scoped support-bot memory limits.
  AGENT_MEMORY_HALFLIFE_DAYS: z.coerce.number().int().positive().default(30),
  AGENT_MEMORY_MAX_PER_KEY: z.coerce.number().int().positive().default(500),
  SUPPORT_BOT_MEMORY_TTL_DAYS: z.coerce.number().int().positive().max(365).default(30),
  SUPPORT_BOT_MEMORY_MAX_PER_USER: z.coerce.number().int().positive().max(2000).default(200),
  SUPPORT_BOT_MEMORY_TOP_K: z.coerce.number().int().positive().max(8).default(3),
  SUPPORT_BOT_MEMORY_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.35),
  SUPPORT_BOT_MESSAGE_RETENTION_DAYS: z.coerce.number().int().positive().max(365).default(30),
  SUPPORT_BOT_CONFIRMATION_TTL_SECONDS: z.coerce.number().int().min(60).max(1800).default(600),
  SUPPORT_BOT_CONFIRMATION_RETENTION_DAYS: z.coerce.number().int().positive().max(90).default(7),
  SUPPORT_BOT_ACCESS_SNAPSHOT_MAX: z.coerce.number().int().positive().max(500_000).default(100_000),
  SUPPORT_BOT_MAX_GROUPS: z.coerce.number().int().positive().max(800).default(800),
  SUPPORT_BOT_GATEWAY_RATE_PER_MIN: z.coerce.number().int().min(120).max(10_000).default(2_000),

  // Multi-agent orchestrator endpoint (POST /v1/agent). FF_DEEP_AGENTS_ENABLED is kept as a
  // deprecated alias — either flag enables the endpoint.
  FF_ORCHESTRATOR_ENABLED: flag('1'),
  // Durable LangGraph threads (PostgresSaver in the 'langgraph' schema).
  FF_AGENT_CHECKPOINTS: flag('1'),
  // Reuse the compiled LangGraph agent across turns, keyed by (agent + full caller identity/scope).
  // Safe because the key includes every identity/authority/view field.
  FF_AGENT_GRAPH_CACHE: flag('1'),
  // File generation/analysis tools + /v1/files routes (MinIO/S3 storage).
  FF_FILES_ENABLED: flag('0'),
  // Browser automation via Composio (admin-gated, domain-allowlisted, fail closed).
  FF_BROWSER_ENABLED: flag('0'),
  // Human-in-the-loop approvals for model-proposed write/destructive tools.
  FF_WRITE_APPROVALS: flag('0'),
  // Long-term agent memory: end-of-run distillation + untrusted scoped recall.
  FF_AGENT_MEMORY: flag('0'),
  // Per-user Telegram semantic history. Requires support_bot_memories (migration 0078).
  FF_SUPPORT_BOT_MEMORY: flag('0'),
  // Interactive browser writes (navigate/click/fill). Off keeps scrape/read tools only.
  FF_BROWSER_WRITES: flag('0'),

  // Retention Open Pool notify + Ops Manager vacation signoff — Zoho user ids.
  RETENTION_OPEN_POOL_NOTIFY_ZOHO_USER_ID: z.string().default(''),
  RETENTION_OPS_MANAGER_ZOHO_USER_ID: z.string().default(''),
  // Reserved Zapier/ops identity; app-side Zoho send_mail remains disabled.
  RETENTION_NOTIFY_FROM_EMAIL: z.string().default(''),
  // Phase 2 Retention CS assignee — first Zoho user id wins.
  RETENTION_CS_ROUND_ROBIN_ZOHO_USER_IDS: z.string().default(''),
  RETENTION_CS_SPANISH_ZOHO_USER_ID: z.string().default(''),
  // Optional Sales-agent pilot allowlist for automatic Retention cases.
  FF_RETENTION_PILOT_ONLY: flag('0'),
  RETENTION_PILOT_AGENT_ZOHO_USER_IDS: z.string().default(''),

  // Background jobs (pg-boss on the app Postgres, own self-migrating schema).
  FF_JOBS_ENABLED: flag('0'),
  JOBS_WORKER_MODE: z.enum(['inline', 'send-only', 'off']).default('inline'),
  PGBOSS_SCHEMA: z
    .string()
    .regex(/^[a-z_][a-z0-9_]*$/, 'must be a plain lowercase identifier')
    .default('pgboss'),
  JOBS_CONCURRENCY: z.coerce.number().int().positive().max(10).default(2),
  JOBS_CRON_TZ: z.string().default('America/Chicago'),
  /**
   * pg-boss runs several internal loops plus one poller per worker. Keep its dedicated pool above
   * those concurrent loops while accounting for the database's per-process connection budget.
   */
  PGBOSS_POOL_MAX: z.coerce.number().int().positive().max(20).default(8),
  /** Managed Postgres may need more than pg-boss's default 10s connection-acquire timeout. */
  PGBOSS_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
};
