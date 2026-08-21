import { defineConfig } from 'vitest/config';

/**
 * Where unit tests point Postgres.
 *
 * The app itself is local=prod (MYTRION_OPS_DATABASE_URL is the Render DSN on developer
 * machines). The suite is not the app. If we inherit that DSN, every `pnpm test` writes
 * audit_log / session rows into production and the first query in each file is a
 * cross-country round trip (measured 4.4s–7.2s vs a 5s default timeout).
 *
 * Resolution, in order:
 *   1. VITEST_DATABASE_URL — explicit escape hatch, never used by the app.
 *   2. CI's MYTRION_OPS_DATABASE_URL — GitHub Actions sets CI=true and points this at the
 *      job's throwaway pgvector service, not Render.
 *   3. Local docker-compose Postgres on :5433.
 *
 * Same reasoning as the FF_ZOHO_MCP_ENABLED pin below: a unit run must not depend on a
 * network service answering quickly, and must not mutate the shared prod database.
 */
function resolveTestDatabaseUrl(): string {
  if (process.env.VITEST_DATABASE_URL) return process.env.VITEST_DATABASE_URL;
  if (process.env.CI === 'true' && process.env.MYTRION_OPS_DATABASE_URL) {
    return process.env.MYTRION_OPS_DATABASE_URL;
  }
  return 'postgresql://octane:octane@localhost:5433/octane_assistant';
}

const TEST_DATABASE_URL = resolveTestDatabaseUrl();

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Default reporter lists every case (~3k lines). CI uses dots + annotations so failures
    // stay visible and the log is readable. Console from passed tests is suppressed in CI only.
    reporter: process.env.GITHUB_ACTIONS ? ['dot', 'github-actions'] : 'default',
    silent: Boolean(process.env.GITHUB_ACTIONS),
    // Applied to process.env BEFORE the app's `dotenv/config` runs (dotenv never overrides an
    // existing value), so a developer's local .env (which now carries feature flags for `pnpm dev`)
    // can't make the suite non-deterministic. Tests that need a flag ON toggle it at runtime and
    // restore to this baseline.
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      MYTRION_OPS_DATABASE_URL: TEST_DATABASE_URL,
      DATABASE_URL: TEST_DATABASE_URL,
      FF_FILES_ENABLED: '0',
      FF_ORCHESTRATOR_ENABLED: '0',
      FF_DEEP_AGENTS_ENABLED: '0',
      FF_JOBS_ENABLED: '0',
      FF_AGENTIC_RAG: '0',
      // Its twin was in this baseline; this one was missed, so every suite that calls buildApp()
      // inherited FF_ZOHO_MCP_ENABLED=1 from the developer's .env and did LIVE MCP discovery at
      // boot — raced against a 20s deadline inside a 10s vitest hook. Measured: buildApp() took
      // 17.7s, so 8 files timed out. Green only while the MCP endpoint happened to answer fast.
      FF_ZOHO_MCP_ENABLED: '0',
      // Match production default (OAuth on). Suites that need the flag off toggle it explicitly.
      FF_ZOHO_OAUTH_ENABLED: '1',
      FF_DBT_MCP_ENABLED: '0',
      FF_DBT_MCP_WRITES: '0',
      FF_RAG_HYBRID: '0',
      FF_RAG_RERANK: '0',
      FF_WRITE_APPROVALS: '0',
      FF_AGENT_MEMORY: '0',
      FF_AGENT_CHECKPOINTS: '0',
      // Blackboard + Telegram match production defaults (ON) — goldens / RBAC / approvals bind them.
      // Skill cache + plan DAG stay off; agent-sota suites toggle those at runtime.
      FF_AGENT_BLACKBOARD: '1',
      FF_AGENT_SKILL_CACHE: '0',
      FF_AGENT_PLAN_DAG: '0',
      FF_AGENT_HARD_DAG: '0',
      FF_TELEGRAM_ENABLED: '1',
      // Off in tests so flag-toggling suites (e.g. Composio on/off) always compile fresh graphs;
      // the dedicated graphCache suite enables it explicitly. Production defaults ON.
      FF_AGENT_GRAPH_CACHE: '0',
      FF_BROWSER_ENABLED: '0',
      FF_CUSTOMER_SCOPE_STRICT: '0',
      FF_WORKER_DEPT_STRICT: '0',
      // Storage providers are pinned for the same reason as the flags above: a developer running the file
      // pipeline on Dropbox locally would otherwise have every storeFile() in the suite default to Dropbox
      // and attempt LIVE API calls with their real refresh token. The dropbox-storage suite sets
      // FILE_STORAGE_PROVIDER itself (vi.hoisted, before env parses) where it needs the other value.
      FILE_STORAGE_PROVIDER: 's3',
      COMMS_STORAGE_PROVIDER: 's3',
      // Shared secrets that route guards REQUIRE, pinned for the same determinism reason as the flags
      // above — but this direction of the hazard is the opposite one. `BILLING_INGEST_SECRET` defaults
      // to '' and `requireIngestSecret` answers 503 SERVER_MISCONFIGURED when it is empty, before any
      // auth check. So a developer without it in their .env saw all 22 payment-ingest route tests fail
      // — including the ones asserting 401 — while CI passed, because CI supplies a dummy in the
      // workflow env. Pinning it here makes the suite pass on a bare checkout with no .env at all,
      // which is the only version of "green locally" worth trusting before opening a PR.
      API_KEY: 'test-secret-key',
      BILLING_INGEST_SECRET: 'test-ingest-secret',
      // Horizon worker-CRM bot — pinned so a developer .env cannot leak a real token into HMAC
      // tests, and so the webhook secret is a known value. Distinct from TELEGRAM_* on purpose.
      HORIZON_BOT_TOKEN: 'horizon-test-token',
      HORIZON_BOT_SECRET: 'horizon-test-secret',
      HORIZON_BOT_USERNAME: 'horizon_test_bot',
      HORIZON_MINI_APP_URL: 'https://example.test/main',
      // The two that `buildHorizonOpenUrl()` branches on BEFORE falling back to the URL above. Left
      // unpinned they came from the developer's .env, so "no short name is set" was only true on
      // machines that happened not to set one: green in CI, red locally, for a reason nothing on
      // screen explains. Same class as the FF_ZOHO_MCP_ENABLED note above. A suite that needs
      // either branch sets it at runtime and restores to this baseline.
      HORIZON_MINI_APP_SHORT_NAME: '',
      HORIZON_MINI_APP_DIRECT: '',
      // Audit writes default ON. Unpinned, every route/tool test inserts into whatever
      // database the suite resolved — including prod when a developer DSN leaked in —
      // which is the "CI Test Admin" flood in Admin → Audit Log. Suites that assert
      // audit rows turn the flag back on (see audit-logging.test.ts).
      FF_AUDIT_LOG_ENABLED: '0',
      // Live vendors. dotenv will not override these, so a developer .env (or a CI secret
      // that happened to be in the runner env) cannot make `pnpm test` call EFS / servercrm
      // / Zoho / DWH / Telegram / RingCentral / Composio / OpenAI. Suites that need a stub
      // URL set it in vi.hoisted() before importing env.ts.
      FF_COMPOSIO_ENABLED: '0',
      FF_MANAGER_EFS_WRITES_ENABLED: '0',
      MANAGER_EFS_LIVE_ACTIONS: '',
      EFS_WSDL_URL: '',
      EFS_GROUP_WSDL_URL: '',
      EFS_LOGIN: '',
      EFS_PASSWORD: '',
      SERVER_CRM_URL: '',
      SERVER_CRM_KEY: '',
      DWH_DATABASE_URL: '',
      VERIFICATION_DATABASE_URL: '',
      OPENAI_API_KEY: '',
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_CARRIER_BOT_TOKEN: '',
      ZOHO_REFRESH_TOKEN: '',
      ZOHO_CRM_REFRESH_TOKEN: '',
      ZOHO_DESK_REFRESH_TOKEN: '',
      ZOHO_PEOPLE_REFRESH_TOKEN: '',
      ZOHO_CLIENT_SECRET: '',
      ZOHO_CRM_CLIENT_SECRET: '',
      RINGCENTRAL_JWT: '',
      RINGCENTRAL_CLIENT_SECRET: '',
      COMPOSIO_API_KEY: '',
      DBT_MCP_URL: '',
      DBT_MCP_CLIENT_SECRET: '',
      ZOHO_MCP_URL: '',
      CMP_PRODUCTION_URL: '',
      CMP_PRODUCTION_PASSWORD: '',
      CMP_SANDBOX_URL: '',
      CMP_SANDBOX_PASSWORD: '',
      AWS_MYSQL_DATABASE_URL: '',
      AWS_MYSQL_PASSWORD: '',
      DROPBOX_REFRESH_TOKEN: '',
      CREDIT_PLATFORM_API_KEY: '',
      // Phase 4 authority lookups. The BASE URLs are pinned empty too, not just the key: they carry
      // real public defaults in the schema, so leaving them set would let a suite that forgot to
      // stub fetch reach FMCSA and data.transportation.gov for real.
      FMCSA_API_KEY: '',
      FMCSA_BASE_URL: '',
      SOCRATA_BASE_URL: '',
      SOCRATA_APP_TOKEN: '',
      // Paid vendors: flags off and iSoftPull base empty so a forgotten stub cannot bill.
      VERIFICATION_PAID_VENDORS_ENABLED: '0',
      ISOFTPULL_LIVE_ENABLED: '0',
      ISOFTPULL_BASE_URL: '',
      ISOFTPULL_EQUIFAX_API_KEY: '',
      ISOFTPULL_EQUIFAX_API_SECRET: '',
      ISOFTPULL_TRANSUNION_API_KEY: '',
      ISOFTPULL_TRANSUNION_API_SECRET: '',
      ISOFTPULL_EXPERIAN_API_KEY: '',
      ISOFTPULL_EXPERIAN_API_SECRET: '',
      ISOFTPULL_API_KEY: '',
      ISOFTPULL_API_SECRET: '',
      PLAID_LIVE_ENABLED: '0',
      PLAID_CLIENT_ID: '',
      PLAID_SECRET: '',
      PLAID_ENV: 'sandbox',
      PLAID_ENVIRONMENT: '',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/server.ts'],
    },
  },
});
