/**
 * /v1/admin/audit, /v1/admin/automation-logs and /v1/audit/mytrion-access.
 *
 * These pin the query→filter mapping the new Admin filters depend on (agent name, profile, role,
 * date window, exact action list) and the two access rules that differ across the module: the read
 * feeds are admin-only, while the Mytrion-access WRITE is open to any authenticated worker because
 * every worker records their own entry.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
  process.env.FF_AUDIT_LOG_ENABLED = '1';
});

const auditMocks = vi.hoisted(() => ({
  list: vi.fn(),
  count: vi.fn(),
  facets: vi.fn(),
  insert: vi.fn(),
  existsSince: vi.fn(),
}));
const automationMocks = vi.hoisted(() => ({
  list: vi.fn(),
  count: vi.fn(),
  facets: vi.fn(),
  insert: vi.fn(),
}));

vi.mock('../../src/repos/auditRepo.js', () => ({
  auditRepo: auditMocks,
  AUDIT_EXPORT_MAX: 10_000,
}));
vi.mock('../../src/repos/automationLogRepo.js', () => ({
  automationLogRepo: automationMocks,
  AUTOMATION_EXPORT_MAX: 10_000,
}));

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import { mytrionAccessService } from '../../src/modules/access/mytrionAccessService.js';
import { resetSessionEventCache } from '../../src/modules/audit/sessionEvents.js';

let app: FastifyInstance;

/**
 * Control what the caller is GRANTED, because that is what decides `ok` vs `denied` on a
 * Mytrion-access row — and only `ok` is ever collapsed.
 */
function grant(mytrions: string[]): void {
  vi.spyOn(mytrionAccessService, 'resolveWorkerAccess').mockResolvedValue({
    accessibleMytrions: mytrions,
    allDepartmentAccess: false,
    departments: [],
    homeMytrion: mytrions[0] ?? null,
    mytrionAccessModes: {},
    viewAsUserIds: [],
    mytrionTabGrants: {},
  } as unknown as Awaited<ReturnType<typeof mytrionAccessService.resolveWorkerAccess>>);
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.restoreAllMocks();
  resetSessionEventCache();
  auditMocks.list.mockReset().mockResolvedValue([]);
  auditMocks.count.mockReset().mockResolvedValue(0);
  auditMocks.facets.mockReset().mockResolvedValue({
    userNames: ['Amir Alimov'],
    profiles: ['Sales Agent'],
    roles: ['worker'],
    callerRoles: ['Uzbekistan Sales Agent'],
    actions: ['auth.zoho.login'],
  });
  auditMocks.insert.mockReset().mockResolvedValue(undefined);
  auditMocks.existsSince.mockReset().mockResolvedValue(false);
  automationMocks.list.mockReset().mockResolvedValue([]);
  automationMocks.count.mockReset().mockResolvedValue(0);
  automationMocks.facets.mockReset().mockResolvedValue({
    automationTypes: ['balance_check'],
    agentNames: ['Amir Alimov'],
    originSources: ['Mytrion Horizon'],
  });
});

async function bearer(over: Record<string, unknown> = {}): Promise<string> {
  const token = await signAccessToken({
    userId: 'zoho:admin-1',
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin',
    worker: { zohoUserId: 'admin-1', userName: 'Ops Admin', profile: 'Administrator' },
    ...over,
  });
  return `Bearer ${token}`;
}

/** A session whose internal role is not admin — the read feeds must refuse it. */
async function viewerBearer(): Promise<string> {
  const token = await signAccessToken({
    userId: 'zoho:viewer-1',
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'viewer',
    worker: { zohoUserId: 'viewer-1', userName: 'Read Only', profile: 'Standard' },
  });
  return `Bearer ${token}`;
}

describe('GET /v1/admin/audit', () => {
  it('maps every filter onto the repo call', async () => {
    const response = await app.inject({
      method: 'GET',
      url:
        '/v1/admin/audit?user_name=Amir%20Alimov&profile=Sales%20Agent&role=worker' +
        '&caller_role=Uzbekistan%20Sales%20Agent&status=ok&audience=internal' +
        '&search=acme&from=2026-08-01T00:00:00.000Z&to=2026-08-14T23:59:59.999Z&limit=25',
      headers: { authorization: await bearer() },
    });

    expect(response.statusCode).toBe(200);
    const filter = auditMocks.list.mock.calls[0]![1];
    expect(filter).toMatchObject({
      userName: 'Amir Alimov',
      profile: 'Sales Agent',
      role: 'worker',
      callerRole: 'Uzbekistan Sales Agent',
      status: 'ok',
      audience: 'internal',
      search: 'acme',
      limit: 25,
    });
    expect(filter.from).toBeInstanceOf(Date);
    expect(filter.to).toBeInstanceOf(Date);
    expect(filter.source).toBe('human');
  });

  it('defaults the Audit Log to human actors and keeps Vitest fixtures off that feed', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/audit',
      headers: { authorization: await bearer() },
    });
    expect(response.statusCode).toBe(200);
    expect(auditMocks.list.mock.calls[0]![1]).toMatchObject({ source: 'human' });
  });

  it('the Vitest Logs tab asks only for fixture actors', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/audit?source=vitest',
      headers: { authorization: await bearer() },
    });
    expect(response.statusCode).toBe(200);
    expect(auditMocks.list.mock.calls[0]![1]).toMatchObject({ source: 'vitest' });
  });

  it('accepts the Logins view as an EXACT action list, not a prefix', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/audit?actions=auth.login,auth.zoho.login,mini_app.auth.login',
      headers: { authorization: await bearer() },
    });

    expect(response.statusCode).toBe(200);
    expect(auditMocks.list.mock.calls[0]![1]).toMatchObject({
      actions: ['auth.login', 'auth.zoho.login', 'mini_app.auth.login'],
    });
    // The prefix filter must NOT also be set — `auth.` would drag act_as back in.
    expect(auditMocks.list.mock.calls[0]![1].action).toBeUndefined();
  });

  it('allows an export-sized page', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/audit?limit=10000',
      headers: { authorization: await bearer() },
    });
    expect(response.statusCode).toBe(200);
    expect(auditMocks.list.mock.calls[0]![1]).toMatchObject({ limit: 10_000 });
  });

  it('never leaks tenant_id onto the wire', async () => {
    auditMocks.list.mockResolvedValue([
      {
        id: 'a1',
        tenantId: 'octane',
        action: 'auth.zoho.login',
        status: 'ok',
        createdAt: new Date(),
      },
    ]);
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/audit',
      headers: { authorization: await bearer() },
    });

    const body = response.json() as { entries: Array<Record<string, unknown>> };
    expect(body.entries[0]).not.toHaveProperty('tenantId');
    expect(body.entries[0]).toMatchObject({ action: 'auth.zoho.login' });
  });

  it('refuses a non-admin session', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/audit',
      headers: { authorization: await viewerBearer() },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('GET /v1/admin/audit/facets', () => {
  it('returns the dropdown option lists plus the login action set', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/audit/facets',
      headers: { authorization: await bearer() },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      userNames: ['Amir Alimov'],
      profiles: ['Sales Agent'],
      loginActions: ['auth.login', 'auth.zoho.login', 'mini_app.auth.login'],
    });
  });
});

describe('GET /v1/admin/automation-logs', () => {
  it('maps the origin-source filter', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/automation-logs?origin_source=Mytrion%20Horizon&agent_name=Amir%20Alimov',
      headers: { authorization: await bearer() },
    });

    expect(response.statusCode).toBe(200);
    expect(automationMocks.list.mock.calls[0]![1]).toMatchObject({
      originSource: 'Mytrion Horizon',
      agentName: 'Amir Alimov',
    });
  });

  it('rejects an origin outside the picklist', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/automation-logs?origin_source=Mytrion%20Salesforce',
      headers: { authorization: await bearer() },
    });
    expect(response.statusCode).toBe(400);
  });

  it('refuses a non-admin session', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/automation-logs',
      headers: { authorization: await viewerBearer() },
    });
    expect(response.statusCode).toBe(403);
  });

  /**
   * Code running ahead of its migration is the realistic way to meet this endpoint failing — a
   * backend pointed at a database that has not had 0118 applied. It must say so, not 500.
   */
  it('answers 503 with the migration name when origin_source is missing', async () => {
    const undefinedColumn = Object.assign(
      new Error('Failed query: select ... from "automation_logs"'),
      {
        cause: Object.assign(new Error('column "origin_source" does not exist'), { code: '42703' }),
      },
    );
    automationMocks.list.mockRejectedValueOnce(undefinedColumn);
    automationMocks.count.mockResolvedValueOnce(0);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/automation-logs',
      headers: { authorization: await bearer() },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: { code: 'AUTOMATION_LOGS_NOT_READY' },
    });
    expect((response.json() as { error: { message: string } }).error.message).toContain('0118');
  });

  it('answers 503 on the facets route too', async () => {
    automationMocks.facets.mockRejectedValueOnce(
      Object.assign(new Error('Failed query: select distinct ... from "automation_logs"'), {
        cause: Object.assign(new Error('column "origin_source" does not exist'), { code: '42703' }),
      }),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/automation-logs/facets',
      headers: { authorization: await bearer() },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: 'AUTOMATION_LOGS_NOT_READY' } });
  });

  it('does not swallow an unrelated failure as a readiness problem', async () => {
    // Deliberately NOT a connection error: those already map to 503 DB_UNAVAILABLE centrally
    // (errorHandler → isTransientDbError), which would make this assertion pass for the wrong
    // reason. A plain programming fault must still surface as a 500.
    automationMocks.list.mockRejectedValueOnce(new TypeError('cannot read properties of undefined'));
    automationMocks.count.mockResolvedValueOnce(0);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/automation-logs',
      headers: { authorization: await bearer() },
    });

    expect(response.statusCode).toBe(500);
    expect(JSON.stringify(response.json())).not.toContain('AUTOMATION_LOGS_NOT_READY');
  });

  it('leaves a 42703 against ANOTHER table alone', async () => {
    // isMissingColumn is scoped per table because Postgres does not name the table in an
    // undefined-column message — the match relies on Drizzle's outer "Failed query" text.
    automationMocks.list.mockRejectedValueOnce(
      Object.assign(new Error('Failed query: select ... from "audit_log"'), {
        cause: Object.assign(new Error('column "nope" does not exist'), { code: '42703' }),
      }),
    );
    automationMocks.count.mockResolvedValueOnce(0);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/automation-logs',
      headers: { authorization: await bearer() },
    });

    expect(JSON.stringify(response.json())).not.toContain('AUTOMATION_LOGS_NOT_READY');
  });
});

describe('POST /v1/audit/mytrion-access', () => {
  it('records an entry for an ordinary (non-admin) worker', async () => {
    grant(['sales']);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/audit/mytrion-access',
      headers: { authorization: await viewerBearer() },
      payload: { mytrion: 'sales' },
    });

    // Open to every worker on purpose — each one writes their own row.
    expect(response.statusCode).toBe(200);
    expect(auditMocks.insert).toHaveBeenCalledTimes(1);
    expect(auditMocks.insert.mock.calls[0]![0]).toMatchObject({
      action: 'mytrion.access',
      resourceType: 'mytrion',
      resourceId: 'sales',
      status: 'ok',
      userId: 'zoho:viewer-1',
    });
  });

  it('collapses a repeat entry into the open session window', async () => {
    grant(['sales']);
    const authorization = await viewerBearer();
    const first = await app.inject({
      method: 'POST',
      url: '/v1/audit/mytrion-access',
      headers: { authorization },
      payload: { mytrion: 'sales' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/v1/audit/mytrion-access',
      headers: { authorization },
      payload: { mytrion: 'sales' },
    });

    expect(first.json()).toMatchObject({ logged: true });
    expect(second.json()).toMatchObject({ logged: false });
    expect(auditMocks.insert).toHaveBeenCalledTimes(1);
  });

  it('still records a DIFFERENT Mytrion in the same session', async () => {
    grant(['sales', 'hr']);
    const authorization = await viewerBearer();
    await app.inject({
      method: 'POST',
      url: '/v1/audit/mytrion-access',
      headers: { authorization },
      payload: { mytrion: 'sales' },
    });
    await app.inject({
      method: 'POST',
      url: '/v1/audit/mytrion-access',
      headers: { authorization },
      payload: { mytrion: 'hr' },
    });
    expect(auditMocks.insert).toHaveBeenCalledTimes(2);
  });

  /**
   * The claim is the ONE thing a caller controls, so a Mytrion they are not granted is recorded as
   * `denied` — and denied is never collapsed, so a probe cannot hide inside a session window.
   */
  it('records an ungranted claim as denied, every single time', async () => {
    grant(['sales']);
    const authorization = await viewerBearer();
    for (let i = 0; i < 3; i += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/audit/mytrion-access',
        headers: { authorization },
        payload: { mytrion: 'finance' },
      });
      expect(response.json()).toMatchObject({ logged: true });
    }

    expect(auditMocks.insert).toHaveBeenCalledTimes(3);
    expect(auditMocks.insert.mock.calls[0]![0]).toMatchObject({
      action: 'mytrion.access',
      status: 'denied',
      resourceId: 'finance',
    });
  });

  it('rejects a Mytrion id that does not exist', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/audit/mytrion-access',
      headers: { authorization: await viewerBearer() },
      payload: { mytrion: 'not-a-mytrion' },
    });
    expect(response.statusCode).toBe(400);
    expect(auditMocks.insert).not.toHaveBeenCalled();
  });

  it('requires a session', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/audit/mytrion-access',
      payload: { mytrion: 'sales' },
    });
    expect(response.statusCode).toBe(401);
  });
});
