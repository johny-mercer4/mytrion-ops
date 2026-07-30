import { createId } from '@paralleldrive/cuid2';
import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/** One row per tenant: final HR approver and calendar timezone. */
export const hrLeaveSettings = pgTable(
  'hr_leave_settings',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `hrls_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    finalApproverEmployeeId: text('final_approver_employee_id'),
    timezone: text('timezone').notNull().default('Asia/Tashkent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantUk: uniqueIndex('hr_leave_settings_tenant_uk').on(table.tenantId),
  }),
);

export type HrLeaveSetting = typeof hrLeaveSettings.$inferSelect;
export type NewHrLeaveSetting = typeof hrLeaveSettings.$inferInsert;
