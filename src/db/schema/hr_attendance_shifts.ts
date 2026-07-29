import { createId } from '@paralleldrive/cuid2';
import { boolean, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Named work shifts for Mytrion HR attendance (e.g. "UZB Main" 19:00–03:00).
 * Punch pairing always uses Asia/Tashkent wall-clock; `timezone` documents the shift's intended TZ.
 */
export const hrAttendanceShifts = pgTable(
  'hr_attendance_shifts',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `hrs_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    name: text('name').notNull(),
    /** IANA timezone — default Asia/Tashkent. */
    timezone: text('timezone').notNull().default('Asia/Tashkent'),
    /** Local start `HH:mm` (24h). */
    startLocal: text('start_local').notNull(),
    /** Local end `HH:mm` (24h). May be earlier than start (overnight). */
    endLocal: text('end_local').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantNameUk: uniqueIndex('hr_attendance_shifts_tenant_name_uk').on(table.tenantId, table.name),
    tenantIdx: index('hr_attendance_shifts_tenant_idx').on(table.tenantId),
  }),
);

export type HrAttendanceShift = typeof hrAttendanceShifts.$inferSelect;
export type NewHrAttendanceShift = typeof hrAttendanceShifts.$inferInsert;
