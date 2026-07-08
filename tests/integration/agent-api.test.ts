import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Set the inbound API key before env.ts is imported (parsed once at import time).
vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

import { buildApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

const flags = {
  orchestrator: env.FF_ORCHESTRATOR_ENABLED,
  deep: env.FF_DEEP_AGENTS_ENABLED,
  jobs: env.FF_JOBS_ENABLED,
};
afterEach(() => {
  env.FF_ORCHESTRATOR_ENABLED = flags.orchestrator;
  env.FF_DEEP_AGENTS_ENABLED = flags.deep;
  env.FF_JOBS_ENABLED = flags.jobs;
});

const auth = { 'x-api-key': 'test-secret-key', 'content-type': 'application/json' };

describe('POST /v1/agent (gate paths — no LLM calls)', () => {
  it('404s when the flag is off', async () => {
    env.FF_ORCHESTRATOR_ENABLED = false;
    env.FF_DEEP_AGENTS_ENABLED = false;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/agent',
      headers: auth,
      payload: { message: 'hello' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('401s without the API key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/agent',
      headers: { 'content-type': 'application/json' },
      payload: { message: 'hello' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('403s direct-to-child when the caller lacks the department (before any model work)', async () => {
    env.FF_ORCHESTRATOR_ENABLED = true;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/agent',
      headers: auth,
      payload: {
        message: 'show me revenue',
        agent: 'finance',
        user_name: 'Sales Person',
        profile: 'Standard',
        department_scope: 'sales',
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'RBAC_DENIED' } });
  });

  it('400s an unknown agent key at schema validation', async () => {
    env.FF_ORCHESTRATOR_ENABLED = true;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/agent',
      headers: auth,
      payload: { message: 'hi', agent: 'not-a-real-agent' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /v1/agent/tasks (gate paths)', () => {
  it('503s when jobs are disabled', async () => {
    env.FF_JOBS_ENABLED = false;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/agent/tasks',
      headers: auth,
      payload: { message: 'run this later' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: { code: 'FEATURE_DISABLED' } });
  });

  it('401s without the API key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/agent/tasks',
      headers: { 'content-type': 'application/json' },
      payload: { message: 'hello' },
    });
    expect(res.statusCode).toBe(401);
  });
});
