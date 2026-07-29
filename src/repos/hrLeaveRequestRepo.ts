import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../db/client.js';
import {
  hrEmployees,
  hrLeaveEntitlements,
  hrLeaveRequestActions,
  hrLeaveRequests,
  type HrLeaveDayPart,
  type HrLeaveAction,
  type HrLeaveRequest,
  type HrLeaveRequestAction,
  type HrLeaveRequestStatus,
  type NewHrLeaveRequest,
} from '../db/schema/index.js';
import { ConflictError } from '../lib/errors.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow, firstOrUndefined } from './util.js';

const currentApprover = alias(hrEmployees, 'leave_current_approver');
const leadApprover = alias(hrEmployees, 'leave_lead_approver');
const hrApprover = alias(hrEmployees, 'leave_hr_approver');

const REQUEST_COLS = {
  id: hrLeaveRequests.id,
  tenantId: hrLeaveRequests.tenantId,
  employeeId: hrLeaveRequests.employeeId,
  leaveTypeId: hrLeaveRequests.leaveTypeId,
  leaveTypeCode: hrLeaveRequests.leaveTypeCode,
  leaveTypeName: hrLeaveRequests.leaveTypeName,
  fromDate: hrLeaveRequests.fromDate,
  toDate: hrLeaveRequests.toDate,
  dayPart: hrLeaveRequests.dayPart,
  requestedDays: hrLeaveRequests.requestedDays,
  reason: hrLeaveRequests.reason,
  status: hrLeaveRequests.status,
  currentApproverEmployeeId: hrLeaveRequests.currentApproverEmployeeId,
  leadApproverEmployeeId: hrLeaveRequests.leadApproverEmployeeId,
  hrApproverEmployeeId: hrLeaveRequests.hrApproverEmployeeId,
  leadDecisionByEmployeeId: hrLeaveRequests.leadDecisionByEmployeeId,
  leadDecisionAt: hrLeaveRequests.leadDecisionAt,
  leadComment: hrLeaveRequests.leadComment,
  hrDecisionByEmployeeId: hrLeaveRequests.hrDecisionByEmployeeId,
  hrDecisionAt: hrLeaveRequests.hrDecisionAt,
  hrComment: hrLeaveRequests.hrComment,
  submittedAt: hrLeaveRequests.submittedAt,
  resolvedAt: hrLeaveRequests.resolvedAt,
  version: hrLeaveRequests.version,
  createdAt: hrLeaveRequests.createdAt,
  updatedAt: hrLeaveRequests.updatedAt,
} as const;

const VIEW_COLS = {
  request: REQUEST_COLS,
  employeeFirstName: hrEmployees.firstName,
  employeeLastName: hrEmployees.lastName,
  employeeNumber: hrEmployees.employeeId,
  department: hrEmployees.department,
  currentApproverFirstName: currentApprover.firstName,
  currentApproverLastName: currentApprover.lastName,
  leadApproverFirstName: leadApprover.firstName,
  leadApproverLastName: leadApprover.lastName,
  hrApproverFirstName: hrApprover.firstName,
  hrApproverLastName: hrApprover.lastName,
} as const;

export interface LeaveRequestView {
  request: HrLeaveRequest;
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    employeeNumber: string | null;
    department: string | null;
  };
  currentApproverName: string | null;
  leadApproverName: string | null;
  hrApproverName: string | null;
}

export interface LeaveRequestListOptions {
  year?: number;
  status?: HrLeaveRequestStatus;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface SubmitLeaveRequestInput {
  employeeId: string;
  leaveTypeId: string;
  leaveTypeCode: NewHrLeaveRequest['leaveTypeCode'];
  leaveTypeName: string;
  fromDate: string;
  toDate: string;
  dayPart: HrLeaveDayPart;
  requestedDays: number;
  reason?: string | null;
  status: 'pending_lead' | 'pending_hr';
  currentApproverEmployeeId: string;
  leadApproverEmployeeId?: string | null;
  hrApproverEmployeeId: string;
  year: number;
}

function name(first: string | null, last: string | null): string | null {
  const value = `${first ?? ''} ${last ?? ''}`.trim();
  return value || null;
}

function toView(row: typeof VIEW_COLS extends never ? never : {
  request: HrLeaveRequest;
  employeeFirstName: string;
  employeeLastName: string;
  employeeNumber: string | null;
  department: string | null;
  currentApproverFirstName: string | null;
  currentApproverLastName: string | null;
  leadApproverFirstName: string | null;
  leadApproverLastName: string | null;
  hrApproverFirstName: string | null;
  hrApproverLastName: string | null;
}): LeaveRequestView {
  return {
    request: row.request,
    employee: {
      id: row.request.employeeId,
      firstName: row.employeeFirstName,
      lastName: row.employeeLastName,
      employeeNumber: row.employeeNumber,
      department: row.department,
    },
    currentApproverName: name(row.currentApproverFirstName, row.currentApproverLastName),
    leadApproverName: name(row.leadApproverFirstName, row.leadApproverLastName),
    hrApproverName: name(row.hrApproverFirstName, row.hrApproverLastName),
  };
}

function baseViewQuery() {
  return db
    .select(VIEW_COLS)
    .from(hrLeaveRequests)
    .innerJoin(
      hrEmployees,
      and(
        eq(hrEmployees.tenantId, hrLeaveRequests.tenantId),
        eq(hrEmployees.id, hrLeaveRequests.employeeId),
      ),
    )
    .leftJoin(
      currentApprover,
      and(
        eq(currentApprover.tenantId, hrLeaveRequests.tenantId),
        eq(currentApprover.id, hrLeaveRequests.currentApproverEmployeeId),
      ),
    )
    .leftJoin(
      leadApprover,
      and(
        eq(leadApprover.tenantId, hrLeaveRequests.tenantId),
        eq(leadApprover.id, hrLeaveRequests.leadApproverEmployeeId),
      ),
    )
    .leftJoin(
      hrApprover,
      and(
        eq(hrApprover.tenantId, hrLeaveRequests.tenantId),
        eq(hrApprover.id, hrLeaveRequests.hrApproverEmployeeId),
      ),
    );
}

function listClauses(ctx: TenantContext, opts: LeaveRequestListOptions) {
  const clauses = [eq(hrLeaveRequests.tenantId, ctx.tenantId)];
  if (opts.year !== undefined) {
    clauses.push(gte(hrLeaveRequests.fromDate, `${opts.year}-01-01`));
    clauses.push(lte(hrLeaveRequests.fromDate, `${opts.year}-12-31`));
  }
  if (opts.status) clauses.push(eq(hrLeaveRequests.status, opts.status));
  if (opts.q?.trim()) {
    const q = `%${opts.q.trim()}%`;
    const search = or(
      ilike(hrEmployees.firstName, q),
      ilike(hrEmployees.lastName, q),
      ilike(hrEmployees.employeeId, q),
      ilike(hrEmployees.department, q),
      ilike(hrLeaveRequests.leaveTypeName, q),
    );
    if (search) clauses.push(search);
  }
  return clauses;
}

async function addAction(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  ctx: TenantContext,
  input: {
    requestId: string;
    action: HrLeaveAction;
    actorEmployeeId?: string | null;
    fromStatus?: HrLeaveRequestStatus | null;
    toStatus: HrLeaveRequestStatus;
    comment?: string | null;
  },
): Promise<void> {
  await tx.insert(hrLeaveRequestActions).values({
    tenantId: ctx.tenantId,
    requestId: input.requestId,
    action: input.action,
    actorEmployeeId: input.actorEmployeeId ?? null,
    actorUserId: ctx.userId,
    fromStatus: input.fromStatus ?? null,
    toStatus: input.toStatus,
    comment: input.comment?.trim() || null,
  });
}

export const hrLeaveRequestRepo = {
  async getById(ctx: TenantContext, id: string): Promise<LeaveRequestView | undefined> {
    const rows = await baseViewQuery()
      .where(and(eq(hrLeaveRequests.tenantId, ctx.tenantId), eq(hrLeaveRequests.id, id)))
      .limit(1);
    const row = firstOrUndefined(rows);
    return row ? toView(row) : undefined;
  },

  async listMine(
    ctx: TenantContext,
    employeeId: string,
    opts: LeaveRequestListOptions = {},
  ): Promise<LeaveRequestView[]> {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 300);
    const offset = Math.max(opts.offset ?? 0, 0);
    const rows = await baseViewQuery()
      .where(
        and(
          ...listClauses(ctx, opts),
          eq(hrLeaveRequests.employeeId, employeeId),
        ),
      )
      .orderBy(desc(hrLeaveRequests.submittedAt))
      .limit(limit)
      .offset(offset);
    return rows.map(toView);
  },

  async listInbox(
    ctx: TenantContext,
    approverEmployeeId: string,
    opts: LeaveRequestListOptions = {},
  ): Promise<LeaveRequestView[]> {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 300);
    const offset = Math.max(opts.offset ?? 0, 0);
    const rows = await baseViewQuery()
      .where(
        and(
          ...listClauses(ctx, opts),
          eq(hrLeaveRequests.currentApproverEmployeeId, approverEmployeeId),
          inArray(hrLeaveRequests.status, ['pending_lead', 'pending_hr']),
        ),
      )
      .orderBy(asc(hrLeaveRequests.submittedAt))
      .limit(limit)
      .offset(offset);
    return rows.map(toView);
  },

  async listAll(
    ctx: TenantContext,
    opts: LeaveRequestListOptions = {},
  ): Promise<LeaveRequestView[]> {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 300);
    const offset = Math.max(opts.offset ?? 0, 0);
    const rows = await baseViewQuery()
      .where(and(...listClauses(ctx, opts)))
      .orderBy(desc(hrLeaveRequests.submittedAt))
      .limit(limit)
      .offset(offset);
    return rows.map(toView);
  },

  async listActions(
    ctx: TenantContext,
    requestId: string,
  ): Promise<HrLeaveRequestAction[]> {
    return db
      .select()
      .from(hrLeaveRequestActions)
      .where(
        and(
          eq(hrLeaveRequestActions.tenantId, ctx.tenantId),
          eq(hrLeaveRequestActions.requestId, requestId),
        ),
      )
      .orderBy(asc(hrLeaveRequestActions.createdAt));
  },

  async submit(
    ctx: TenantContext,
    input: SubmitLeaveRequestInput,
  ): Promise<HrLeaveRequest> {
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`${ctx.tenantId}:${input.employeeId}:${input.year}`}, 0))`,
      );
      const entitlements = await tx
        .select({
          allocatedDays: hrLeaveEntitlements.allocatedDays,
          adjustmentDays: hrLeaveEntitlements.adjustmentDays,
        })
        .from(hrLeaveEntitlements)
        .where(
          and(
            eq(hrLeaveEntitlements.tenantId, ctx.tenantId),
            eq(hrLeaveEntitlements.employeeId, input.employeeId),
            eq(hrLeaveEntitlements.leaveTypeId, input.leaveTypeId),
            eq(hrLeaveEntitlements.year, input.year),
          ),
        )
        .limit(1);
      const entitlement = firstOrUndefined(entitlements);
      if (!entitlement) throw new ConflictError('Leave entitlement is not configured');

      const overlaps = await tx
        .select({ id: hrLeaveRequests.id })
        .from(hrLeaveRequests)
        .where(
          and(
            eq(hrLeaveRequests.tenantId, ctx.tenantId),
            eq(hrLeaveRequests.employeeId, input.employeeId),
            inArray(hrLeaveRequests.status, ['pending_lead', 'pending_hr', 'approved']),
            lte(hrLeaveRequests.fromDate, input.toDate),
            gte(hrLeaveRequests.toDate, input.fromDate),
          ),
        )
        .limit(1);
      if (overlaps.length > 0) {
        throw new ConflictError('A pending or approved leave already overlaps these dates');
      }

      const usageRows = await tx
        .select({
          used: sql<string>`coalesce(sum(${hrLeaveRequests.requestedDays}), 0)`,
        })
        .from(hrLeaveRequests)
        .where(
          and(
            eq(hrLeaveRequests.tenantId, ctx.tenantId),
            eq(hrLeaveRequests.employeeId, input.employeeId),
            eq(hrLeaveRequests.leaveTypeId, input.leaveTypeId),
            gte(hrLeaveRequests.fromDate, `${input.year}-01-01`),
            lte(hrLeaveRequests.fromDate, `${input.year}-12-31`),
            inArray(hrLeaveRequests.status, ['pending_lead', 'pending_hr', 'approved']),
          ),
        );
      const available =
        Number(entitlement.allocatedDays) +
        Number(entitlement.adjustmentDays) -
        Number(usageRows[0]?.used ?? 0);
      if (input.requestedDays > available + 0.0001) {
        throw new ConflictError(
          `Insufficient leave balance: ${available.toFixed(2)} day(s) available`,
        );
      }

      const rows = await tx
        .insert(hrLeaveRequests)
        .values({
          tenantId: ctx.tenantId,
          employeeId: input.employeeId,
          leaveTypeId: input.leaveTypeId,
          leaveTypeCode: input.leaveTypeCode,
          leaveTypeName: input.leaveTypeName,
          fromDate: input.fromDate,
          toDate: input.toDate,
          dayPart: input.dayPart,
          requestedDays: String(input.requestedDays),
          reason: input.reason?.trim() || null,
          status: input.status,
          currentApproverEmployeeId: input.currentApproverEmployeeId,
          leadApproverEmployeeId: input.leadApproverEmployeeId?.trim() || null,
          hrApproverEmployeeId: input.hrApproverEmployeeId,
        })
        .returning(REQUEST_COLS);
      const request = firstOrThrow(rows, 'hr_leave_requests insert returned no row');
      await addAction(tx, ctx, {
        requestId: request.id,
        action: 'submitted',
        actorEmployeeId: input.employeeId,
        toStatus: input.status,
      });
      return request;
    });
  },

  async decide(
    ctx: TenantContext,
    input: {
      requestId: string;
      actorEmployeeId: string;
      decision: 'approve' | 'reject';
      comment?: string | null;
    },
  ): Promise<HrLeaveRequest> {
    return db.transaction(async (tx) => {
      const rows = await tx
        .select(REQUEST_COLS)
        .from(hrLeaveRequests)
        .where(
          and(
            eq(hrLeaveRequests.tenantId, ctx.tenantId),
            eq(hrLeaveRequests.id, input.requestId),
          ),
        )
        .limit(1);
      const current = firstOrUndefined(rows);
      if (!current) throw new ConflictError('Leave request no longer exists');
      if (
        !['pending_lead', 'pending_hr'].includes(current.status) ||
        current.currentApproverEmployeeId !== input.actorEmployeeId
      ) {
        throw new ConflictError('This request is no longer awaiting your decision');
      }

      const now = new Date();
      const approveLead = input.decision === 'approve' && current.status === 'pending_lead';
      const nextStatus: HrLeaveRequestStatus =
        input.decision === 'reject'
          ? 'rejected'
          : approveLead
            ? 'pending_hr'
            : 'approved';
      const updates: Partial<NewHrLeaveRequest> = {
        status: nextStatus,
        currentApproverEmployeeId: approveLead ? current.hrApproverEmployeeId : null,
        resolvedAt: nextStatus === 'pending_hr' ? null : now,
        updatedAt: now,
        version: current.version + 1,
      };
      if (current.status === 'pending_lead') {
        updates.leadDecisionByEmployeeId = input.actorEmployeeId;
        updates.leadDecisionAt = now;
        updates.leadComment = input.comment?.trim() || null;
      } else {
        updates.hrDecisionByEmployeeId = input.actorEmployeeId;
        updates.hrDecisionAt = now;
        updates.hrComment = input.comment?.trim() || null;
      }
      const updatedRows = await tx
        .update(hrLeaveRequests)
        .set(updates)
        .where(
          and(
            eq(hrLeaveRequests.tenantId, ctx.tenantId),
            eq(hrLeaveRequests.id, current.id),
            eq(hrLeaveRequests.version, current.version),
            eq(hrLeaveRequests.status, current.status),
            eq(hrLeaveRequests.currentApproverEmployeeId, input.actorEmployeeId),
          ),
        )
        .returning(REQUEST_COLS);
      const updated = firstOrUndefined(updatedRows);
      if (!updated) throw new ConflictError('This leave request was updated by someone else');
      const action: HrLeaveAction =
        input.decision === 'reject'
          ? 'rejected'
          : current.status === 'pending_lead'
            ? 'lead_approved'
            : 'hr_approved';
      await addAction(tx, ctx, {
        requestId: current.id,
        action,
        actorEmployeeId: input.actorEmployeeId,
        fromStatus: current.status,
        toStatus: nextStatus,
        ...(input.comment !== undefined ? { comment: input.comment } : {}),
      });
      return updated;
    });
  },

  async cancel(
    ctx: TenantContext,
    requestId: string,
    employeeId: string,
    comment?: string | null,
  ): Promise<HrLeaveRequest> {
    return db.transaction(async (tx) => {
      const currentRows = await tx
        .select(REQUEST_COLS)
        .from(hrLeaveRequests)
        .where(
          and(
            eq(hrLeaveRequests.tenantId, ctx.tenantId),
            eq(hrLeaveRequests.id, requestId),
            eq(hrLeaveRequests.employeeId, employeeId),
            inArray(hrLeaveRequests.status, ['pending_lead', 'pending_hr']),
          ),
        )
        .limit(1);
      const current = firstOrUndefined(currentRows);
      if (!current) throw new ConflictError('Only your pending leave request can be cancelled');
      const rows = await tx
        .update(hrLeaveRequests)
        .set({
          status: 'cancelled',
          currentApproverEmployeeId: null,
          resolvedAt: new Date(),
          updatedAt: new Date(),
          version: sql`${hrLeaveRequests.version} + 1`,
        })
        .where(
          and(
            eq(hrLeaveRequests.tenantId, ctx.tenantId),
            eq(hrLeaveRequests.id, requestId),
            eq(hrLeaveRequests.employeeId, employeeId),
            inArray(hrLeaveRequests.status, ['pending_lead', 'pending_hr']),
          ),
        )
        .returning(REQUEST_COLS);
      const updated = firstOrUndefined(rows);
      if (!updated) throw new ConflictError('Only your pending leave request can be cancelled');
      await addAction(tx, ctx, {
        requestId,
        action: 'cancelled',
        actorEmployeeId: employeeId,
        fromStatus: current.status,
        toStatus: 'cancelled',
        ...(comment !== undefined ? { comment } : {}),
      });
      return updated;
    });
  },
};
