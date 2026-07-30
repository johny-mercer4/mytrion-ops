import { createId } from '@paralleldrive/cuid2';
import {
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import type { HrLeaveTypeCode } from './hr_leave_types.js';

export type HrLeaveRequestStatus =
  | 'pending_lead'
  | 'pending_hr'
  | 'approved'
  | 'rejected'
  | 'cancelled';
export type HrLeaveDayPart = 'full' | 'morning' | 'afternoon';

/**
 * One employee request. Approver IDs and leave-policy details are snapshotted at submission, so a
 * later department/policy edit cannot silently reroute or reinterpret an in-flight request.
 */
export const hrLeaveRequests = pgTable(
  'hr_leave_requests',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `hlr_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    employeeId: text('employee_id').notNull(),
    leaveTypeId: text('leave_type_id').notNull(),
    leaveTypeCode: text('leave_type_code').$type<HrLeaveTypeCode>().notNull(),
    leaveTypeName: text('leave_type_name').notNull(),
    fromDate: date('from_date').notNull(),
    toDate: date('to_date').notNull(),
    dayPart: text('day_part').$type<HrLeaveDayPart>().notNull().default('full'),
    requestedDays: numeric('requested_days', { precision: 7, scale: 2 }).notNull(),
    reason: text('reason'),
    status: text('status').$type<HrLeaveRequestStatus>().notNull(),
    currentApproverEmployeeId: text('current_approver_employee_id'),
    leadApproverEmployeeId: text('lead_approver_employee_id'),
    hrApproverEmployeeId: text('hr_approver_employee_id').notNull(),
    leadDecisionByEmployeeId: text('lead_decision_by_employee_id'),
    leadDecisionAt: timestamp('lead_decision_at', { withTimezone: true }),
    leadComment: text('lead_comment'),
    hrDecisionByEmployeeId: text('hr_decision_by_employee_id'),
    hrDecisionAt: timestamp('hr_decision_at', { withTimezone: true }),
    hrComment: text('hr_comment'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantEmployeeDateIdx: index('hr_leave_requests_tenant_employee_date_idx').on(
      table.tenantId,
      table.employeeId,
      table.fromDate,
      table.toDate,
    ),
    tenantApproverStatusIdx: index('hr_leave_requests_tenant_approver_status_idx').on(
      table.tenantId,
      table.currentApproverEmployeeId,
      table.status,
      table.submittedAt,
    ),
    tenantStatusIdx: index('hr_leave_requests_tenant_status_idx').on(
      table.tenantId,
      table.status,
      table.submittedAt,
    ),
  }),
);

export type HrLeaveRequest = typeof hrLeaveRequests.$inferSelect;
export type NewHrLeaveRequest = typeof hrLeaveRequests.$inferInsert;
