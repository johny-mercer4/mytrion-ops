import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HrEmployeeRow } from '../../src/repos/hrEmployeeRepo.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

vi.mock('../../src/repos/hrEmployeeRepo.js', () => ({
  hrEmployeeRepo: {
    findByZohoUserId: vi.fn(),
    getById: vi.fn(),
  },
}));

vi.mock('../../src/repos/hrDepartmentRepo.js', () => ({
  hrDepartmentRepo: {
    getById: vi.fn(),
  },
}));

vi.mock('../../src/repos/hrLeavePolicyRepo.js', () => ({
  hrLeavePolicyRepo: {
    getType: vi.fn(),
    listHolidays: vi.fn(async () => []),
    getSettings: vi.fn(),
    ensureEntitlements: vi.fn(async () => undefined),
    balanceSummary: vi.fn(async () => []),
  },
}));

vi.mock('../../src/repos/hrLeaveRequestRepo.js', () => ({
  hrLeaveRequestRepo: {
    submit: vi.fn(),
    getById: vi.fn(),
    decide: vi.fn(),
  },
}));

vi.mock('../../src/modules/hr/leave/notify.js', () => ({
  notifyLeaveAwaitingApproval: vi.fn(async () => undefined),
  notifyLeaveResolved: vi.fn(async () => undefined),
}));

import { RBACError } from '../../src/lib/errors.js';
import {
  decideLeaveRequest,
  submitLeaveRequest,
} from '../../src/modules/hr/leave/service.js';
import { notifyLeaveAwaitingApproval } from '../../src/modules/hr/leave/notify.js';
import { hrDepartmentRepo } from '../../src/repos/hrDepartmentRepo.js';
import { hrEmployeeRepo } from '../../src/repos/hrEmployeeRepo.js';
import { hrLeavePolicyRepo } from '../../src/repos/hrLeavePolicyRepo.js';
import { hrLeaveRequestRepo } from '../../src/repos/hrLeaveRequestRepo.js';

const employees = vi.mocked(hrEmployeeRepo);
const departments = vi.mocked(hrDepartmentRepo);
const policy = vi.mocked(hrLeavePolicyRepo);
const requests = vi.mocked(hrLeaveRequestRepo);
const notifyApproval = vi.mocked(notifyLeaveAwaitingApproval);

const ctx: TenantContext = {
  tenantId: 'tenant-a',
  userId: 'zoho:requester-login',
  audience: 'internal',
  role: 'worker',
  scopes: [],
  departments: [],
  allDepartmentAccess: false,
  requestId: 'req-1',
};

function employee(
  id: string,
  zohoUserId: string,
  overrides: Partial<HrEmployeeRow> = {},
): HrEmployeeRow {
  return {
    id,
    tenantId: 'tenant-a',
    zohoRecordId: null,
    employeeId: id.toUpperCase(),
    firstName: id,
    lastName: 'User',
    email: `${id}@example.com`,
    departmentId: 'dept-1',
    department: 'Sales',
    departmentZohoId: null,
    designation: null,
    location: 'Tashkent',
    status: 'Active',
    role: null,
    dateOfJoining: null,
    mobile: null,
    faceId: null,
    telegramUsername: null,
    reportingTo: null,
    reportingToZohoId: null,
    reportingToEmployeeId: null,
    photoUrl: null,
    photoFileId: null,
    zohoUserId,
    zohoUserIdSource: 'manual',
    zohoUserLinkedAt: new Date(),
    canvasX: null,
    canvasY: null,
    source: 'manual',
    lastSyncedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const requester = employee('requester', 'requester-login');
const lead = employee('lead', 'lead-login');
const hr = employee('hr', 'hr-login', { firstName: 'Kristina', lastName: 'Smirnova' });

beforeEach(() => {
  vi.clearAllMocks();
  employees.findByZohoUserId.mockResolvedValue(requester);
  employees.getById.mockImplementation(async (_ctx, id) => {
    if (id === lead.id) return lead;
    if (id === hr.id) return hr;
    if (id === requester.id) return requester;
    return undefined;
  });
  departments.getById.mockResolvedValue({
    id: 'dept-1',
    tenantId: 'tenant-a',
    zohoRecordId: null,
    name: 'Sales',
    code: null,
    mailAlias: null,
    leadName: 'lead User',
    leadZohoId: null,
    leadEmail: lead.email,
    leadEmployeeId: lead.id,
    parentName: null,
    parentZohoId: null,
    parentId: null,
    description: null,
    icon: null,
    iconColor: null,
    canvasX: null,
    canvasY: null,
    source: 'manual',
    lastSyncedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  policy.getSettings.mockResolvedValue({
    id: 'settings',
    tenantId: 'tenant-a',
    finalApproverEmployeeId: hr.id,
    timezone: 'Asia/Tashkent',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  policy.getType.mockResolvedValue({
    id: 'annual',
    tenantId: 'tenant-a',
    code: 'annual_paid',
    name: 'Annual Paid Leave',
    isPaid: true,
    defaultDays: '17.50',
    isActive: true,
    sortOrder: 20,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  requests.submit.mockImplementation(async (_ctx, input) => ({
    id: 'leave-1',
    tenantId: 'tenant-a',
    employeeId: input.employeeId,
    leaveTypeId: input.leaveTypeId,
    leaveTypeCode: input.leaveTypeCode,
    leaveTypeName: input.leaveTypeName,
    fromDate: input.fromDate,
    toDate: input.toDate,
    dayPart: input.dayPart,
    requestedDays: String(input.requestedDays),
    reason: input.reason ?? null,
    status: input.status,
    currentApproverEmployeeId: input.currentApproverEmployeeId,
    leadApproverEmployeeId: input.leadApproverEmployeeId ?? null,
    hrApproverEmployeeId: input.hrApproverEmployeeId,
    leadDecisionByEmployeeId: null,
    leadDecisionAt: null,
    leadComment: null,
    hrDecisionByEmployeeId: null,
    hrDecisionAt: null,
    hrComment: null,
    submittedAt: new Date(),
    resolvedAt: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
});

describe('Time Off escalation', () => {
  it('routes an employee request to the department lead first', async () => {
    const result = await submitLeaveRequest(ctx, {
      leaveTypeId: 'annual',
      fromDate: '2026-08-03',
      toDate: '2026-08-05',
      dayPart: 'full',
      reason: 'Family trip',
    });
    expect(result.status).toBe('pending_lead');
    expect(requests.submit).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        requestedDays: 3,
        status: 'pending_lead',
        currentApproverEmployeeId: lead.id,
        leadApproverEmployeeId: lead.id,
        hrApproverEmployeeId: hr.id,
      }),
    );
    expect(notifyApproval).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ recipient: lead, stage: 'department lead' }),
    );
  });

  it('routes directly to HR when the requester is the department lead', async () => {
    departments.getById.mockResolvedValueOnce({
      ...(await departments.getById(ctx, 'dept-1'))!,
      leadEmployeeId: requester.id,
    });
    const result = await submitLeaveRequest(ctx, {
      leaveTypeId: 'annual',
      fromDate: '2026-08-03',
      toDate: '2026-08-03',
      dayPart: 'full',
    });
    expect(result.status).toBe('pending_hr');
    expect(requests.submit).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        status: 'pending_hr',
        currentApproverEmployeeId: hr.id,
        leadApproverEmployeeId: null,
      }),
    );
  });

  it('rejects a decision from anyone except the snapshotted current approver', async () => {
    requests.getById.mockResolvedValue({
      request: {
        ...(await requests.submit(ctx, {
          employeeId: requester.id,
          leaveTypeId: 'annual',
          leaveTypeCode: 'annual_paid',
          leaveTypeName: 'Annual Paid Leave',
          fromDate: '2026-08-03',
          toDate: '2026-08-03',
          dayPart: 'full',
          requestedDays: 1,
          status: 'pending_lead',
          currentApproverEmployeeId: lead.id,
          leadApproverEmployeeId: lead.id,
          hrApproverEmployeeId: hr.id,
          year: 2026,
        })),
      },
      employee: {
        id: requester.id,
        firstName: requester.firstName,
        lastName: requester.lastName,
        employeeNumber: requester.employeeId,
        department: requester.department,
      },
      currentApproverName: 'lead User',
      leadApproverName: 'lead User',
      hrApproverName: 'Kristina Smirnova',
    });
    await expect(
      decideLeaveRequest(ctx, { requestId: 'leave-1', decision: 'approve' }),
    ).rejects.toBeInstanceOf(RBACError);
    expect(requests.decide).not.toHaveBeenCalled();
  });
});
