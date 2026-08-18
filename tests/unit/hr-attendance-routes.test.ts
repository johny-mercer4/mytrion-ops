/**
 * Attendance webhook auth + admin shift gate.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
  process.env.HR_ATTENDANCE_WEBHOOK_SECRET = 'att-test-secret';
});

// Params spelled out so `mock.calls[n][6]` is a reachable tuple element, not `never`.
const { teamListMock } = vi.hoisted(() => ({
  teamListMock: vi.fn(async (
    _ctx: unknown,
    _selfId: string,
    _from: string,
    _to: string,
    _scope: string,
    _q: string,
    _options?: { withTotals?: boolean },
  ) => ({
    from: '2026-08-03',
    to: '2026-08-09',
    scope: 'all',
    canViewAll: true,
    counts: { direct: 0, all: 0 },
    unmappedPunches: 0,
    items: [],
  })),
}));

const { syncMock } = vi.hoisted(() => ({
  syncMock: vi.fn(async (_ctx: unknown, from: string, to: string) => ({
    from,
    to,
    fetched: 0,
    inserted: 0,
    linked: 0,
    skipped: 0,
    cached: false,
  })),
}));

vi.mock('../../src/modules/hr/attendance/ingestWebhook.js', () => ({
  ingestAttendanceWebhook: vi.fn(async () => ({
    success: 1,
    failed: 0,
    skipped: 0,
    errors: [],
  })),
}));

vi.mock('../../src/repos/hrAttendanceShiftRepo.js', () => ({
  hrAttendanceShiftRepo: {
    list: vi.fn(async () => []),
    getById: vi.fn(async () => undefined),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    assign: vi.fn(),
    assignmentForDate: vi.fn(),
    assignmentsForEmployeesDate: vi.fn(async () => new Map()),
    listAssignmentsForShift: vi.fn(async () => []),
  },
}));

vi.mock('../../src/repos/hrAttendancePunchRepo.js', () => ({
  hrAttendancePunchRepo: {
    listRange: vi.fn(async () => []),
    listForEmployeesRange: vi.fn(async () => []),
    lastForEmployees: vi.fn(async () => new Map()),
    countUnmappedRange: vi.fn(async () => 0),
    // Assigning a shift now rebuckets the work dates it invalidates.
    rebucketWorkDates: vi.fn(async () => undefined),
  },
}));

vi.mock('../../src/repos/hrEmployeeRepo.js', () => ({
  hrEmployeeRepo: {
    findByZohoUserId: vi.fn(async () => undefined),
    getById: vi.fn(async () => undefined),
    listByReportingTo: vi.fn(async () => []),
    listByDepartmentIds: vi.fn(async () => []),
    list: vi.fn(async () => []),
    count: vi.fn(async () => 0),
  },
}));

vi.mock('../../src/repos/hrDepartmentRepo.js', () => ({
  hrDepartmentRepo: {
    listIdsLedBy: vi.fn(async () => []),
  },
}));

vi.mock('../../src/modules/hr/attendance/teamSummary.js', () => ({
  buildAttendanceTeamList: teamListMock,
}));

vi.mock('../../src/modules/hr/attendance/syncFromDwh.js', async (importOriginal) => {
  // Real module except for the DWH round trip, so the route's own validation (window cap, ordering)
  // is exercised rather than stubbed past.
  const mod =
    await importOriginal<typeof import('../../src/modules/hr/attendance/syncFromDwh.js')>();
  return { ...mod, syncAttendanceFromDwh: syncMock };
});

vi.mock('../../src/modules/hr/attendance/summary.js', () => ({
  buildAttendanceSummary: vi.fn(async (_ctx, employeeId: string, from: string, to: string) => ({
    employeeId,
    from,
    to,
    shift: null,
    days: [],
    totals: {
      payableDays: 0,
      present: 0,
      weekend: 0,
      absent: 0,
      onDuty: 0,
      paidLeave: 0,
      holidays: 0,
    },
    lastPunch: null,
  })),
  summaryToCsv: vi.fn(() => 'csv'),
}));

vi.mock('../../src/modules/audit/auditLogger.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/audit/auditLogger.js')>();
  return { ...mod, audit: vi.fn(async () => undefined), auditFromContext: vi.fn(async () => undefined) };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { ingestAttendanceWebhook } from '../../src/modules/hr/attendance/ingestWebhook.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import { hrAttendancePunchRepo } from '../../src/repos/hrAttendancePunchRepo.js';
import { hrAttendanceShiftRepo } from '../../src/repos/hrAttendanceShiftRepo.js';
import { hrDepartmentRepo } from '../../src/repos/hrDepartmentRepo.js';
import { hrEmployeeRepo } from '../../src/repos/hrEmployeeRepo.js';

const ingest = vi.mocked(ingestAttendanceWebhook);
const shifts = vi.mocked(hrAttendanceShiftRepo);
const punches = vi.mocked(hrAttendancePunchRepo);
const employees = vi.mocked(hrEmployeeRepo);
const depts = vi.mocked(hrDepartmentRepo);

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

async function workerToken(profile: string): Promise<string> {
  return signAccessToken({
    userId: 'zoho:42',
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin',
    worker: { zohoUserId: '42', userName: 'Test Worker', profile },
  });
}

const bearer = (t: string): Record<string, string> => ({ authorization: `Bearer ${t}` });

describe('HR attendance My Data (self)', () => {
  it('pulls the caller’s own punches before reading, so My Data is current without a manual Refresh', async () => {
    employees.findByZohoUserId.mockResolvedValue({ id: 'hre_self' } as never);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/hr/attendance/me?weekOf=2026-08-05',
      headers: bearer(await workerToken('Field Agent')),
    });
    expect(res.statusCode).toBe(200);
    // Scoped to ONE person (their id in the options) — never the whole-window sweep the page load avoids.
    expect(syncMock).toHaveBeenCalledWith(expect.anything(), '2026-08-03', '2026-08-09', {
      employeeId: 'hre_self',
    });
    expect(res.json()).toMatchObject({ employeeId: 'hre_self', from: '2026-08-03', to: '2026-08-09' });
  });

  it('still serves stored attendance when the warehouse pull fails', async () => {
    employees.findByZohoUserId.mockResolvedValue({ id: 'hre_self' } as never);
    syncMock.mockRejectedValueOnce(new Error('DWH busy'));
    const res = await app.inject({
      method: 'GET',
      url: '/v1/hr/attendance/me?weekOf=2026-08-05',
      headers: bearer(await workerToken('Field Agent')),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ employeeId: 'hre_self' });
  });
});

describe('HR attendance webhook', () => {
  it('rejects missing secret', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/hr/attendance/webhook',
      payload: { empCode: '1', door_name: 'entry', event_date_time: '2026-07-29 19:00:00' },
    });
    expect(res.statusCode).toBe(401);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('accepts valid secret and ingests', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/hr/attendance/webhook',
      headers: { 'x-attendance-webhook-secret': 'att-test-secret' },
      payload: { empCode: '0001', door_name: 'Main Entry', event_date_time: '2026-07-29 19:00:00' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: true, stats: { success: 1 } });
    expect(ingest).toHaveBeenCalledOnce();
  });
});

describe('HR attendance shifts', () => {
  it('POST refuses a non-admin HR reader', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/hr/attendance/shifts',
      headers: bearer(await workerToken('HR Manager')),
      payload: { name: 'Day', startLocal: '09:00', endLocal: '18:00' },
    });
    expect(res.statusCode).toBe(403);
    expect(shifts.create).not.toHaveBeenCalled();
  });

  it('POST allows Administrator', async () => {
    shifts.create.mockResolvedValueOnce({
      id: 'hrs_1',
      tenantId: DEFAULT_TENANT_ID,
      name: 'UZB Main',
      timezone: 'Asia/Tashkent',
      startLocal: '19:00',
      endLocal: '03:00',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/hr/attendance/shifts',
      headers: bearer(await workerToken('Administrator')),
      payload: {
        name: 'UZB Main',
        startLocal: '19:00',
        endLocal: '03:00',
        timezone: 'Asia/Tashkent',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(shifts.create).toHaveBeenCalled();
    expect(res.json()).toMatchObject({ name: 'UZB Main' });
  });

  /**
   * DELIBERATE POLICY CHANGE. This asserted 403 — export was Mytrion-Admin only.
   *
   * That was incoherent rather than strict: an HR Manager can already read any employee's week on
   * screen through `/hr/attendance/summary`, so refusing them the CSV of the same data protected
   * nothing and only pushed people to screenshot it. Export now answers to the SAME per-employee rule
   * as the panel — which is also what lets a team lead export their own team and nobody else's (see
   * "team lead attendance access" below).
   *
   * The old test also passed no `employeeId`, so after the gate opened it failed on validation (400)
   * rather than on permission — it could not have told the two apart.
   */
  it('GET export now answers to the same rule as the on-screen summary', async () => {
    const target = { id: 'hre_x', firstName: 'Any', lastName: 'Body' };
    employees.getById.mockResolvedValue(target as never);
    employees.findByZohoUserId.mockResolvedValue({ id: 'hre_self' } as never);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/hr/attendance/export?from=2026-07-01&to=2026-07-07&employeeId=hre_x',
      headers: bearer(await workerToken('HR Manager')),
    });
    // An HR Manager holds org-wide attendance view, so the CSV is data they can already read.
    expect(res.statusCode).toBe(200);
  });

  it('GET export still requires an employee — it is never a company-wide dump', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/hr/attendance/export?from=2026-07-01&to=2026-07-07',
      headers: bearer(await workerToken('HR Manager')),
    });
    expect(res.statusCode).toBe(400);
  });

  it('allows a department manager to assign a shift to a direct report', async () => {
    const self = {
      id: 'hre_manager',
      tenantId: DEFAULT_TENANT_ID,
      firstName: 'Department',
      lastName: 'Manager',
    };
    const target = {
      id: 'hre_report',
      tenantId: DEFAULT_TENANT_ID,
      firstName: 'Direct',
      lastName: 'Report',
    };
    employees.findByZohoUserId.mockResolvedValueOnce(self as never);
    employees.getById.mockResolvedValueOnce(target as never);
    employees.listByReportingTo.mockResolvedValueOnce([target] as never);
    employees.listByDepartmentIds.mockResolvedValueOnce([]);
    shifts.getById.mockResolvedValueOnce({
      id: 'hrs_ganga',
      tenantId: DEFAULT_TENANT_ID,
      name: 'UZB Tashkent · Ganga',
      timezone: 'Asia/Tashkent',
      startLocal: '19:00',
      endLocal: '03:00',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    shifts.assign.mockResolvedValueOnce({ id: 'hrsa_1' } as never);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/hr/attendance/shifts/hrs_ganga/assign',
      headers: bearer(await workerToken('HR Staff')),
      payload: {
        employeeIds: ['hre_report'],
        effectiveFrom: '2026-07-30',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ assigned: ['hre_report'] });
    /**
     * Assigning a shift retroactively changes which DAY an overnight punch belongs to, so the route has
     * to rebucket the rows already stored — the same repair the punch-link paths already run.
     */
    expect(punches.rebucketWorkDates).toHaveBeenCalledWith(expect.anything(), 'hre_report');
    expect(shifts.assign).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ shiftId: 'hrs_ganga', employeeId: 'hre_report' }),
    );
  });

  it('refuses a department manager assigning someone outside their team', async () => {
    employees.findByZohoUserId.mockResolvedValueOnce({
      id: 'hre_manager',
      tenantId: DEFAULT_TENANT_ID,
    } as never);
    employees.getById.mockResolvedValueOnce({
      id: 'hre_outsider',
      tenantId: DEFAULT_TENANT_ID,
    } as never);
    employees.listByReportingTo.mockResolvedValueOnce([]);
    employees.listByDepartmentIds.mockResolvedValueOnce([]);
    shifts.getById.mockResolvedValueOnce({
      id: 'hrs_ganga',
      tenantId: DEFAULT_TENANT_ID,
      name: 'UZB Tashkent · Ganga',
      timezone: 'Asia/Tashkent',
      startLocal: '19:00',
      endLocal: '03:00',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/hr/attendance/shifts/hrs_ganga/assign',
      headers: bearer(await workerToken('HR Staff')),
      payload: {
        employeeIds: ['hre_outsider'],
        effectiveFrom: '2026-07-30',
      },
    });

    expect(res.statusCode).toBe(403);
    expect(shifts.assign).not.toHaveBeenCalled();
  });
});

describe('HR attendance team visibility', () => {
  it('GET team requires a linked employee for a regular HR reader', async () => {
    employees.findByZohoUserId.mockResolvedValueOnce(undefined);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/hr/attendance/team?weekOf=2026-07-27&scope=direct',
      headers: bearer(await workerToken('HR Staff')),
    });
    expect(res.statusCode).toBe(404);
  });

  it('lets an unlinked HR Manager open the organization attendance directory', async () => {
    employees.findByZohoUserId.mockResolvedValueOnce(undefined);
    employees.listByReportingTo.mockResolvedValueOnce([]);
    employees.listByDepartmentIds.mockResolvedValueOnce([]);
    employees.list.mockResolvedValueOnce([]);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/hr/attendance/team?weekOf=2026-07-27&scope=all',
      headers: bearer(await workerToken('HR Manager')),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      scope: 'all',
      canViewAll: true,
      items: [],
    });
  });

  it('GET summary refuses outsider for a non-HR-Manager', async () => {
    employees.findByZohoUserId.mockResolvedValue({
      id: 'hre_me',
      tenantId: DEFAULT_TENANT_ID,
      firstName: 'Me',
      lastName: 'Self',
    } as never);
    employees.getById.mockResolvedValue({
      id: 'hre_x',
      tenantId: DEFAULT_TENANT_ID,
      firstName: 'Other',
      lastName: 'Person',
    } as never);
    employees.listByReportingTo.mockResolvedValue([]);
    employees.listByDepartmentIds.mockResolvedValue([]);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/hr/attendance/summary?from=2026-07-27&to=2026-08-02&employeeId=hre_x',
      // Sales Manager has HR dept access in tests only if profile contains hr — use a
      // profile that gets hr via "HR" substring but is not "HR Manager".
      headers: bearer(await workerToken('HR Staff')),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('HR attendance DWH sync', () => {
  it('refuses a caller without HR access — it writes to the punch table', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/hr/attendance/sync',
      headers: bearer(await workerToken('Sales Rep')),
      payload: { from: '2026-08-03', to: '2026-08-07' },
    });
    expect(res.statusCode).toBe(403);
    expect(syncMock).not.toHaveBeenCalled();
  });

  it('refuses an unauthenticated caller', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/hr/attendance/sync', payload: {} });
    expect(res.statusCode).toBe(401);
    expect(syncMock).not.toHaveBeenCalled();
  });

  it('syncs the requested window for an HR reader', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/hr/attendance/sync',
      headers: bearer(await workerToken('HR Manager')),
      payload: { from: '2026-08-03', to: '2026-08-07' },
    });
    expect(res.statusCode).toBe(200);
    expect(syncMock).toHaveBeenCalledWith(expect.anything(), '2026-08-03', '2026-08-07', {
      force: false,
    });
  });

  it('defaults to the week around `weekOf` so the page need not compute it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/hr/attendance/sync',
      headers: bearer(await workerToken('HR Manager')),
      payload: { weekOf: '2026-08-05' },
    });
    expect(res.statusCode).toBe(200);
    const [, from, to] = syncMock.mock.calls[0] ?? [];
    expect(from).toBe('2026-08-03');
    expect(to).toBe('2026-08-09');
  });

  it('passes `force` through, so Refresh is not answered from the cooldown', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/hr/attendance/sync',
      headers: bearer(await workerToken('HR Manager')),
      payload: { from: '2026-08-03', to: '2026-08-07', force: true },
    });
    expect(syncMock).toHaveBeenCalledWith(expect.anything(), '2026-08-03', '2026-08-07', {
      force: true,
    });
  });

  /** A year-wide window is 387k rows off a shared analytics DB — rejected before it is attempted. */
  it('rejects a window beyond the cap without calling the DWH', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/hr/attendance/sync',
      headers: bearer(await workerToken('HR Manager')),
      payload: { from: '2026-01-01', to: '2026-12-31' },
    });
    expect(res.statusCode).toBe(400);
    expect(syncMock).not.toHaveBeenCalled();
  });
});

describe('roster fetches a directory by default', () => {
  it('passes withTotals:false through when the page asks for ?totals=0', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/hr/attendance/team?scope=all&totals=0&from=2026-08-03&to=2026-08-09',
      headers: bearer(await workerToken('HR Manager')),
    });
    expect(res.statusCode).toBe(200);
    expect(teamListMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      '2026-08-03',
      '2026-08-09',
      'all',
      '',
      { withTotals: false },
    );
  });

  it('keeps totals for a caller that does not opt out', async () => {
    await app.inject({
      method: 'GET',
      url: '/v1/hr/attendance/team?scope=all&from=2026-08-03&to=2026-08-09',
      headers: bearer(await workerToken('HR Manager')),
    });
    expect(teamListMock.mock.calls[0]?.[6]).toEqual({ withTotals: true });
  });
});

/**
 * Team leads can read their own team's attendance without HR access.
 *
 * This WIDENS who reaches these routes, so what follows is mostly about what a team lead still cannot
 * do. Two invariants carry it: membership is proven from reporting lines in the database (not a header,
 * not an unverified Zoho profile string), and the gate does not decide what is returned — the scoping
 * does.
 */
describe('team lead attendance access', () => {
  /** A sales team lead: no `hr` department, one direct report. */
  const LEAD = { id: 'hre_lead', firstName: 'Lead', lastName: 'Person' };
  const REPORT = { id: 'hre_report', firstName: 'Their', lastName: 'Report' };
  const OUTSIDER = { id: 'hre_outsider', firstName: 'Someone', lastName: 'Else' };

  function beALead(): void {
    employees.findByZohoUserId.mockResolvedValue(LEAD as never);
    employees.getById.mockImplementation((async (_ctx: unknown, id: string) =>
      [LEAD, REPORT, OUTSIDER].find((e) => e.id === id)) as never);
    employees.listByReportingTo.mockResolvedValue([REPORT] as never);
    employees.listByDepartmentIds.mockResolvedValue([] as never);
    depts.listIdsLedBy.mockResolvedValue([] as never);
  }

  function beNobodysManager(): void {
    beALead();
    employees.listByReportingTo.mockResolvedValue([] as never);
  }

  it('lets a team lead open the attendance roster', async () => {
    beALead();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/hr/attendance/team?scope=all',
      headers: bearer(await workerToken('Sales Rep')),
    });
    expect(res.statusCode).toBe(200);
  });

  /** The gate's whole point: managing someone is a fact about the data, not a claim. */
  it('refuses a worker who manages nobody', async () => {
    beNobodysManager();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/hr/attendance/team?scope=all',
      headers: bearer(await workerToken('Sales Rep')),
    });
    expect(res.statusCode).toBe(403);
  });

  it('lets a team lead read their own report’s week', async () => {
    beALead();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/hr/attendance/summary?from=2026-08-03&to=2026-08-09&employeeId=${REPORT.id}`,
      headers: bearer(await workerToken('Sales Rep')),
    });
    expect(res.statusCode).toBe(200);
  });

  it('refuses a team lead reading someone outside their team', async () => {
    beALead();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/hr/attendance/summary?from=2026-08-03&to=2026-08-09&employeeId=${OUTSIDER.id}`,
      headers: bearer(await workerToken('Sales Rep')),
    });
    expect(res.statusCode).toBe(403);
  });

  /** A CSV is the same data as the panel, so it must answer to the same rule, not a coarser one. */
  it('scopes the CSV export to their team', async () => {
    beALead();
    const ok = await app.inject({
      method: 'GET',
      url: `/v1/hr/attendance/export?from=2026-08-03&to=2026-08-09&employeeId=${REPORT.id}`,
      headers: bearer(await workerToken('Sales Rep')),
    });
    expect(ok.statusCode).toBe(200);

    const denied = await app.inject({
      method: 'GET',
      url: `/v1/hr/attendance/export?from=2026-08-03&to=2026-08-09&employeeId=${OUTSIDER.id}`,
      headers: bearer(await workerToken('Sales Rep')),
    });
    expect(denied.statusCode).toBe(403);
  });

  it('refuses a team lead syncing someone outside their team', async () => {
    beALead();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/hr/attendance/sync',
      headers: bearer(await workerToken('Sales Rep')),
      payload: { from: '2026-08-03', to: '2026-08-09', employeeId: OUTSIDER.id },
    });
    expect(res.statusCode).toBe(403);
  });

  /**
   * The employee directory is COMPANY-WIDE now (read-only): any internal worker may read it, a team
   * lead included — it used to be HR-only, and this test asserted the refusal. What still holds is the
   * attendance-specific boundary above: a lead may sync/see only their OWN team. Management stays
   * gated (requireHrManage); the full directory-access matrix lives in hr-routes.test.ts.
   */
  it('lets a team lead read the company-wide employee directory', async () => {
    beALead();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/hr/employees',
      headers: bearer(await workerToken('Sales Rep')),
    });
    expect(res.statusCode).toBe(200);
  });

  it('still refuses a team lead the shift admin writes', async () => {
    beALead();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/hr/attendance/shifts',
      headers: bearer(await workerToken('Sales Rep')),
      payload: { name: 'Sneaky', startLocal: '09:00', endLocal: '18:00' },
    });
    expect(res.statusCode).toBe(403);
  });
});

/**
 * A missing static asset must not answer with the JSON error envelope.
 *
 * Production symptom: a tab open across a deploy asks for the previous build's chunk, the file is gone,
 * and the browser reported `MIME type ('application/json') is not a supported stylesheet MIME type`
 * instead of a plain 404 — which reads as a broken server rather than a stale tab.
 */
describe('static asset 404s', () => {
  it('returns text/plain, not the JSON envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/index-DoesNotExist.css' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.headers['content-type']).not.toContain('application/json');
  });

  it('does not answer a stylesheet request with the SPA shell either', async () => {
    // HTML would trip the same strict-MIME check, just with a different type named in it.
    const res = await app.inject({
      method: 'GET',
      url: '/assets/index-DoesNotExist.css',
      headers: { accept: 'text/html' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).not.toContain('text/html');
  });

  /** API 404s keep their JSON envelope — clients parse it. */
  it('leaves API 404s as JSON', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});
