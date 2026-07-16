/**
 * GET /v1/health/integrations — admin-gated wrapper health via the registry. (The lazy-handle
 * "no SDK import until configured + asked" invariant is pinned in wrapper-core.test.ts; the
 * agent tool layer still imports the Composio SDK at boot through browserTools, so it can't
 * be asserted at app level.)
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { env } from '../../src/config/env.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

describe('GET /v1/health/integrations', () => {
  it('requires auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health/integrations' });
    expect(res.statusCode).toBe(401);
  });

  it('refuses a non-admin worker session', async () => {
    const token = await signAccessToken({
      userId: 'zoho:42',
      tenantId: DEFAULT_TENANT_ID,
      audience: 'internal',
      role: 'admin', // stale — re-derived to worker from the profile
      worker: { zohoUserId: '42', userName: 'Robiya', profile: 'Sales Rep' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/health/integrations',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('reports every registered wrapper (configured-only mode, Composio SDK untouched)', async () => {
    const savedComposio = env.FF_COMPOSIO_ENABLED;
    env.FF_COMPOSIO_ENABLED = false; // unconfigured → the lazy handle must not load()
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/health/integrations',
        headers: { 'x-api-key': 'test-secret-key' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { integrations: Array<{ name: string; ok: boolean }>; live: boolean };
      expect(body.live).toBe(false);
      const names = body.integrations.map((w) => w.name);
      for (const expected of [
        'internal_db', 'dwh', 'cmp_mysql', 'cmp', 'server_crm',
        'zoho_crm', 'zoho_desk', 'zoho_people', 'ringcentral', 'composio',
      ]) {
        expect(names).toContain(expected);
      }
      const composio = body.integrations.find((w) => w.name === 'composio');
      expect(composio).toMatchObject({ configured: false, ok: false });
    } finally {
      env.FF_COMPOSIO_ENABLED = savedComposio;
    }
  });
});
