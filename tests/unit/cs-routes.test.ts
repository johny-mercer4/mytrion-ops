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
vi.mock('../../src/integrations/zohoCrm.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/integrations/zohoCrm.js')>();
  return {
    ...mod,
    zohoCrm: Object.assign(Object.create(Object.getPrototypeOf(mod.zohoCrm)), mod.zohoCrm, {
      runCoql: vi.fn(async () => ({ rows: [], count: 0, moreRecords: false })),
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
// fetchCsEligibleRoster's two inputs — kept deterministic (real ones hit live Zoho CRM + the
// DB-backed access resolver, which `resolveWorkerAccess` for ctx-building already exercises for
// real elsewhere in this file; only the ROSTER needs a fixed, known set to assert against).
vi.mock('../../src/modules/auth/actAsDirectory.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/auth/actAsDirectory.js')>();
  return { ...mod, listActiveUsersCached: vi.fn(async () => []) };
});
vi.mock('../../src/modules/access/mytrionAccessService.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/access/mytrionAccessService.js')>();
  return {
    ...mod,
    mytrionAccessService: { ...mod.mytrionAccessService, resolveBatch: vi.fn(async () => new Map()) },
  };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { serverCrm } from '../../src/integrations/serverCrm.js';
import { executeZohoFunctionWithFallback } from '../../src/integrations/zohoFunctions.js';
import { zohoCrm } from '../../src/integrations/zohoCrm.js';
import { zohoCrmRecords } from '../../src/integrations/zohoCrmRecords.js';
import { auditFromContext } from '../../src/modules/audit/auditLogger.js';
import { listActiveUsersCached } from '../../src/modules/auth/actAsDirectory.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import { mytrionAccessService } from '../../src/modules/access/mytrionAccessService.js';
import { invalidateRosterCache } from '../../src/modules/customerService/csAnalyticsScope.js';
import type { MytrionId } from '../../src/lib/mytrions.js';
import { invalidateFieldCache } from '../../src/modules/customerService/fieldResolver.js';
import { getTouchpoint, listTouchpoints } from '../../src/modules/touchpoints/catalog/index.js';
import { canInvokeTouchpoint } from '../../src/modules/touchpoints/dispatcher.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

const records = vi.mocked(zohoCrmRecords, true);
const deluge = vi.mocked(executeZohoFunctionWithFallback);
const dwhGet = vi.mocked(serverCrm.get);
const activeUsers = vi.mocked(listActiveUsersCached);
const resolveBatch = vi.mocked(mytrionAccessService.resolveBatch);
const runCoql = vi.mocked(zohoCrm.runCoql);

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
    { api_name: 'First_Name' },
    { api_name: 'Last_Name' },
    { api_name: 'City' },
    { api_name: 'Zip_Code' },
    { api_name: 'Status_of_App', pick_list_values: [{ actual_value: 'In process' }] },
  ]);
  activeUsers.mockResolvedValue([]);
  resolveBatch.mockResolvedValue(new Map());
  runCoql.mockResolvedValue({ rows: [], count: 0, moreRecords: false });
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
    const keys = [
      'cs.home.metrics',
      'cs.applications.list',
      'cs.datacenter.deals',
      'cs.carrier.trucking_number_request',
    ];
    for (const key of keys) {
      const tp = getTouchpoint(key);
      expect(tp, key).toBeDefined();
      expect(tp?.departments).toEqual(['customer-service']);
      expect(tp?.riskClass).toBe('read');
    }
    expect(listTouchpoints().filter((t) => t.key.startsWith('cs.'))).toHaveLength(keys.length);
  });

  it('cs.applications.list is a local COQL handler, not Deluge — a revert would silently reintroduce the page-cap/no-pagination-on-search bugs', () => {
    expect(getTouchpoint('cs.applications.list')?.kind).toBe('local');
  });

  it('no longer exposes ANY Maintenance touchpoint — that data lives in our own table', () => {
    // `cs.analytics.maintenance` (mytrionGetMaintenanceAnalytics) and `maintenance.create`
    // (createmaintenance) were removed once maintenance_cases became the source of truth. The
    // dispatcher executes any catalog entry, so leaving either in place meant a caller or an agent
    // could still read stale Zoho figures — or, worse, WRITE a case Mytrion cannot see.
    expect(getTouchpoint('cs.analytics.maintenance')).toBeUndefined();
    expect(getTouchpoint('maintenance.create')).toBeUndefined();
    // `functionNames` only exists on the 'deluge' variant of the Touchpoint union, so narrow on kind
    // before reaching for it.
    const viaDeluge = listTouchpoints().flatMap((t) =>
      t.kind === 'deluge' && t.functionNames.some((f) => /maintenance/i.test(f)) ? [t.key] : [],
    );
    expect(viaDeluge, 'no touchpoint may call a Maintenance Deluge').toEqual([]);
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

describe('bulk card tracking (Clients tab Tracking # column)', () => {
  it('chunks carrier ids into one COQL call and maps Carrier_ID -> Fedex_Tracking', async () => {
    runCoql.mockResolvedValue({
      rows: [
        { Carrier_ID: 111, Fedex_Tracking: '1Z999' },
        { Carrier_ID: 222, Fedex_Tracking: '' },
      ],
      count: 2,
      moreRecords: false,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/cs/applications/tracking',
      headers: bearer(await csAgent()),
      payload: { carrierIds: ['111', '222', '333'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ tracking: { '111': '1Z999', '222': '' } });
    expect(runCoql).toHaveBeenCalledTimes(1);
    expect(runCoql).toHaveBeenCalledWith(expect.stringContaining('Carrier_ID in (111,222,333)'));
  });

  it('is gated the same as every other CS route (sales worker refused)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/cs/applications/tracking',
      headers: bearer(await salesAgent()),
      payload: { carrierIds: ['111'] },
    });
    expect(res.statusCode).toBe(403);
    expect(runCoql).not.toHaveBeenCalled();
  });
});

describe('applications save orchestration', () => {
  function fullRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: '123',
      // Required-fields hard block (QA feedback, Dina Carter 2026-08-07) needs these non-blank on
      // every fixture that isn't specifically testing the block itself — see the dedicated
      // 'required fields on save' describe block below.
      First_Name: 'Jane',
      Last_Name: 'Doe',
      City: 'Chicago',
      Zip_Code: '60612',
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

  describe('required fields on save (QA feedback, Dina Carter 2026-08-07)', () => {
    it('rejects the modal save when a required field is already blank on file, even though it was never touched', async () => {
      records.getRecord.mockResolvedValue(fullRecord({ City: '' }));
      const res = await app.inject({
        method: 'POST',
        url: '/v1/cs/applications/123',
        headers: bearer(await csAgent()),
        payload: { changes: { Customer_Service_Notes: 'called back' } },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.message).toContain('City');
      expect(records.updateRecord).not.toHaveBeenCalled();
    });

    it('rejects clearing a required field to blank in the same save', async () => {
      records.getRecord.mockResolvedValue(fullRecord());
      const res = await app.inject({
        method: 'POST',
        url: '/v1/cs/applications/123',
        headers: bearer(await csAgent()),
        payload: { changes: { First_Name: '' } },
      });
      expect(res.statusCode).toBe(400);
      expect(records.updateRecord).not.toHaveBeenCalled();
    });

    it('allows the save once the missing field is filled in the same request', async () => {
      records.getRecord.mockResolvedValue(fullRecord({ Zip_Code: '' }));
      const res = await app.inject({
        method: 'POST',
        url: '/v1/cs/applications/123',
        headers: bearer(await csAgent()),
        payload: { changes: { Zip_Code: '60612' } },
      });
      expect(res.statusCode).toBe(200);
      expect(records.updateRecord).toHaveBeenCalled();
    });

    it('onboarding tick-box toggles are NOT blocked by an incomplete profile', async () => {
      records.getRecord.mockResolvedValue(fullRecord({ First_Name: '', Last_Name: '' }));
      const res = await app.inject({
        method: 'POST',
        url: '/v1/cs/applications/123/onboarding',
        headers: bearer(await csAgent()),
        payload: { field: 'TA_EFS_Added', value: true },
      });
      expect(res.statusCode).toBe(200);
      expect(records.updateRecord).toHaveBeenCalled();
    });
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

  it('the roster is manager-only, and scoped to admin-granted CS access, not Desk department membership', async () => {
    // Desk reports ALL THREE as CS-department agents (e.g. cross-assigned for ticket overflow) —
    // the regression this guards (QA 2026-08-07, two rounds):
    //  - round 1: a Verification agent (Cooper Rodrigo) showed up because the roster trusted Desk
    //    department tags instead of actual admin-granted access.
    //  - round 2: switching to admin-granted access alone let TWO IT admins (Islombek Mamurov,
    //    Amir Alimov — real names from the report) through, because combineAccess expands an
    //    all-department grant's accessibleMytrions to literally every Mytrion id, "customer-service"
    //    included. Being allowed to SEE CS data (correct, for an admin) isn't the same as WORKING
    //    CS tickets (what the leaderboard means to show).
    deluge.mockResolvedValue({
      data: [
        { id: 'desk-1', email: 'true-cs@octanefuel.com' },
        { id: 'desk-2', email: 'verification-overflow@octanefuel.com' },
        { id: 'desk-3', email: 'it-admin@octanefuel.com' },
      ],
    });
    activeUsers.mockResolvedValue([
      {
        zohoUserId: '101',
        name: 'True CS',
        email: 'true-cs@octanefuel.com',
        profile: 'Standard Plus',
        role: 'Customer Service Agent',
        isOnline: false,
      },
      {
        zohoUserId: '102',
        name: 'Cooper Rodrigo',
        email: 'verification-overflow@octanefuel.com',
        profile: 'Standard Plus',
        role: 'Verification Agent',
        isOnline: false,
      },
      {
        zohoUserId: '103',
        name: 'Islombek Mamurov',
        email: 'it-admin@octanefuel.com',
        profile: 'Administrator',
        role: 'Zoho Admin',
        isOnline: false,
      },
    ]);
    const access = (mytrions: MytrionId[], allDepartmentAccess = false) => ({
      accessibleMytrions: mytrions,
      homeMytrion: null,
      allDepartmentAccess,
      departments: allDepartmentAccess ? [] : mytrions,
      viewAsUserIds: [],
      mytrionAccessModes: {},
      mytrionTabGrants: {},
    });
    resolveBatch.mockResolvedValue(
      new Map([
        ['101', access(['customer-service'])],
        ['102', access(['verification'])],
        // Mirrors combineAccess's real behavior for a marker-admin: every Mytrion id, including
        // customer-service, plus allDepartmentAccess: true.
        ['103', access(['sales', 'billing', 'customer-service', 'verification'], true)],
      ]),
    );

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
    const agents = allowed.json().agents;
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({ id: 'desk-1', email: 'true-cs@octanefuel.com' });
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
