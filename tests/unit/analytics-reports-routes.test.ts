/**
 * Analytics → Reports routes (/v1/analytics/reports…) — authorization.
 *
 * These are the only analytics reads that are NOT agent-scopable down to a single book: an org-wide
 * client-health or fuel-volume export is every carrier in the company in one downloadable file. The
 * `management` department gate is therefore the whole boundary between a sales rep and the company
 * book, so it gets its own regression suite (CLAUDE.md rule 9).
 *
 * A 403 must also mean the WAREHOUSE WAS NEVER QUERIED — not merely that the body was withheld
 * after the rows were already pulled.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
  // The route 503s when the DWH is unconfigured; these tests are about the gate, not the source.
  process.env.DWH_DATABASE_URL ??= 'postgres://user:pass@localhost:5432/dwh';
});

vi.mock('../../src/modules/analytics/reports/service.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/analytics/reports/service.js')>();
  return { ...mod, runAnalyticsReport: vi.fn(async () => ({ rows: [], columns: [] })) };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import { runAnalyticsReport } from '../../src/modules/analytics/reports/service.js';

const runMock = vi.mocked(runAnalyticsReport);

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  vi.clearAllMocks();
});

/** A verified worker session. `profile` drives the department grant (substring match). */
async function workerToken(profile: string, zohoUserId = '42'): Promise<string> {
  return signAccessToken({
    userId: `zoho:${zohoUserId}`,
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin', // stale claim — re-derived from the profile at verify
    worker: { zohoUserId, userName: 'Robiya', profile },
  });
}

const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

const CATALOG = '/v1/analytics/reports';
const RUN = '/v1/analytics/reports/fuel-volume';

describe('analytics reports are management-gated', () => {
  it('refuses an unauthenticated caller on both routes', async () => {
    for (const url of [CATALOG, RUN]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(401);
    }
    expect(runMock).not.toHaveBeenCalled();
  });

  it('refuses a sales rep — the company-wide export is not theirs to pull', async () => {
    const token = await workerToken('Sales Rep');
    const res = await app.inject({ method: 'GET', url: RUN, headers: bearer(token) });
    expect(res.statusCode).toBe(403);
    expect(runMock).not.toHaveBeenCalled();
  });

  it('refuses other departments too (billing, customer service)', async () => {
    for (const profile of ['Billing Clerk', 'Customer Service']) {
      const token = await workerToken(profile);
      const res = await app.inject({ method: 'GET', url: RUN, headers: bearer(token) });
      expect(res.statusCode).toBe(403);
    }
    expect(runMock).not.toHaveBeenCalled();
  });

  it('hides the catalog from a non-manager — not just the rows', async () => {
    const token = await workerToken('Sales Rep');
    const res = await app.inject({ method: 'GET', url: CATALOG, headers: bearer(token) });
    expect(res.statusCode).toBe(403);
  });

  it('allows a management worker to list the catalog', async () => {
    const token = await workerToken('Management');
    const res = await app.inject({ method: 'GET', url: CATALOG, headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { reports: Array<{ id: string }> };
    expect(body.reports.map((r) => r.id)).toContain('fuel-volume');
  });

  it('allows a management worker to run a report', async () => {
    const token = await workerToken('Management');
    const res = await app.inject({ method: 'GET', url: RUN, headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    expect(runMock).toHaveBeenCalledTimes(1);
  });

  it('allows an administrator', async () => {
    const token = await workerToken('Administrator');
    const res = await app.inject({ method: 'GET', url: RUN, headers: bearer(token) });
    expect(res.statusCode).toBe(200);
  });

  it('404s an unknown report id for an authorized caller — and never queries', async () => {
    const token = await workerToken('Management');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/analytics/reports/not-a-report',
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(404);
    expect(runMock).not.toHaveBeenCalled();
  });

  it('checks authorization BEFORE resolving the report id — no id oracle for a rep', async () => {
    // A rep probing report names must get the same 403 whether or not the id is real, otherwise
    // the status code leaks the catalog they were denied.
    const token = await workerToken('Sales Rep');
    const real = await app.inject({ method: 'GET', url: RUN, headers: bearer(token) });
    const fake = await app.inject({
      method: 'GET',
      url: '/v1/analytics/reports/not-a-report',
      headers: bearer(token),
    });
    expect(real.statusCode).toBe(403);
    expect(fake.statusCode).toBe(403);
  });
});
