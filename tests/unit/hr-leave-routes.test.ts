import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

vi.mock('../../src/modules/hr/leave/service.js', () => ({
  getTimeOffOverview: vi.fn(async () => ({
    employee: { id: 'emp_1', employeeNumber: 'HRM01', name: 'A User', department: 'Sales' },
    year: 2026,
    balances: [],
    holidays: [],
  })),
  listMyLeaveRequests: vi.fn(async () => []),
  listApprovalInbox: vi.fn(async () => []),
  submitLeaveRequest: vi.fn(async () => ({
    id: 'leave_1',
    leaveTypeCode: 'sick',
    fromDate: '2026-08-03',
    toDate: '2026-08-03',
    requestedDays: '1.00',
    status: 'pending_lead',
  })),
  decideLeaveRequest: vi.fn(async () => ({ id: 'leave_1', status: 'pending_hr' })),
  cancelLeaveRequest: vi.fn(async () => ({ id: 'leave_1', status: 'cancelled' })),
  getLeaveRequestDetail: vi.fn(),
}));

vi.mock('../../src/repos/hrLeavePolicyRepo.js', () => ({
  hrLeavePolicyRepo: {
    listTypes: vi.fn(async () => []),
    listHolidays: vi.fn(async () => []),
    getSettings: vi.fn(async () => ({
      id: 'settings_1',
      tenantId: 'octane',
      finalApproverEmployeeId: 'emp_hr',
      timezone: 'Asia/Tashkent',
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    updateSettings: vi.fn(),
    updateType: vi.fn(),
    resetEntitlementsToDefaults: vi.fn(async () => 0),
    createHoliday: vi.fn(),
    updateHoliday: vi.fn(),
    deleteHoliday: vi.fn(),
  },
}));

vi.mock('../../src/repos/hrLeaveRequestRepo.js', () => ({
  hrLeaveRequestRepo: {
    listAll: vi.fn(async () => []),
  },
}));

vi.mock('../../src/repos/hrEmployeeRepo.js', () => ({
  hrEmployeeRepo: {
    getById: vi.fn(async () => undefined),
  },
}));

vi.mock('../../src/modules/audit/auditLogger.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/audit/auditLogger.js')>();
  return {
    ...mod,
    audit: vi.fn(async () => undefined),
    auditFromContext: vi.fn(async () => undefined),
  };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import {
  decideLeaveRequest,
  getTimeOffOverview,
  submitLeaveRequest,
} from '../../src/modules/hr/leave/service.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import { hrLeavePolicyRepo } from '../../src/repos/hrLeavePolicyRepo.js';

const overview = vi.mocked(getTimeOffOverview);
const submit = vi.mocked(submitLeaveRequest);
const decide = vi.mocked(decideLeaveRequest);
const policy = vi.mocked(hrLeavePolicyRepo);

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
    role: 'worker',
    worker: { zohoUserId: '42', userName: 'Test Worker', profile },
  });
}

const bearer = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
});

describe('HR Time Off — employee access', () => {
  it('requires authentication', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/hr/time-off/me?year=2026' });
    expect(response.statusCode).toBe(401);
  });

  it('is available to an internal employee without HR Mytrion access', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/hr/time-off/me?year=2026',
      headers: bearer(await workerToken('Sales Rep')),
    });
    expect(response.statusCode).toBe(200);
    expect(overview).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: DEFAULT_TENANT_ID, userId: 'zoho:42' }),
      2026,
    );
  });

  it('submits a request through the audited workflow service', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/hr/time-off/requests',
      headers: bearer(await workerToken('Sales Rep')),
      payload: {
        leaveTypeId: 'type_sick',
        fromDate: '2026-08-03',
        toDate: '2026-08-03',
        dayPart: 'full',
        reason: 'Doctor visit',
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ id: 'leave_1', status: 'pending_lead' });
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: DEFAULT_TENANT_ID }),
      expect.objectContaining({ leaveTypeId: 'type_sick', reason: 'Doctor visit' }),
    );
  });

  it('routes an approval decision through actor-checked service logic', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/hr/time-off/requests/leave_1/decision',
      headers: bearer(await workerToken('Sales Manager')),
      payload: { decision: 'approve', comment: 'Coverage confirmed' },
    });
    expect(response.statusCode).toBe(200);
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'zoho:42' }),
      expect.objectContaining({
        requestId: 'leave_1',
        decision: 'approve',
        comment: 'Coverage confirmed',
      }),
    );
  });
});

describe('HR Time Off — admin policy', () => {
  it('refuses policy changes from a non-admin', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/hr/time-off/balances/reset',
      headers: bearer(await workerToken('HR Manager')),
      payload: { year: 2026 },
    });
    expect(response.statusCode).toBe(403);
    expect(policy.resetEntitlementsToDefaults).not.toHaveBeenCalled();
  });

  it('allows Administrator to apply defaults to a selected year', async () => {
    policy.resetEntitlementsToDefaults.mockResolvedValueOnce(366);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/hr/time-off/balances/reset',
      headers: bearer(await workerToken('Administrator')),
      payload: { year: 2026 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ updated: 366 });
    expect(policy.resetEntitlementsToDefaults).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: DEFAULT_TENANT_ID }),
      2026,
    );
  });
});
