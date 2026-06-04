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

  // --- Database (app's own Postgres: sessions, logging, knowledge) ---
  DATABASE_URL: z
    .string()
    .default('postgres://octane:octane@localhost:5432/octane_assistant'),
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

  // --- Feature flags ---
  FF_PARTNER_AUDIENCE_ENABLED: flag('1'),
  FF_KNOWLEDGE_INGEST_ENABLED: flag('1'),
  FF_AUDIT_LOG_ENABLED: flag('1'),
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

export const corsOrigins: string[] = env.CORS_ORIGINS.split(',')
  .map((o) => o.trim())
  .filter(Boolean);

/**
 * Verify that runtime secrets are present. Called once at server/worker startup
 * (not at import time, so tests and tooling can import modules freely). In
 * production any missing secret is fatal; in dev/test we warn and continue with
 * insecure fallbacks so the app still boots locally.
 */
export function assertRuntimeSecrets(): void {
  const missing: string[] = [];
  if (!env.JWT_SECRET) missing.push('JWT_SECRET');
  if (!env.ENCRYPTION_KEY) missing.push('ENCRYPTION_KEY');
  if (!env.OPENAI_API_KEY) missing.push('OPENAI_API_KEY');

  if (missing.length === 0) return;

  if (isProduction) {
    throw new Error(`Missing required secrets in production: ${missing.join(', ')}`);
  }
  console.warn(
    `[env] Missing secrets (${missing.join(', ')}). Using insecure dev fallbacks — do not use in production.`,
  );
}
