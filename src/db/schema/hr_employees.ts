import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * hr_employees — Mytrion HR's own employee directory (not a live Zoho People proxy).
 *
 * Rows may originate from:
 *   - Zoho People sync (`source = 'zoho_people'`, `zoho_record_id` set) — upserted by
 *     POST /v1/hr/employees/sync
 *   - Manual admin create (`source = 'manual'`, `zoho_record_id` null)
 *
 * Isolation + integrity live in `hrEmployeeRepo` (tenant_id on every query). `raw_fields`
 * keeps the full Zoho People payload for fields we don't project yet (tabularSections, etc.).
 */
export const hrEmployees = pgTable(
  'hr_employees',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `hre_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    /** Zoho People form record id — null for manually created rows. */
    zohoRecordId: text('zoho_record_id'),
    /** Org employee id (e.g. HRM02). Unique per tenant when present. */
    employeeId: text('employee_id'),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    email: text('email'),
    /** FK → hr_departments.id (resolved from Zoho Department.ID / name). */
    departmentId: text('department_id'),
    /** Denormalized department display name (kept in sync with departmentId). */
    department: text('department'),
    /** Zoho People Department.ID — used to re-link on sync. */
    departmentZohoId: text('department_zoho_id'),
    /**
     * Job title / designation — picklist values (distinct from employees), NOT a separate table.
     * Zoho also has a `designation` form; we store the label only.
     */
    designation: text('designation'),
    location: text('location'),
    /** Active | Terminated | … — free text matching Zoho Employeestatus. */
    status: text('status').notNull().default('Active'),
    role: text('role'),
    /** ISO date YYYY-MM-DD when known. */
    dateOfJoining: text('date_of_joining'),
    mobile: text('mobile'),
    reportingTo: text('reporting_to'),
    reportingToZohoId: text('reporting_to_zoho_id'),
    photoUrl: text('photo_url'),
    /** `zoho_people` | `manual` */
    source: text('source').notNull().default('manual'),
    /** Full Zoho People field bag (or last sync snapshot). */
    rawFields: jsonb('raw_fields').$type<Record<string, unknown>>(),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIdx: index('hr_employees_tenant_idx').on(table.tenantId, table.status, table.lastName),
    zohoUk: uniqueIndex('hr_employees_tenant_zoho_uk')
      .on(table.tenantId, table.zohoRecordId)
      .where(sql`${table.zohoRecordId} IS NOT NULL`),
    employeeIdUk: uniqueIndex('hr_employees_tenant_employee_id_uk')
      .on(table.tenantId, table.employeeId)
      .where(sql`${table.employeeId} IS NOT NULL`),
    emailIdx: index('hr_employees_tenant_email_idx').on(table.tenantId, table.email),
    deptIdIdx: index('hr_employees_tenant_dept_id_idx').on(table.tenantId, table.departmentId),
    deptZohoIdx: index('hr_employees_tenant_dept_zoho_idx').on(table.tenantId, table.departmentZohoId),
  }),
);

export type HrEmployee = typeof hrEmployees.$inferSelect;
export type NewHrEmployee = typeof hrEmployees.$inferInsert;
