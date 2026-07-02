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
      FF_RAG_HYBRID: '0',
      FF_RAG_RERANK: '0',
      FF_WRITE_APPROVALS: '0',
      FF_AGENT_MEMORY: '0',
      FF_AGENT_CHECKPOINTS: '0',
      FF_BROWSER_ENABLED: '0',
      FF_CUSTOMER_SCOPE_STRICT: '0',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/server.ts'],
    },
  },
});
