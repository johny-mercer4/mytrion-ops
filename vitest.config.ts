import { defineConfig } from 'vitest/config';

/**
 * Where unit tests point Postgres.
 *
 * CI exports `MYTRION_OPS_DATABASE_URL` for its own pg service (port 5432), so an existing value
 * always wins. The fallback is what matters locally: without it, tests inherit the developer's
 * `.env`, which points at **Render production in Oregon** — and route suites resolve a session
 * through the database, so the first test in each file paid a real cross-country round trip.
 * Measured: 4.4s to 7.2s against a 5s default timeout, i.e. a coin flip, and the cause of
 * intermittent failures that look like they belong to whatever feature was last touched.
 *
 * Same reasoning as the FF_ZOHO_MCP_ENABLED pin below: a unit run must not depend on a network
 * service answering quickly.
 */
const TEST_DATABASE_URL =
  process.env.MYTRION_OPS_DATABASE_URL ??
  'postgresql://octane:octane@localhost:5433/octane_assistant';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
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
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/server.ts'],
    },
  },
});
