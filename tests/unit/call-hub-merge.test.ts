/**
 * Call Hub merge helpers — status mapping + chronological merge without HTTP.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
  process.env.FF_GONG_ENABLED = '0';
});

const { listForCallerMock, countForCallerMock, runCoqlMock } = vi.hoisted(() => ({
  listForCallerMock: vi.fn(),
  countForCallerMock: vi.fn(),
  runCoqlMock: vi.fn(),
}));

vi.mock('../../src/repos/mytrionCallRepo.js', () => ({
  mytrionCallRepo: {
    listForCaller: listForCallerMock,
    countForCaller: countForCallerMock,
  },
}));

vi.mock('../../src/integrations/zohoCrm.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/integrations/zohoCrm.js')>();
  const stub = Object.create(mod.zohoCrm) as typeof mod.zohoCrm;
  stub.runCoql = runCoqlMock as unknown as typeof stub.runCoql;
  return { ...mod, zohoCrm: stub };
});

import { listCallHubCalls } from '../../src/modules/sales/callHub.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

const ctx: TenantContext = {
  tenantId: DEFAULT_TENANT_ID,
  userId: 'zoho:42',
  audience: 'internal',
  role: 'worker',
  scopes: ['*'],
  departments: ['sales'],
  allDepartmentAccess: false,
  requestId: 'req_call_hub_test',
};

beforeEach(() => {
  listForCallerMock.mockReset();
  countForCallerMock.mockReset();
  runCoqlMock.mockReset();
  listForCallerMock.mockResolvedValue([]);
  countForCallerMock.mockResolvedValue(0);
  runCoqlMock.mockResolvedValue({ rows: [], count: 0, moreRecords: false });
});

describe('listCallHubCalls', () => {
  it('filters by source and status after merge', async () => {
    listForCallerMock.mockResolvedValue([
      {
        id: 'mc_1',
        tenantId: DEFAULT_TENANT_ID,
        callerZohoUserId: '42',
        phoneNumber: '+1',
        direction: 'Outbound',
        callStatus: 'missed',
        durationSeconds: 0,
        result: 'No Answer',
        callTime: new Date('2026-07-21T12:00:00.000Z'),
        createdAt: new Date('2026-07-21T12:00:00.000Z'),
        sourceType: null,
        sourceId: null,
        sessionId: null,
      },
    ] as never);
    countForCallerMock.mockResolvedValue(1);
    runCoqlMock.mockResolvedValue({
      rows: [
        {
          id: 'z_1',
          Call_Type: 'Outbound',
          Call_Start_Time: '2026-07-22T12:00:00+00:00',
          Call_Duration_in_seconds: 90,
          Outgoing_Call_Status: 'Answered',
          Subject: 'Won',
          Call_Result: 'Connected',
        },
      ],
      count: 1,
      moreRecords: false,
    });

    const answeredZoho = await listCallHubCalls(ctx, '42', { source: 'zoho', status: 'answered' });
    expect(answeredZoho.calls).toHaveLength(1);
    expect(answeredZoho.calls[0]).toMatchObject({ id: 'z_1', source: 'zoho', status: 'answered' });
    expect(answeredZoho.agentZohoUserId).toBe('42');

    const missedMytrion = await listCallHubCalls(ctx, '42', {
      source: 'mytrion',
      status: 'missed',
    });
    expect(missedMytrion.calls).toHaveLength(1);
    expect(missedMytrion.calls[0]).toMatchObject({ id: 'mc_1', source: 'mytrion', status: 'missed' });
    expect(listForCallerMock).toHaveBeenCalledWith(
      ctx,
      '42',
      expect.objectContaining({ callStatus: 'missed' }),
    );
  });

  it('passes callerZohoUserId into the repo (identity from caller, not filter spoof)', async () => {
    await listCallHubCalls(ctx, 'agent-77', { pageSize: 10, page: 1 });
    expect(listForCallerMock).toHaveBeenCalledWith(
      ctx,
      'agent-77',
      expect.objectContaining({ limit: 10 }),
    );
    const q = runCoqlMock.mock.calls[0]?.[0] as string | undefined;
    expect(q).toContain("Owner = 'agent-77'");
  });

  it('paginates the merged list', async () => {
    listForCallerMock.mockResolvedValue(
      Array.from({ length: 3 }, (_, i) => ({
        id: `mc_${i}`,
        tenantId: DEFAULT_TENANT_ID,
        callerZohoUserId: '42',
        phoneNumber: `+1${i}`,
        direction: 'Outbound',
        callStatus: 'picked_up',
        durationSeconds: 1,
        result: 'ok',
        callTime: new Date(`2026-07-${20 - i}T12:00:00.000Z`),
        createdAt: new Date(`2026-07-${20 - i}T12:00:00.000Z`),
        sourceType: null,
        sourceId: null,
        sessionId: null,
      })) as never,
    );
    countForCallerMock.mockResolvedValue(3);
    runCoqlMock.mockResolvedValue({ rows: [], count: 0, moreRecords: false });

    const page1 = await listCallHubCalls(ctx, '42', { page: 1, pageSize: 2, source: 'mytrion' });
    expect(page1.calls).toHaveLength(2);
    expect(page1.total).toBe(3);
    expect(page1.page).toBe(1);

    const page2 = await listCallHubCalls(ctx, '42', { page: 2, pageSize: 2, source: 'mytrion' });
    expect(page2.calls).toHaveLength(1);
    expect(page2.page).toBe(2);
  });
});
