import { createId } from '@paralleldrive/cuid2';
import { date, index, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export type AttendancePunchKind = 'check_in' | 'check_out';
export type AttendancePunchSource = 'hikvision' | 'manual';

/**
 * Individual biometric / device attendance punches. Source of truth for Mytrion HR attendance —
 * no Zoho People write path.
 */
export const hrAttendancePunches = pgTable(
  'hr_attendance_punches',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `hrp_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    /** Null when FaceID did not match an employee — raw punch still stored for ops. */
    employeeId: text('employee_id'),
    faceId: text('face_id').notNull(),
    kind: text('kind').$type<AttendancePunchKind>().notNull(),
    punchedAt: timestamp('punched_at', { withTimezone: true }).notNull(),
    /** Attendance day in Asia/Tashkent (overnight shifts bucket by shift-start date). */
    workDate: date('work_date', { mode: 'string' }).notNull(),
    source: text('source').$type<AttendancePunchSource>().notNull().default('hikvision'),
    doorName: text('door_name'),
    note: text('note'),
    rawEvent: jsonb('raw_event').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    dedupUk: uniqueIndex('hr_attendance_punches_dedup_uk').on(
      table.tenantId,
      table.faceId,
      table.kind,
      table.punchedAt,
    ),
    tenantEmpDateIdx: index('hr_attendance_punches_tenant_emp_date_idx').on(
      table.tenantId,
      table.employeeId,
      table.workDate,
    ),
    tenantDateIdx: index('hr_attendance_punches_tenant_date_idx').on(table.tenantId, table.workDate),
    tenantFaceIdx: index('hr_attendance_punches_tenant_face_idx').on(table.tenantId, table.faceId),
  }),
);

export type HrAttendancePunch = typeof hrAttendancePunches.$inferSelect;
export type NewHrAttendancePunch = typeof hrAttendancePunches.$inferInsert;
