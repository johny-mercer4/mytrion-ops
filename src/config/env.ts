import 'dotenv/config';
import { z } from 'zod';

/** Parse a '0'/'1'/'true'/'false' style flag into a boolean, with a default. */
const flag = (def: '0' | '1') =>
  z
    .string()
    .default(def)
    .transform((v) => v === '1' || v.toLowerCase() === 'true');

const EnvSchema = z.object({
  // --- Server ---
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  // Wildcard-by-suffix origins (comma-separated hostnames). Zoho serves each widget from a
  // per-instance subdomain of zappsusercontent.com, so we allow that whole suffix.
  CORS_ORIGIN_SUFFIXES: z.string().default('zappsusercontent.com'),

  // --- Database: Mytrion OPS external Postgres (sessions, logging, knowledge) ---
  // No local DB — always the external URL. `DATABASE_URL` is kept only as a legacy alias.
  // No localhost default on purpose: a missing value should fail loudly, not silently
  // connect to localhost (see assertRuntimeSecrets).
  MYTRION_OPS_DATABASE_URL: z.string().default(''),
  DATABASE_URL: z.string().default(''),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

  // --- Data Warehouse (separate read Postgres; tool + metadata target) ---
  DWH_DATABASE_URL: z.string().default(''),

  // --- OpenAI ---
  OPENAI_API_KEY: z.string().default(''),
  // Model IDs by role: FOUR_O_MINI = default chat, FIVE_O_MINI = reasoning/hard tasks,
  // EMBEDDING_SMALL = embeddings. Wired in modules/llm/openaiClient.ts (`models`).
  OPEN_AI_FOUR_O_MINI: z.string().default('gpt-4o-mini-2024-07-18'),
  OPEN_AI_FIVE_O_MINI: z.string().default('gpt-5.4-mini-2026-03-17'),
  OPEN_AI_EMBEDDING_SMALL: z.string().default('text-embedding-3-small'),

  // --- Groq (fast/cheap worker via the OpenAI-compatible API). Off unless FF_GROQ_ENABLED. ---
  GROQ_API_KEY: z.string().default(''),
  GROQ_BASE_URL: z.string().default('https://api.groq.com/openai/v1'),
  // Worker model for tool-calling/simple turns. gpt-oss (NOT Llama — deprecated on Groq).
  GROQ_MODEL_WORKER: z.string().default('openai/gpt-oss-120b'),

  // --- DeepAgents (LangChain/LangGraph orchestrator + RAG / web-search / tool-caller subagents). ---
  // Off by default (FF_DEEP_AGENTS_ENABLED). Reuses OPENAI_API_KEY; no new provider.
  // Empty DEEP_AGENTS_MODEL falls back to OPEN_AI_FOUR_O_MINI. The web-search subagent calls the
  // OpenAI Responses `web_search` built-in tool with DEEP_WEB_SEARCH_MODEL (must be a web-search-capable
  // model alias, e.g. gpt-4o-mini / gpt-4o; dated snapshots may not support it).
  DEEP_AGENTS_MODEL: z.string().default(''),
  DEEP_WEB_SEARCH_MODEL: z.string().default('gpt-4o-mini'),

  // --- Composio (external tool-calling gateway for the DeepAgents external-tools subagent). ---
  // Off unless FF_COMPOSIO_ENABLED. Shared-org-account model: one fixed Composio user owns the
  // connected accounts (connect Zoho once → all callers use it). Toolkits are managed-auth slugs
  // (ZOHO = CRM, ZOHO_DESK). Execution is remote on Composio; we wrap each call with an audit log
  // and gate the subagent to admins (external tools include writes/deletes).
  COMPOSIO_API_KEY: z.string().default(''),
  COMPOSIO_ORG_USER_ID: z.string().default('octane-org'),
  COMPOSIO_TOOLKITS: z.string().default('ZOHO,ZOHO_DESK'),
  COMPOSIO_TOOL_LIMIT: z.coerce.number().int().positive().max(200).default(50),

  // --- Zoho MCP (hosted; "Authorize via Connection" → headless, URL embeds the credential). ---
  ZOHO_MCP_URL: z.string().default(''),

  // --- Department RBAC: profile/role substrings that grant UNLIMITED access (all depts + all tools). ---
  ADMIN_PROFILE_MARKERS: z.string().default('administrator,manager,developer'),

  // --- Auth ---
  JWT_SECRET: z.string().default(''),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  PASSWORD_PEPPER: z.string().default(''),

  // --- Encryption (vendor credentials at rest) ---
  ENCRYPTION_KEY: z.string().default(''),

  // --- Zoho: shared OAuth app (one self-client app across CRM/Desk/People/Projects) ---
  ZOHO_ACCOUNTS_DOMAIN: z.string().default('https://accounts.zoho.com'),
  ZOHO_CLIENT_ID: z.string().default(''),
  ZOHO_CLIENT_SECRET: z.string().default(''),
  // Optional shared refresh token; used as a fallback when a service-specific one is unset.
  ZOHO_REFRESH_TOKEN: z.string().default(''),

  // The *_API_DOMAIN / *_BASE_URL values are the FULL versioned API roots; callers append
  // only the resource path (e.g. `${ZOHO_CRM_API_DOMAIN}/settings/modules`).

  // --- Zoho CRM ---
  ZOHO_CRM_CLIENT_ID: z.string().default(''),
  ZOHO_CRM_CLIENT_SECRET: z.string().default(''),
  ZOHO_CRM_REFRESH_TOKEN: z.string().default(''),
  ZOHO_CRM_API_DOMAIN: z.string().default('https://www.zohoapis.com/crm/v8'),

  // --- Zoho Desk ---
  ZOHO_DESK_REFRESH_TOKEN: z.string().default(''),
  ZOHO_DESK_BASE_URL: z.string().default('https://desk.zoho.com/api/v1'),
  ZOHO_DESK_ORG_ID: z.string().default(''),

  // --- Zoho People ---
  ZOHO_PEOPLE_REFRESH_TOKEN: z.string().default(''),
  ZOHO_PEOPLE_BASE_URL: z.string().default('https://people.zoho.com/api'),

  // --- Zoho Projects ---
  ZOHO_PROJECTS_REFRESH_TOKEN: z.string().default(''),
  ZOHO_PROJECTS_BASE_URL: z.string().default('https://projectsapi.zoho.com/api/v3'),

  // --- Vendor: Octane internal API ---
  OCTANE_INTERNAL_API_URL: z.string().default(''),
  OCTANE_INTERNAL_API_KEY: z.string().default(''),

  // --- CMP (our custom Node server; login/password auth, prod + sandbox) ---
  // Which CMP environment the wrapper authenticates against by default.
  CMP_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  CMP_PRODUCTION_URL: z.string().default(''),
  CMP_PRODUCTION_LOGIN: z.string().default(''),
  CMP_PRODUCTION_PASSWORD: z.string().default(''),
  CMP_SANDBOX_URL: z.string().default(''),
  CMP_SANDBOX_LOGIN: z.string().default(''),
  CMP_SANDBOX_PASSWORD: z.string().default(''),

  // --- EFS (CardManagement SOAP/WSDL) ---
  EFS_WSDL_URL: z.string().default(''),
  // CarrierGroupWS WSDL (child-token auth). Derived from EFS_WSDL_URL when blank.
  EFS_GROUP_WSDL_URL: z.string().default(''),
  EFS_LOGIN: z.string().default(''),
  EFS_PASSWORD: z.string().default(''),
  EFS_PARENT: z.string().default('PARENT'),

  // --- Server CRM (outbound integration) ---
  SERVER_CRM_URL: z.string().default(''),
  SERVER_CRM_KEY: z.string().default(''),

  // --- Inbound server API key (callers present this to reach this engine) ---
  API_KEY: z.string().default(''),

  // --- File storage: Cloudflare R2 (S3-compatible) ---
  R2_ACCOUNT_ID: z.string().default(''),
  R2_ACCESS_KEY_ID: z.string().default(''),
  R2_SECRET_ACCESS_KEY: z.string().default(''),
  R2_BUCKET: z.string().default(''),
  // Defaults to https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com when blank.
  R2_ENDPOINT: z.string().default(''),
  // Optional public/custom-domain base for serving uploaded files.
  R2_PUBLIC_BASE_URL: z.string().default(''),
  // R2 ignores region but the S3 SDK requires one; 'auto' is correct for R2.
  R2_REGION: z.string().default('auto'),

  // --- Browser automation: Browserbase ---
  BROWSERBASE_API_KEY: z.string().default(''),
  BROWSERBASE_PROJECT_ID: z.string().default(''),
  BROWSERBASE_BASE_URL: z.string().default('https://api.browserbase.com'),

  // --- Feature flags ---
  FF_PARTNER_AUDIENCE_ENABLED: flag('1'),
  FF_KNOWLEDGE_INGEST_ENABLED: flag('1'),
  // Always-on RAG: inject RBAC-scoped pgvector passages into every chat turn.
  FF_RAG_ENABLED: flag('1'),
  // Route worker/tool-calling turns to Groq (gpt-oss). Off → all turns stay on OpenAI.
  FF_GROQ_ENABLED: flag('0'),
  // Expose Zoho MCP tools to the chat agent (read tools only unless FF_ZOHO_MCP_WRITES). Off by default.
  FF_ZOHO_MCP_ENABLED: flag('0'),
  // Additionally expose Zoho MCP WRITE tools (create/update/upsert). Off by default (read-only posture).
  FF_ZOHO_MCP_WRITES: flag('0'),
  FF_AUDIT_LOG_ENABLED: flag('1'),
  // DeepAgents orchestrator endpoint (POST /v1/agent/deep). Off by default; lazy-loaded when on.
  FF_DEEP_AGENTS_ENABLED: flag('0'),
  // Composio external tool-calling (adds the external-tools subagent + /v1/integrations/composio/*).
  FF_COMPOSIO_ENABLED: flag('0'),
});

export type Env = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  // Only happens for malformed values (bad enum / non-numeric port), never for
  // missing-but-defaulted keys. Surface the issue and fail fast.
  console.error('[env] Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment configuration');
}

export const env: Env = parsed.data;

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
export const isDev = env.NODE_ENV === 'development';

/**
 * Resolved app database URL — the Mytrion OPS external Postgres. `DATABASE_URL` is a
 * legacy alias kept only as a fallback. Empty means unconfigured (caught at startup).
 */
export const databaseUrl: string = env.MYTRION_OPS_DATABASE_URL || env.DATABASE_URL;

export const corsOrigins: string[] = env.CORS_ORIGINS.split(',')
  .map((o) => o.trim())
  .filter(Boolean);

export const corsOriginSuffixes: string[] = env.CORS_ORIGIN_SUFFIXES.split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

/**
 * Verify that runtime secrets are present. Called once at server/worker startup
 * (not at import time, so tests and tooling can import modules freely). In
 * production any missing secret is fatal; in dev/test we warn and continue with
 * insecure fallbacks so the app still boots locally.
 */
export function assertRuntimeSecrets(): void {
  const missing: string[] = [];
  if (!databaseUrl) missing.push('MYTRION_OPS_DATABASE_URL');
  if (!env.JWT_SECRET) missing.push('JWT_SECRET');
  if (!env.ENCRYPTION_KEY) missing.push('ENCRYPTION_KEY');
  if (!env.OPENAI_API_KEY) missing.push('OPENAI_API_KEY');
  if (env.FF_GROQ_ENABLED && !env.GROQ_API_KEY) missing.push('GROQ_API_KEY');
  if (env.FF_ZOHO_MCP_ENABLED && !env.ZOHO_MCP_URL) missing.push('ZOHO_MCP_URL');
  if (env.FF_COMPOSIO_ENABLED && !env.COMPOSIO_API_KEY) missing.push('COMPOSIO_API_KEY');

  if (missing.length === 0) return;

  if (isProduction) {
    throw new Error(`Missing required secrets in production: ${missing.join(', ')}`);
  }
  console.warn(
    `[env] Missing secrets (${missing.join(', ')}). Using insecure dev fallbacks — do not use in production.`,
  );
}
