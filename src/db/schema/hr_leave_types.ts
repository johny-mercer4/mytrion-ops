import { createId } from '@paralleldrive/cuid2';
import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export type HrLeaveTypeCode = 'sick' | 'annual_paid' | 'unpaid';

/** Tenant-owned leave policies. `defaultDays` seeds each employee's yearly entitlement. */
export const hrLeaveTypes = pgTable(
  'hr_leave_types',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `hrlt_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    code: text('code').$type<HrLeaveTypeCode>().notNull(),
    name: text('name').notNull(),
    isPaid: boolean('is_paid').notNull(),
    defaultDays: numeric('default_days', { precision: 7, scale: 2 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantCodeUk: uniqueIndex('hr_leave_types_tenant_code_uk').on(table.tenantId, table.code),
    tenantOrderIdx: index('hr_leave_types_tenant_order_idx').on(
      table.tenantId,
      table.isActive,
      table.sortOrder,
    ),
  }),
);

export type HrLeaveType = typeof hrLeaveTypes.$inferSelect;
export type NewHrLeaveType = typeof hrLeaveTypes.$inferInsert;
