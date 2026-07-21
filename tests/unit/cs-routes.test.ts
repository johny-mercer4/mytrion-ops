/**
 * Customer Service Mytrion backend — RBAC gates, touchpoint catalog scoping, the
 * Applications save orchestration (Edit_History append + Deal mirror + casing guard),
 * and the analytics scope forcing (non-managers can never see org-wide numbers).
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

vi.mock('../../src/integrations/zohoCrmRecords.js', () => ({
  zohoCrmRecords: {
    getRecord: vi.fn(async () => null),
    listRecords: vi.fn(async () => ({ rows: [], moreRecords: false })),
    searchRecords: vi.fn(async () => ({ rows: [], moreRecords: false })),
    updateRecord: vi.fn(async () => 'ok'),
    insertRecord: vi.fn(async () => 'new-id'),
    deleteRecord: vi.fn(async () => undefined),
    getModuleFields: vi.fn(async () => []),
  },
}));
vi.mock('../../src/integrations/zohoFunctions.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/integrations/zohoFunctions.js')>();
  return { ...mod, executeZohoFunctionWithFallback: vi.fn(async () => ({})) };
});
// Roster primary source (Desk REST) rejects here so the tests drive the Deluge fallback,
// which the zohoFunctions mock above controls per-test.
vi.mock('../../src/integrations/zohoDesk.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/integrations/zohoDesk.js')>();
  return {
    ...mod,
    zohoDesk: Object.assign(Object.create(Object.getPrototypeOf(mod.zohoDesk)), mod.zohoDesk, {
      listAgents: vi.fn(async () => {
        throw new Error('desk unavailable in tests');
      }),
    }),
  };
});
vi.mock('../../src/integrations/serverCrm.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/integrations/serverCrm.js')>();
  return { ...mod, serverCrm: { ...mod.serverCrm, get: vi.fn(async () => ({ ok: true })) } };
});
vi.mock('../../src/modules/audit/auditLogger.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/audit/auditLogger.js')>();
  return { ...mod, audit: vi.fn(async () => undefined), auditFromContext: vi.fn(async () => undefined) };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { serverCrm } from '../../src/integrations/serverCrm.js';
import { executeZohoFunctionWithFallback } from '../../src/integrations/zohoFunctions.js';
import { zohoCrmRecords } from '../../src/integrations/zohoCrmRecords.js';
import { auditFromContext } from '../../src/modules/audit/auditLogger.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import { invalidateRosterCache } from '../../src/modules/customerService/csAnalyticsScope.js';
import { invalidateFieldCache } from '../../src/modules/customerService/fieldResolver.js';
import { getTouchpoint, listTouchpoints } from '../../src/modules/touchpoints/catalog/index.js';
import { canInvokeTouchpoint } from '../../src/modules/touchpoints/dispatcher.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

const records = vi.mocked(zohoCrmRecords, true);
const deluge = vi.mocked(executeZohoFunctionWithFallback);
const dwhGet = vi.mocked(serverCrm.get);

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
  invalidateFieldCache();
  invalidateRosterCache();
  // clearAllMocks keeps implementations — restore the defaults a test may have replaced.
  records.getRecord.mockResolvedValue(null);
  records.updateRecord.mockResolvedValue('ok');
  records.insertRecord.mockResolvedValue('new-id');
  records.getModuleFields.mockResolvedValue([
    { api_name: 'Limits_Added' },
    { api_name: 'Chain_Policy' },
    { api_name: 'Mobile_Driver_App' },
    { api_name: 'Email_to_TA' },
    { api_name: 'TA_EFS_Added' },
    { api_name: 'Tracking_Number' },
    { api_name: 'Credit_Score' },
    { api_name: 'Edit_History' },
    { api_name: 'Payment_Type_Billing' },
    { api_name: 'Billing_Cycle' },
    { api_name: 'Billing_Verification' },
    { api_name: 'Name' },
    { api_name: 'Status_of_App', pick_list_values: [{ actual_value: 'In process' }] },
  ]);
});

async function workerToken(opts: {
  profile: string;
  zohoRole?: string;
  email?: string;
  zohoUserId?: string;
}): Promise<string> {
  return signAccessToken({
    userId: `zoho:${opts.zohoUserId ?? '42'}`,
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin', // stale claim — re-derived from the profile at verify
    worker: {
      zohoUserId: opts.zohoUserId ?? '42',
      userName: 'Test CS Agent',
      profile: opts.profile,
      ...(opts.zohoRole ? { zohoRole: opts.zohoRole } : {}),
      ...(opts.email ? { email: opts.email } : {}),
    },
  });
}

// CS access is Admin / profile-default grant only — use Customer Retention (seeded → CS).
const csAgent = () =>
  workerToken({
    profile: 'Customer Retention',
    zohoRole: 'Customer Service Agent',
    email: 'agent@octanefuel.com',
  });
// 'director' is a CS manager marker but NOT an admin marker — exercises the marker path.
const csDirector = () =>
  workerToken({
    profile: 'Customer Retention',
    zohoRole: 'Customer Service Director',
    email: 'director@octanefuel.com',
  });
const salesAgent = () =>
  workerToken({ profile: 'Sales Agent', zohoRole: 'Uzbekistan Sales Agent' });

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function csCtx(overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    tenantId: DEFAULT_TENANT_ID,
    userId: 'zoho:42',
    audience: 'internal',
    role: 'worker',
    scopes: [],
    departments: ['customer-service'],
    allDepartmentAccess: false,
    requestId: 'test',
    ...overrides,
  } as TenantContext;
}

describe('cs touchpoint catalog', () => {
  it('registers the four cs.* entries, all customer-service scoped reads', () => {
    const keys = ['cs.home.metrics', 'cs.applications.list', 'cs.analytics.maintenance', 'cs.datacenter.deals'];
    for (const key of keys) {
      const tp = getTouchpoint(key);
      expect(tp, key).toBeDefined();
      expect(tp?.departments).toEqual(['customer-service']);
      expect(tp?.riskClass).toBe('read');
    }
    expect(listTouchpoints().filter((t) => t.key.startsWith('cs.'))).toHaveLength(keys.length);
  });

  it('dispatcher gate: customer-service dept passes, sales dept is refused, admin passes', () => {
    const tp = getTouchpoint('cs.home.metrics');
    if (!tp) throw new Error('missing touchpoint');
    expect(canInvokeTouchpoint(csCtx(), tp)).toBe(true);
    expect(canInvokeTouchpoint(csCtx({ departments: ['sales'] }), tp)).toBe(false);
    expect(canInvokeTouchpoint(csCtx({ departments: [], allDepartmentAccess: true }), tp)).toBe(true);
  });
});

describe('/cs/* route gates', () => {
  it('a sales worker asserting x-department-access: customer-service is refused', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/cs/applications/123/onboarding',
      headers: { ...bearer(await salesAgent()), 'x-department-access': 'customer-service' },
      payload: { field: 'Email_to_TA', value: true },
    });
    expect(res.statusCode).toBe(403);
    expect(records.updateRecord).not.toHaveBeenCalled();
  });

  it('unauthenticated calls are rejected', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/cs/citifuel' });
    expect(res.statusCode).toBe(401);
  });

  it('Customer Retention profile grants CS with NO headers', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/cs/citifuel',
      headers: bearer(await csAgent()),
    });
    expect(res.statusCode).toBe(200);
    expect(records.listRecords).toHaveBeenCalled();
  });

  it('Customer Service Agent role alone does NOT grant CS (Admin-controlled)', async () => {
    const token = await workerToken({
      profile: 'Sales Agent',
      zohoRole: 'Customer Service Agent',
      email: 'role-only@octanefuel.com',
      zohoUserId: 'role-only-1',
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/cs/citifuel',
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('applications save orchestration', () => {
  function fullRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: '123',
      Edit_History: [{ Column_Name: 'Stage', Who_Edited: 'Old Agent', New_Value: 'x', Edited_On: 'earlier' }],
      Related_Deal: { id: '777' },
      ...overrides,
    };
  }

  it('appends Edit_History (never replaces), resolves casing, mirrors the Deal', async () => {
    records.getRecord.mockResolvedValue(fullRecord());
    const res = await app.inject({
      method: 'POST',
      url: '/v1/cs/applications/123',
      headers: bearer(await csAgent()),
      // lowercase spellings on purpose — the resolver must map to the live casing
      payload: { changes: { limits_added: true, chain_policy: true } },
    });
    expect(res.statusCode).toBe(200);

    const appCall = records.updateRecord.mock.calls.find((c) => c[0] === 'Applications');
    expect(appCall).toBeDefined();
    const payload = appCall?.[2] as Record<string, unknown>;
    expect(payload.Limits_Added).toBe(true);
    expect(payload.Chain_Policy).toBe(true);
    const history = payload.Edit_History as Array<Record<string, unknown>>;
    expect(history).toHaveLength(3); // 1 existing + 2 appended
    expect(history[0]?.Who_Edited).toBe('Old Agent');
    expect(history[1]?.Who_Edited).toBe('Test CS Agent');

    const dealCall = records.updateRecord.mock.calls.find((c) => c[0] === 'Deals');
    expect(dealCall?.[1]).toBe('777');
    const dealPayload = dealCall?.[2] as Record<string, unknown>;
    expect(Object.keys(dealPayload)).toEqual(
      expect.arrayContaining(['Limits_Added', 'Chain_Policy']),
    );
  });

  it('rejects fields outside the CS edit allowlist with a 400 (silent no-op guard)', async () => {
    records.getRecord.mockResolvedValue(fullRecord());
    const res = await app.inject({
      method: 'POST',
      url: '/v1/cs/applications/123',
      headers: bearer(await csAgent()),
      payload: { changes: { Owner: 'someone-else' } },
    });
    expect(res.statusCode).toBe(400);
    expect(records.updateRecord).not.toHaveBeenCalled();
  });

  it('a failed Deal mirror is a warning, not a failed save', async () => {
    records.getRecord.mockResolvedValue(fullRecord());
    records.updateRecord.mockImplementation(async (module: string) => {
      if (module === 'Deals') throw new Error('deal is locked');
      return 'ok';
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/cs/applications/123/onboarding',
      headers: bearer(await csAgent()),
      payload: { field: 'TA_EFS_Added', value: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().warning).toContain('Deal mirror failed');
    expect(auditFromContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'cs.application.onboarding_toggle', status: 'ok' }),
    );
  });

  it('404s on a missing application', async () => {
    records.getRecord.mockResolvedValue(null);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/cs/applications/999',
      headers: bearer(await csAgent()),
      payload: { changes: { Tracking_Number: 'TRK-1' } },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('citifuel writes', () => {
  it('create resolves casing, triggers workflow, audits with the record name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/cs/citifuel',
      headers: bearer(await csAgent()),
      payload: { Name: 'Acme Trucking', status_of_app: 'In process' },
    });
    expect(res.statusCode).toBe(200);
    expect(records.insertRecord).toHaveBeenCalledWith(
      'Citifuel_Clients',
      expect.objectContaining({ Name: 'Acme Trucking', Status_of_App: 'In process' }),
      ['workflow'],
    );
    expect(auditFromContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'cs.citifuel.create' }),
    );
  });

  it('delete audits a snapshot of the record', async () => {
    records.getRecord.mockResolvedValue({ Name: 'Acme', App_ID: 7, Status_of_App: 'Closed' });
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/cs/citifuel/555',
      headers: bearer(await csAgent()),
    });
    expect(res.statusCode).toBe(200);
    expect(records.deleteRecord).toHaveBeenCalledWith('Citifuel_Clients', '555');
    expect(auditFromContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'cs.citifuel.delete',
        detail: expect.objectContaining({ snapshot: expect.objectContaining({ name: 'Acme' }) }),
      }),
    );
  });

  it('rejects non-editable fields', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/cs/citifuel/555',
      headers: bearer(await csAgent()),
      payload: { Created_By: 'hax' },
    });
    expect(res.statusCode).toBe(400);
    expect(records.updateRecord).not.toHaveBeenCalled();
  });
});

describe('analytics scope forcing', () => {
  const WINDOW =
    'from=2026-07-01T00:00:00.000Z&to=2026-07-16T00:00:00.000Z&prevFrom=2026-06-15T00:00:00.000Z&prevTo=2026-07-01T00:00:00.000Z';

  it('a non-manager gets their OWN Desk assignee id forced (client param ignored)', async () => {
    deluge.mockResolvedValue({ data: [{ id: 'desk-9', email: 'agent@octanefuel.com' }] });
    const res = await app.inject({
      method: 'GET',
      url: `/v1/cs/analytics/tickets?${WINDOW}&assigneeId=desk-999`,
      headers: bearer(await csAgent()),
    });
    expect(res.statusCode).toBe(200);
    expect(dwhGet).toHaveBeenCalledWith(
      '/api/desk/dwh/tickets/analytics',
      expect.objectContaining({ assigneeId: 'desk-9' }),
    );
  });

  it('an unmatched non-manager gets {unmatched:true}, never org-wide data', async () => {
    deluge.mockResolvedValue({ data: [{ id: 'desk-1', email: 'other@octanefuel.com' }] });
    const res = await app.inject({
      method: 'GET',
      url: `/v1/cs/analytics/tickets?${WINDOW}`,
      headers: bearer(await csAgent()),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ unmatched: true });
    expect(dwhGet).not.toHaveBeenCalled();
  });

  it('a manager (marker role, not admin) may drill into any agent', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/cs/analytics/tickets?${WINDOW}&assigneeId=desk-123`,
      headers: bearer(await csDirector()),
    });
    expect(res.statusCode).toBe(200);
    expect(dwhGet).toHaveBeenCalledWith(
      '/api/desk/dwh/tickets/analytics',
      expect.objectContaining({ assigneeId: 'desk-123' }),
    );
  });

  it('calls analytics forces the caller email for non-managers', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/cs/analytics/calls?${WINDOW}&ownerEmail=victim@octanefuel.com`,
      headers: bearer(await csAgent()),
    });
    expect(res.statusCode).toBe(200);
    expect(dwhGet).toHaveBeenCalledWith(
      '/api/desk/dwh/calls/analytics',
      expect.objectContaining({ ownerEmail: 'agent@octanefuel.com' }),
    );
  });

  it('the roster is manager-only', async () => {
    deluge.mockResolvedValue({ data: [{ id: 'desk-1', email: 'a@b.c' }] });
    const denied = await app.inject({
      method: 'GET',
      url: '/v1/cs/analytics/roster',
      headers: bearer(await csAgent()),
    });
    expect(denied.statusCode).toBe(403);
    const allowed = await app.inject({
      method: 'GET',
      url: '/v1/cs/analytics/roster',
      headers: bearer(await csDirector()),
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().agents).toHaveLength(1);
  });

  it('/cs/context returns the backend manager verdict', async () => {
    deluge.mockResolvedValue({ data: [{ id: 'desk-9', email: 'agent@octanefuel.com' }] });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/cs/context',
      headers: bearer(await csAgent()),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ isManager: false, deskAgentId: 'desk-9', unmatched: false });
  });
});

describe('data center deal write', () => {
  it('updates only the billing allowlist, casing-resolved and audited', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/cs/data-center/deals/321',
      headers: bearer(await csAgent()),
      payload: { Payment_Type_Billing: 'LOC', Billing_Cycle: '1 Billing Cycle' },
    });
    expect(res.statusCode).toBe(200);
    expect(records.updateRecord).toHaveBeenCalledWith(
      'Deals',
      '321',
      expect.objectContaining({ Payment_Type_Billing: 'LOC' }),
    );
    expect(auditFromContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'cs.datacenter.deal_update' }),
    );
  });

  it('rejects fields outside the billing allowlist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/cs/data-center/deals/321',
      headers: bearer(await csAgent()),
      payload: { Amount: 999999 },
    });
    expect(res.statusCode).toBe(400);
    expect(records.updateRecord).not.toHaveBeenCalled();
  });
});
