/**
 * Attendance webhook auth + admin shift gate.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
  process.env.HR_ATTENDANCE_WEBHOOK_SECRET = 'att-test-secret';
});

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
    listAssignmentsForShift: vi.fn(async () => []),
  },
}));

vi.mock('../../src/repos/hrEmployeeRepo.js', () => ({
  hrEmployeeRepo: {
    findByZohoUserId: vi.fn(async () => undefined),
    getById: vi.fn(async () => undefined),
    listByReportingTo: vi.fn(async () => []),
    listByDepartmentIds: vi.fn(async () => []),
    list: vi.fn(async () => []),
  },
}));

vi.mock('../../src/repos/hrDepartmentRepo.js', () => ({
  hrDepartmentRepo: {
    listIdsLedBy: vi.fn(async () => []),
  },
}));

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
import { hrAttendanceShiftRepo } from '../../src/repos/hrAttendanceShiftRepo.js';
import { hrEmployeeRepo } from '../../src/repos/hrEmployeeRepo.js';

const ingest = vi.mocked(ingestAttendanceWebhook);
const shifts = vi.mocked(hrAttendanceShiftRepo);
const employees = vi.mocked(hrEmployeeRepo);

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

  it('GET export refuses a non-admin HR reader', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/hr/attendance/export?from=2026-07-01&to=2026-07-07',
      headers: bearer(await workerToken('HR Manager')),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('HR attendance team visibility', () => {
  it('GET team requires a linked employee', async () => {
    employees.findByZohoUserId.mockResolvedValueOnce(undefined);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/hr/attendance/team?weekOf=2026-07-27&scope=direct',
      headers: bearer(await workerToken('HR Manager')),
    });
    expect(res.statusCode).toBe(404);
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

