import { createId } from '@paralleldrive/cuid2';
import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const recruitSettings = pgTable(
  'recruit_settings',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `rst_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    defaultLocation: text('default_location'),
    employeeIdPrefix: text('employee_id_prefix').notNull().default('EMP'),
    defaultEmployeeStatus: text('default_employee_status').notNull().default('Active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantUk: uniqueIndex('recruit_settings_tenant_uk').on(table.tenantId),
  }),
);

export type RecruitSettings = typeof recruitSettings.$inferSelect;
export type NewRecruitSettings = typeof recruitSettings.$inferInsert;
