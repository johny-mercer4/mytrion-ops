import { createId } from '@paralleldrive/cuid2';
import { date, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Which shift an employee works over a date range (UZB calendar dates).
 * `effective_to` null = open-ended.
 */
export const hrAttendanceShiftAssignments = pgTable(
  'hr_attendance_shift_assignments',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `hrsa_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    employeeId: text('employee_id').notNull(),
    shiftId: text('shift_id').notNull(),
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    effectiveTo: date('effective_to', { mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantEmpFromUk: uniqueIndex('hr_attendance_shift_asg_tenant_emp_from_uk').on(
      table.tenantId,
      table.employeeId,
      table.effectiveFrom,
    ),
    tenantEmpIdx: index('hr_attendance_shift_asg_tenant_emp_idx').on(
      table.tenantId,
      table.employeeId,
    ),
    tenantShiftIdx: index('hr_attendance_shift_asg_tenant_shift_idx').on(
      table.tenantId,
      table.shiftId,
    ),
  }),
);

export type HrAttendanceShiftAssignment = typeof hrAttendanceShiftAssignments.$inferSelect;
export type NewHrAttendanceShiftAssignment = typeof hrAttendanceShiftAssignments.$inferInsert;
