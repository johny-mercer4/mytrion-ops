/**
 * Call Hub list — session / View-as identity scoping + merged DTO (Mytrion + Zoho).
 * Query params must not spoof the caller; Owner / callerZohoUserId come from effective ctx.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

const { listForCallerMock, countForCallerMock, runCoqlMock, auditFromContextMock, resolveActAsMock } =
  vi.hoisted(() => ({
    listForCallerMock: vi.fn(),
    countForCallerMock: vi.fn(),
    runCoqlMock: vi.fn(),
    auditFromContextMock: vi.fn(async () => undefined),
    resolveActAsMock: vi.fn(),
  }));

vi.mock('../../src/repos/mytrionCallRepo.js', () => ({
  mytrionCallRepo: {
    listForCaller: listForCallerMock,
    countForCaller: countForCallerMock,
    create: vi.fn(),
    listForSource: vi.fn(),
  },
}));

vi.mock('../../src/integrations/zohoCrm.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/integrations/zohoCrm.js')>();
  const stub = Object.create(mod.zohoCrm) as typeof mod.zohoCrm;
  stub.runCoql = runCoqlMock as unknown as typeof stub.runCoql;
  return { ...mod, zohoCrm: stub };
});

vi.mock('../../src/modules/auth/actAsDirectory.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/auth/actAsDirectory.js')>();
  return {
    ...mod,
    resolveActAsTarget: resolveActAsMock,
  };
});

vi.mock('../../src/modules/audit/auditLogger.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/audit/auditLogger.js')>();
  return {
    ...mod,
    audit: vi.fn(async () => undefined),
    auditFromContext: auditFromContextMock,
  };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  listForCallerMock.mockReset();
  countForCallerMock.mockReset();
  runCoqlMock.mockReset();
  auditFromContextMock.mockReset();
  resolveActAsMock.mockReset();
  listForCallerMock.mockResolvedValue([]);
  countForCallerMock.mockResolvedValue(0);
  runCoqlMock.mockResolvedValue({ rows: [], count: 0, moreRecords: false });
  resolveActAsMock.mockImplementation(async (id: string) =>
    id === '777'
      ? {
          zohoUserId: '777',
          name: 'Michael Thompson',
          profile: 'Sales Agent',
          role: 'Agent',
        }
      : null,
  );
});

async function salesToken(zohoUserId = '42', profile = 'Sales Agent'): Promise<string> {
  return signAccessToken({
    userId: `zoho:${zohoUserId}`,
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin',
    worker: { zohoUserId, userName: 'CI Test Admin', profile },
  });
}

async function adminToken(): Promise<string> {
  return signAccessToken({
    userId: 'zoho:admin1',
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin',
    worker: { zohoUserId: 'admin1', userName: 'Admin', profile: 'Administrator' },
  });
}

describe('GET /v1/sales/call-hub/calls', () => {
  it('scopes Mytrion + Zoho fetches to the session Zoho user (ignores spoof query)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/sales/call-hub/calls?callerZohoUserId=999&page_size=25',
      headers: { authorization: `Bearer ${await salesToken('42')}` },
    });
    expect(res.statusCode).toBe(200);
    expect(listForCallerMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: DEFAULT_TENANT_ID, userId: 'zoho:42' }),
      '42',
      expect.objectContaining({ limit: 25, offset: 0 }),
    );
    expect(runCoqlMock).toHaveBeenCalledTimes(1);
    const coql = runCoqlMock.mock.calls[0]?.[0] as string;
    expect(coql).toContain("Owner = '42'");
    expect(coql).not.toContain('999');
    const body = res.json() as { agentZohoUserId: string; page: number; pageSize: number };
    expect(body.agentZohoUserId).toBe('42');
    expect(body.pageSize).toBe(25);
  });

  it('scopes to the View-as agent when admin sends x-act-as-zoho-user-id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/sales/call-hub/calls',
      headers: {
        authorization: `Bearer ${await adminToken()}`,
        'x-act-as-zoho-user-id': '777',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(listForCallerMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'zoho:777', impersonatorUserId: 'zoho:admin1' }),
      '777',
      expect.any(Object),
    );
    const coql = runCoqlMock.mock.calls[0]?.[0] as string;
    expect(coql).toContain("Owner = '777'");
    expect(coql).not.toContain('admin1');
    expect(res.json()).toMatchObject({ agentZohoUserId: '777' });
  });

  it('merges Mytrion + Zoho into a unified DTO sorted by start time desc', async () => {
    listForCallerMock.mockResolvedValue([
      {
        id: 'mc_old',
        tenantId: DEFAULT_TENANT_ID,
        callerZohoUserId: '42',
        phoneNumber: '+15551110000',
        direction: 'Outbound',
        callStatus: 'picked_up',
        durationSeconds: 30,
        result: 'Connected',
        callTime: new Date('2026-07-20T10:00:00.000Z'),
        createdAt: new Date('2026-07-20T10:00:00.000Z'),
        sourceType: 'lead',
        sourceId: 'LEAD1',
        sessionId: null,
      },
    ] as never);
    countForCallerMock.mockResolvedValue(1);
    runCoqlMock.mockResolvedValue({
      rows: [
        {
          id: 'z_new',
          Call_Type: 'Outbound',
          Call_Start_Time: '2026-07-22T15:00:00+00:00',
          Call_Duration_in_seconds: 0,
          Outgoing_Call_Status: 'No Answer',
          Subject: 'Follow-up',
          Call_Result: 'No Answer',
          Who_Id: { id: 'LEAD9', name: 'Acme' },
        },
      ],
      count: 1,
      moreRecords: false,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/sales/call-hub/calls',
      headers: { authorization: `Bearer ${await salesToken('42')}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      calls: Array<{
        id: string;
        source: string;
        status: string;
        phone: string;
        linked: { type: string; id: string; label?: string } | null;
      }>;
      total: number;
    };
    expect(body.calls).toHaveLength(2);
    expect(body.total).toBe(2);
    expect(body.calls[0]).toMatchObject({
      id: 'z_new',
      source: 'zoho',
      status: 'missed',
      subject: 'Follow-up',
      linked: { type: 'lead', id: 'LEAD9', label: 'Acme' },
    });
    expect(body.calls[1]).toMatchObject({
      id: 'mc_old',
      source: 'mytrion',
      status: 'answered',
      phone: '+15551110000',
      linked: { type: 'lead', id: 'LEAD1' },
    });
  });

  it('rejects non-sales departments', async () => {
    const token = await signAccessToken({
      userId: 'zoho:9',
      tenantId: DEFAULT_TENANT_ID,
      audience: 'internal',
      role: 'admin',
      worker: { zohoUserId: '9', userName: 'Billing', profile: 'Billing Clerk' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/sales/call-hub/calls',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    expect(listForCallerMock).not.toHaveBeenCalled();
  });
});
