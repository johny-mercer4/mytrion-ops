import { createId } from '@paralleldrive/cuid2';
import { boolean, date, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export type HrHolidaySession = 'morning' | 'afternoon';

/** Company holidays used by leave-day calculation. Managed entirely from Mytrion Settings. */
export const hrHolidays = pgTable(
  'hr_holidays',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `hrh_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    date: date('date').notNull(),
    name: text('name').notNull(),
    location: text('location').notNull().default('Uzbekistan'),
    isHalfDay: boolean('is_half_day').notNull().default(false),
    session: text('session').$type<HrHolidaySession>(),
    isActive: boolean('is_active').notNull().default(true),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantDateNameUk: uniqueIndex('hr_holidays_tenant_date_name_uk').on(
      table.tenantId,
      table.date,
      table.name,
    ),
    tenantDateIdx: index('hr_holidays_tenant_date_idx').on(
      table.tenantId,
      table.date,
      table.isActive,
    ),
  }),
);

export type HrHoliday = typeof hrHolidays.$inferSelect;
export type NewHrHoliday = typeof hrHolidays.$inferInsert;
