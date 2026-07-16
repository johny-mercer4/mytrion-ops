/**
 * Enriched audit trail: every row carries the FULL actor identity (user, name, profile,
 * role, company) for internal workers AND carrier-client sessions, and the admin audit
 * endpoint is filterable + admin-gated.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

vi.mock('../../src/repos/auditRepo.js', () => ({
  auditRepo: {
    insert: vi.fn(async () => undefined),
    list: vi.fn(async () => []),
    count: vi.fn(async () => 0),
  },
}));

// contextFromClaims resolves a worker's grant from the DB — mock with the DB-free legacy derivation
// so audit tests stay offline/deterministic (resolver logic is covered in mytrion-access.test.ts).
vi.mock('../../src/modules/access/mytrionAccessService.js', async () => {
  const dept = await import('../../src/lib/department.js');
  const { MYTRION_IDS, MYTRION_DEPARTMENT } = await import('../../src/lib/mytrions.js');
  return {
    mytrionAccessService: {
      resolveWorkerAccess: vi.fn(
        async (input: { profileName?: string | null; zohoRole?: string | null; userName?: string | null }) => {
          const envAdmin = dept.resolveAllDepartmentAccess({
            profile: input.profileName ?? null,
            role: input.zohoRole ?? null,
            userName: input.userName ?? null,
          });
          if (envAdmin) {
            return { accessibleMytrions: [...MYTRION_IDS], homeMytrion: null, allDepartmentAccess: true, departments: [] };
          }
          const departments = dept.deriveWorkerDepartments(input.profileName ?? null, input.zohoRole ?? null);
          const set = new Set(departments);
          const accessible = MYTRION_IDS.filter((id) => set.has(MYTRION_DEPARTMENT[id]));
          return {
            accessibleMytrions: accessible,
            homeMytrion: accessible.length === 1 ? (accessible[0] ?? null) : null,
            allDepartmentAccess: false,
            departments,
          };
        },
      ),
      invalidateUser: vi.fn(),
      invalidateAll: vi.fn(),
    },
  };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import type { NewAuditEntry } from '../../src/db/schema/index.js';
import { contextFromClaims } from '../../src/modules/auth/authService.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import { auditFromContext } from '../../src/modules/audit/auditLogger.js';
import { auditRepo } from '../../src/repos/auditRepo.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

const repo = vi.mocked(auditRepo);

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  repo.insert.mockClear();
  repo.list.mockClear();
  repo.count.mockClear();
});

function lastInserted(): NewAuditEntry {
  const row = repo.insert.mock.calls.at(-1)?.[0];
  if (!row) throw new Error('no audit row inserted');
  return row;
}

describe('auditFromContext — full actor identity on every row', () => {
  it('stamps a WORKER identity: name, profile, Zoho role, internal role', async () => {
    const ctx = await contextFromClaims(
      {
        userId: 'zoho:42',
        tenantId: DEFAULT_TENANT_ID,
        audience: 'internal',
        role: 'admin',
        worker: { zohoUserId: '42', userName: 'Bob Fleet', profile: 'Sales Rep', zohoRole: 'Sales Agent' },
      },
      'rq-1',
    );
    await auditFromContext(ctx, { action: 'automation.log', status: 'ok' });
    const row = lastInserted();
    expect(row).toMatchObject({
      userId: 'zoho:42',
      userName: 'Bob Fleet',
      profile: 'Sales Rep',
      callerRole: 'Sales Agent',
      role: 'worker', // derived from the non-admin profile
      audience: 'internal',
      action: 'automation.log',
    });
    expect(row.company).toBeUndefined(); // company is a customer-audience concept
  });

  it('stamps a CARRIER-CLIENT identity: login, access profile, viewer role, company tags', async () => {
    const ctx = await contextFromClaims(
      {
        userId: 'client:cu_1',
        tenantId: DEFAULT_TENANT_ID,
        audience: 'customer',
        role: 'viewer',
        client: {
          carrierUserId: 'cu_1',
          clientProfile: 'owner',
          carrierId: '5758544',
          applicationId: 'APP-9',
          login: 'acme.owner',
        },
      },
      'rq-2',
    );
    await auditFromContext(ctx, { action: 'chat.turn', status: 'ok' });
    const row = lastInserted();
    expect(row).toMatchObject({
      userId: 'client:cu_1',
      userName: 'acme.owner',
      profile: 'Owner',
      role: 'viewer',
      audience: 'customer',
      company: '5758544, app-9',
    });
  });

  it('stamps the impersonator column under act-as', async () => {
    const ctx: TenantContext = {
      tenantId: DEFAULT_TENANT_ID,
      userId: 'zoho:777',
      audience: 'internal',
      role: 'worker',
      scopes: [],
      departments: ['sales'],
      allDepartmentAccess: false,
      userName: 'Rep Riley',
      impersonatorUserId: 'zoho:1',
      requestId: 'rq-3',
    };
    await auditFromContext(ctx, { action: 'tool.call', status: 'ok', toolName: 'crm.list_my_clients' });
    expect(lastInserted()).toMatchObject({
      userId: 'zoho:777',
      userName: 'Rep Riley',
      impersonatorUserId: 'zoho:1',
      toolName: 'crm.list_my_clients',
    });
  });
});

describe('GET /v1/admin/audit — gate + filters', () => {
  const API_KEY_HEADERS = { 'x-api-key': 'test-secret-key' };

  it('forwards filters to the repo and returns entries + total (no tenantId on the wire)', async () => {
    repo.list.mockResolvedValueOnce([
      {
        id: 'a1',
        tenantId: DEFAULT_TENANT_ID,
        audience: 'customer',
        userId: 'client:cu_1',
        userName: 'acme.owner',
        profile: 'Carrier Owner',
        callerRole: null,
        role: 'viewer',
        company: '5758544',
        impersonatorUserId: null,
        action: 'auth.client_login',
        resourceType: null,
        resourceId: null,
        toolName: null,
        status: 'ok',
        actingAgent: null,
        agentRunId: null,
        detail: { carrierId: '5758544' },
        requestId: 'rq',
        ip: '1.2.3.4',
        userAgent: null,
        createdAt: new Date('2026-07-07T00:00:00Z'),
      },
    ]);
    repo.count.mockResolvedValueOnce(1);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/audit?action=auth.&audience=customer&status=ok&limit=25&offset=0',
      headers: API_KEY_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { entries: Array<Record<string, unknown>>; total: number };
    expect(body.total).toBe(1);
    expect(body.entries[0]).toMatchObject({
      userName: 'acme.owner',
      company: '5758544',
      action: 'auth.client_login',
    });
    expect(body.entries[0]).not.toHaveProperty('tenantId');
    expect(repo.list.mock.calls.at(-1)?.[1]).toMatchObject({
      action: 'auth.',
      audience: 'customer',
      status: 'ok',
      limit: 25,
      offset: 0,
    });
  });

  it('denies non-admin workers and carrier-client sessions; requires auth', async () => {
    const workerToken = await signAccessToken({
      userId: 'zoho:42',
      tenantId: DEFAULT_TENANT_ID,
      audience: 'internal',
      role: 'admin', // stale — re-derived to worker from the profile
      worker: { zohoUserId: '42', profile: 'Sales Rep' },
    });
    const clientToken = await signAccessToken({
      userId: 'client:cu_1',
      tenantId: DEFAULT_TENANT_ID,
      audience: 'customer',
      role: 'viewer',
      client: { carrierUserId: 'cu_1', clientProfile: 'owner', carrierId: '5758544' },
    });
    for (const token of [workerToken, clientToken]) {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/admin/audit',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
    }
    expect((await app.inject({ method: 'GET', url: '/v1/admin/audit' })).statusCode).toBe(401);
  });

  it('admin-profile worker sessions pass', async () => {
    const token = await signAccessToken({
      userId: 'zoho:1',
      tenantId: DEFAULT_TENANT_ID,
      audience: 'internal',
      role: 'admin',
      worker: { zohoUserId: '1', userName: 'Admin Ann', profile: 'Administrator' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/audit',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });
});
