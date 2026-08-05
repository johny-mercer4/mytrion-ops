import type {
  HrLeaveDayPart,
  HrLeaveRequestStatus,
} from '../../../db/schema/index.js';
import { ConflictError, NotFoundError, RBACError } from '../../../lib/errors.js';
import { hrDepartmentRepo } from '../../../repos/hrDepartmentRepo.js';
import { hrEmployeeRepo, type HrEmployeeRow } from '../../../repos/hrEmployeeRepo.js';
import {
  hrLeavePolicyRepo,
  type LeaveBalanceRow,
} from '../../../repos/hrLeavePolicyRepo.js';
import {
  hrLeaveRequestRepo,
  type LeaveRequestListOptions,
  type LeaveRequestView,
} from '../../../repos/hrLeaveRequestRepo.js';
import type { TenantContext } from '../../../types/tenantContext.js';
import { calculateLeaveDays, leaveYear } from './calendar.js';
import { notifyLeaveAwaitingApproval, notifyLeaveResolved } from './notify.js';

function zohoUserIdFromCtx(ctx: TenantContext): string {
  return ctx.userId.startsWith('zoho:') ? ctx.userId.replace(/^zoho:/, '') : '';
}

export async function resolveTimeOffEmployee(ctx: TenantContext): Promise<HrEmployeeRow> {
  const zohoUserId = zohoUserIdFromCtx(ctx);
  if (!zohoUserId) throw new NotFoundError('No employee record is linked to this sign-in');
  const employee = await hrEmployeeRepo.findByZohoUserId(ctx, zohoUserId);
  if (!employee || employee.status.toLowerCase() !== 'active') {
    throw new NotFoundError('No active employee record is linked to this sign-in');
  }
  return employee;
}

export interface TimeOffOverview {
  employee: {
    id: string;
    employeeNumber: string | null;
    name: string;
    department: string | null;
  };
  year: number;
  balances: LeaveBalanceRow[];
  holidays: Awaited<ReturnType<typeof hrLeavePolicyRepo.listHolidays>>;
}

export async function getTimeOffOverview(
  ctx: TenantContext,
  year: number,
): Promise<TimeOffOverview> {
  const employee = await resolveTimeOffEmployee(ctx);
  const [balances, holidays] = await Promise.all([
    hrLeavePolicyRepo.balanceSummary(ctx, employee.id, year),
    hrLeavePolicyRepo.listHolidays(ctx, year, true),
  ]);
  return {
    employee: {
      id: employee.id,
      employeeNumber: employee.employeeId,
      name: `${employee.firstName} ${employee.lastName}`.trim(),
      department: employee.department,
    },
    year,
    balances,
    holidays,
  };
}

async function finalApprover(ctx: TenantContext): Promise<HrEmployeeRow> {
  const settings = await hrLeavePolicyRepo.getSettings(ctx);
  if (!settings.finalApproverEmployeeId) {
    throw new ConflictError('Final HR approver is not configured in Time Off settings');
  }
  const approver = await hrEmployeeRepo.getById(ctx, settings.finalApproverEmployeeId);
  if (!approver || approver.status.toLowerCase() !== 'active') {
    throw new ConflictError('The configured final HR approver is not an active employee');
  }
  if (!approver.zohoUserId?.trim()) {
    throw new ConflictError('The configured final HR approver has no linked Mytrion login');
  }
  return approver;
}

async function departmentLead(
  ctx: TenantContext,
  requester: HrEmployeeRow,
): Promise<HrEmployeeRow | null> {
  if (!requester.departmentId) return null;
  const department = await hrDepartmentRepo.getById(ctx, requester.departmentId);
  if (!department?.leadEmployeeId || department.leadEmployeeId === requester.id) return null;
  const lead = await hrEmployeeRepo.getById(ctx, department.leadEmployeeId);
  if (!lead || lead.status.toLowerCase() !== 'active' || !lead.zohoUserId?.trim()) return null;
  return lead;
}

export async function submitLeaveRequest(
  ctx: TenantContext,
  input: {
    leaveTypeId: string;
    fromDate: string;
    toDate: string;
    dayPart: HrLeaveDayPart;
    reason?: string | null;
  },
) {
  const requester = await resolveTimeOffEmployee(ctx);
  const year = leaveYear(input.fromDate, input.toDate);
  const [type, holidays, hrApprover, lead] = await Promise.all([
    hrLeavePolicyRepo.getType(ctx, input.leaveTypeId),
    hrLeavePolicyRepo.listHolidays(ctx, year, true),
    finalApprover(ctx),
    departmentLead(ctx, requester),
  ]);
  if (!type?.isActive) throw new NotFoundError('Leave type not found');
  const requestedDays = calculateLeaveDays({
    fromDate: input.fromDate,
    toDate: input.toDate,
    dayPart: input.dayPart,
    holidays,
  });
  await hrLeavePolicyRepo.ensureEntitlements(ctx, requester.id, year);
  const useLeadStage = lead !== null && lead.id !== hrApprover.id;
  const currentApprover = useLeadStage ? lead : hrApprover;
  const request = await hrLeaveRequestRepo.submit(ctx, {
    employeeId: requester.id,
    leaveTypeId: type.id,
    leaveTypeCode: type.code,
    leaveTypeName: type.name,
    fromDate: input.fromDate,
    toDate: input.toDate,
    dayPart: input.dayPart,
    requestedDays,
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
    status: useLeadStage ? 'pending_lead' : 'pending_hr',
    currentApproverEmployeeId: currentApprover.id,
    leadApproverEmployeeId: useLeadStage ? currentApprover.id : null,
    hrApproverEmployeeId: hrApprover.id,
    year,
  });
  await notifyLeaveAwaitingApproval(ctx, {
    recipient: currentApprover,
    requester,
    requestId: request.id,
    leaveTypeName: request.leaveTypeName,
    fromDate: request.fromDate,
    toDate: request.toDate,
    requestedDays,
    stage: useLeadStage ? 'department lead' : 'HR final approval',
  });
  return request;
}

export async function listMyLeaveRequests(
  ctx: TenantContext,
  opts: LeaveRequestListOptions,
): Promise<LeaveRequestView[]> {
  const employee = await resolveTimeOffEmployee(ctx);
  return hrLeaveRequestRepo.listMine(ctx, employee.id, opts);
}

export async function listApprovalInbox(
  ctx: TenantContext,
  opts: LeaveRequestListOptions,
): Promise<LeaveRequestView[]> {
  const employee = await resolveTimeOffEmployee(ctx);
  return hrLeaveRequestRepo.listInbox(ctx, employee.id, opts);
}

export async function decideLeaveRequest(
  ctx: TenantContext,
  input: {
    requestId: string;
    decision: 'approve' | 'reject';
    comment?: string | null;
  },
) {
  const actor = await resolveTimeOffEmployee(ctx);
  const before = await hrLeaveRequestRepo.getById(ctx, input.requestId);
  if (!before) throw new NotFoundError('Leave request not found');
  if (before.request.currentApproverEmployeeId !== actor.id) {
    throw new RBACError('This leave request is not awaiting your decision');
  }
  const updated = await hrLeaveRequestRepo.decide(ctx, {
    requestId: input.requestId,
    actorEmployeeId: actor.id,
    decision: input.decision,
    ...(input.comment !== undefined ? { comment: input.comment } : {}),
  });
  const requester = await hrEmployeeRepo.getById(ctx, updated.employeeId);
  if (!requester) return updated;
  if (updated.status === 'pending_hr') {
    const hrApprover = await hrEmployeeRepo.getById(ctx, updated.hrApproverEmployeeId);
    if (hrApprover) {
      await notifyLeaveAwaitingApproval(ctx, {
        recipient: hrApprover,
        requester,
        requestId: updated.id,
        leaveTypeName: updated.leaveTypeName,
        fromDate: updated.fromDate,
        toDate: updated.toDate,
        requestedDays: Number(updated.requestedDays),
        stage: 'HR final approval',
      });
    }
  } else {
    await notifyLeaveResolved(ctx, {
      recipient: requester,
      requestId: updated.id,
      leaveTypeName: updated.leaveTypeName,
      fromDate: updated.fromDate,
      toDate: updated.toDate,
      decision: updated.status === 'approved' ? 'approved' : 'rejected',
    });
  }
  return updated;
}

export async function cancelLeaveRequest(
  ctx: TenantContext,
  requestId: string,
  comment?: string | null,
) {
  const employee = await resolveTimeOffEmployee(ctx);
  return hrLeaveRequestRepo.cancel(ctx, requestId, employee.id, comment);
}

export function canAdministerTimeOff(ctx: TenantContext): boolean {
  return (
    ctx.role === 'admin' ||
    ctx.allDepartmentAccess ||
    ctx.bypassRbac === true ||
    ctx.departments.includes('hr')
  );
}

export async function getLeaveRequestDetail(
  ctx: TenantContext,
  id: string,
): Promise<{ item: LeaveRequestView; actions: Awaited<ReturnType<typeof hrLeaveRequestRepo.listActions>> }> {
  /**
   * READING a request does not need an employee row of the caller's own. Resolving it first made every
   * row in the HR register 404 for precisely the population the register exists for — an HR/admin
   * sign-in whose Zoho user id has no active hr_employees match. submit/decide/cancel still require
   * one, because they need an actor id to write.
   */
  const employee = await resolveTimeOffEmployee(ctx).catch((err: unknown) => {
    if (canAdministerTimeOff(ctx)) return null;
    throw err;
  });
  const item = await hrLeaveRequestRepo.getById(ctx, id);
  if (!item) throw new NotFoundError('Leave request not found');
  const request = item.request;
  const canView =
    canAdministerTimeOff(ctx) ||
    (employee !== null &&
      (request.employeeId === employee.id ||
        request.leadApproverEmployeeId === employee.id ||
        request.hrApproverEmployeeId === employee.id));
  if (!canView) throw new RBACError('You cannot view this leave request');
  return { item, actions: await hrLeaveRequestRepo.listActions(ctx, id) };
}

export type { HrLeaveRequestStatus };
