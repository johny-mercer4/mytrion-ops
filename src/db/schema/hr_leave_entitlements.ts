import { createId } from '@paralleldrive/cuid2';
import { index, integer, numeric, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * A stable yearly allocation. Defaults are copied here once, so a policy edit never rewrites prior
 * years; Settings has an explicit "apply defaults" action for the selected year.
 */
export const hrLeaveEntitlements = pgTable(
  'hr_leave_entitlements',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `hrle_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    employeeId: text('employee_id').notNull(),
    leaveTypeId: text('leave_type_id').notNull(),
    year: integer('year').notNull(),
    allocatedDays: numeric('allocated_days', { precision: 7, scale: 2 }).notNull(),
    adjustmentDays: numeric('adjustment_days', { precision: 7, scale: 2 }).notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantEmployeeTypeYearUk: uniqueIndex('hr_leave_entitlements_scope_uk').on(
      table.tenantId,
      table.employeeId,
      table.leaveTypeId,
      table.year,
    ),
    tenantYearIdx: index('hr_leave_entitlements_tenant_year_idx').on(
      table.tenantId,
      table.year,
      table.employeeId,
    ),
  }),
);

export type HrLeaveEntitlement = typeof hrLeaveEntitlements.$inferSelect;
export type NewHrLeaveEntitlement = typeof hrLeaveEntitlements.$inferInsert;
