import { defineConfig } from 'vitest/config';

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
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/server.ts'],
    },
  },
});
