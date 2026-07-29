import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
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
    /** Telegram handle, stored BARE — no leading '@', no t.me/ prefix. The UI renders the '@'. */
    telegramUsername: text('telegram_username'),
    reportingTo: text('reporting_to'),
    reportingToZohoId: text('reporting_to_zoho_id'),
    /**
     * FK → hr_employees.id — the manager as a STABLE ID, which `reportingTo` (a display name) can
     * never be. The org canvas re-parents people by dragging one node onto another, so the link has
     * to survive a rename; matching on name would silently detach everyone the moment HR fixes a
     * typo, and would fan out across the two "Aziz Karimov"s the directory already has.
     *
     * Resolved from `reportingTo` only when the name matches EXACTLY ONE other employee (see
     * `resolveManagerEmployeeId`); ambiguous names stay null and the person renders as a root.
     */
    reportingToEmployeeId: text('reporting_to_employee_id'),
    /**
     * Zoho People's `Photo_downloadUrl`. OAuth-gated, so a browser `<img src>` gets a 401 — this is why
     * avatars render broken. Kept for provenance; `photoFileId` is what the UI should use.
     */
    photoUrl: text('photo_url'),
    /** Our own re-hosted avatar → `file_assets.id`. Served as a presigned URL, which an `<img>` can load. */
    photoFileId: text('photo_file_id'),
    /**
     * Zoho CRM user id of the person who signs in AS this employee — the anchor for HR RBAC.
     *
     * Two different Zoho products, two id spaces: `zohoRecordId` above is a Zoho PEOPLE record, while
     * portal sign-in is Zoho CRM OAuth. Nothing links them, so this is resolved by matching work
     * EMAIL (case-insensitive, trimmed) — the only field both sides carry. Null means "not resolved",
     * which HR RBAC must treat as no access rather than as a wildcard.
     *
     * A link is only written when the email matches EXACTLY ONE CRM user and EXACTLY ONE employee;
     * anything ambiguous is left null and reported, because a wrong link here shows one person another
     * person's private record.
     */
    zohoUserId: text('zoho_user_id'),
    /** How `zohoUserId` was set: `email_match` (automatic) | `manual` (an admin bound it). */
    zohoUserIdSource: text('zoho_user_id_source'),
    /** When the link was last (re)resolved — so a stale mapping is visible. */
    zohoUserLinkedAt: timestamp('zoho_user_linked_at', { withTimezone: true }),
    /**
     * Org-canvas position, once a user drags this person's node. Null = let the auto-layout place
     * them, which is what every row starts as. Mirrors hr_departments.canvas_x/y so both node levels
     * on the canvas persist the same way.
     */
    canvasX: integer('canvas_x'),
    canvasY: integer('canvas_y'),
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
    /** Plain, NOT unique — two people can legitimately share a handle blank, and duplicates are a
     *  data-quality question for HR to resolve, not a reason to reject a save. */
    telegramIdx: index('hr_employees_tenant_telegram_idx').on(table.tenantId, table.telegramUsername),
    /**
     * One CRM user maps to AT MOST one employee. Without this the mapping could fan out and two
     * employee rows would both answer "who is this session", which is an RBAC hole rather than a
     * data-quality nit.
     */
    zohoUserUk: uniqueIndex('hr_employees_tenant_zoho_user_uk')
      .on(table.tenantId, table.zohoUserId)
      .where(sql`${table.zohoUserId} IS NOT NULL`),
    deptIdIdx: index('hr_employees_tenant_dept_id_idx').on(table.tenantId, table.departmentId),
    deptZohoIdx: index('hr_employees_tenant_dept_zoho_idx').on(table.tenantId, table.departmentZohoId),
    /** The org canvas walks children-by-manager for every node; without this that is a table scan per node. */
    managerIdx: index('hr_employees_tenant_manager_idx').on(table.tenantId, table.reportingToEmployeeId),
  }),
);

export type HrEmployee = typeof hrEmployees.$inferSelect;
export type NewHrEmployee = typeof hrEmployees.$inferInsert;
