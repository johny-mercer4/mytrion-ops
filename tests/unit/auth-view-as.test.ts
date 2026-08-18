/**
 * GET /auth/view-as/:zohoUserId — the admin "View as" RBAC-preview source.
 *
 * The security point: it is ADMIN-ONLY and reports the TARGET's effective access (never the caller's),
 * so the client can render the workspace as them. resolveWorkerAccess is mocked and keyed by id, so the
 * caller and the target resolve to different access without a database.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

vi.mock('../../src/modules/access/mytrionAccessService.js', () => ({
  mytrionAccessService: {
    resolveWorkerAccess: vi.fn(async ({ zohoUserId }: { zohoUserId: string }) => {
      const base = { homeMytrion: null, mytrionTabGrants: {}, viewAsUserIds: [] as string[] };
      if (zohoUserId === 'admin1')
        return { ...base, allDepartmentAccess: true, departments: ['hr', 'sales'], accessibleMytrions: ['hr', 'sales'], mytrionAccessModes: {} };
      if (zohoUserId === 'staff1')
        return { ...base, allDepartmentAccess: false, departments: ['hr'], accessibleMytrions: ['hr'], mytrionAccessModes: { hr: 'read' } };
      if (zohoUserId === 'target1')
        return {
          ...base,
          allDepartmentAccess: false,
          departments: ['hr'],
          accessibleMytrions: ['hr'],
          homeMytrion: 'hr',
          mytrionAccessModes: { hr: 'full' },
        };
      return { ...base, allDepartmentAccess: false, departments: [], accessibleMytrions: [], mytrionAccessModes: {} };
    }),
    invalidateAll: vi.fn(),
    resolveBatch: vi.fn(async () => new Map()),
  },
}));

vi.mock('../../src/modules/auth/actAsDirectory.js', () => ({
  resolveActAsTarget: vi.fn(async (zohoUserId: string) =>
    zohoUserId === 'target1'
      ? { zohoUserId: 'target1', name: 'Target User', email: 't@x.com', profile: 'HR Manager', role: 'Staff', isOnline: false }
      : null,
  ),
  listActiveUsersCached: vi.fn(async () => []),
}));

vi.mock('../../src/modules/audit/auditLogger.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/audit/auditLogger.js')>();
  return { ...mod, audit: vi.fn(async () => undefined), auditFromContext: vi.fn(async () => undefined) };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';

async function token(zohoUserId: string, profile: string): Promise<string> {
  return signAccessToken({
    userId: `zoho:${zohoUserId}`,
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'worker',
    worker: { zohoUserId, userName: 'Test', profile },
  });
}

const bearer = (t: string): Record<string, string> => ({ authorization: `Bearer ${t}` });

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

describe('GET /auth/view-as/:zohoUserId', () => {
  it('returns the TARGET’s effective access to an admin (not the caller’s)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/auth/view-as/target1',
      headers: bearer(await token('admin1', 'Administrator')),
    });
    expect(res.statusCode).toBe(200);
    const { worker } = res.json() as { worker: Record<string, unknown> };
    expect(worker.zohoUserId).toBe('target1');
    expect(worker.profile).toBe('HR Manager'); // identity from the CRM directory, not the caller
    // The whole point: these are the TARGET's numbers, so the client renders AS them.
    expect(worker.mytrionAccessModes).toEqual({ hr: 'full' });
    expect(worker.allDepartmentAccess).toBe(false);
    expect(worker.accessibleMytrions).toEqual(['hr']);
  });

  it('403s a non-admin caller — the preview is admins only', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/auth/view-as/target1',
      headers: bearer(await token('staff1', 'HR')),
    });
    expect(res.statusCode).toBe(403);
  });

  it('404s when no active user matches the id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/auth/view-as/nobody',
      headers: bearer(await token('admin1', 'Administrator')),
    });
    expect(res.statusCode).toBe(404);
  });

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/auth/view-as/target1' });
    expect(res.statusCode).toBe(401);
  });
});
