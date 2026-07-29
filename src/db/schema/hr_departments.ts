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
 * hr_departments — Mytrion HR org departments (own DB; migrated from Zoho People `department` form).
 *
 * Zoho fields (live components 2026-07-28):
 *   Department (name, mandatory) · Department_Code · MailAlias ·
 *   Department_Lead (+.ID, .MailID) · Parent_Department (+.ID)
 *
 * Isolation + integrity live in `hrDepartmentRepo` (tenant_id on every query).
 */
export const hrDepartments = pgTable(
  'hr_departments',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `hrd_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    /** Zoho People department form record id — null for manually created rows. */
    zohoRecordId: text('zoho_record_id'),
    /** Display name (Zoho `Department`). */
    name: text('name').notNull(),
    /** Zoho `Department_Code`. */
    code: text('code'),
    /** Zoho `MailAlias`. */
    mailAlias: text('mail_alias'),
    /** Zoho `Department_Lead` display. */
    leadName: text('lead_name'),
    leadZohoId: text('lead_zoho_id'),
    leadEmail: text('lead_email'),
    /** Zoho `Parent_Department` display. */
    parentName: text('parent_name'),
    parentZohoId: text('parent_zoho_id'),
    /** FK → hr_departments.id (resolved from parentZohoId). Roots have null. */
    parentId: text('parent_id'),
    /** Free-text purpose of the department — shown on the org-canvas node detail. */
    description: text('description'),
    /**
     * Allow-listed lucide-react component NAME (e.g. 'Building2'), never raw SVG markup — rendering
     * user-supplied SVG would be an injection surface for no benefit.
     */
    icon: text('icon'),
    /** A Horizon tone TOKEN name (e.g. 'tone-sky'), not a raw hex, so departments stay on-palette. */
    iconColor: text('icon_color'),
    /** Canvas position once a user drags the node. Null = let the auto-layout place it. */
    canvasX: integer('canvas_x'),
    canvasY: integer('canvas_y'),
    /** `zoho_people` | `manual` */
    source: text('source').notNull().default('manual'),
    rawFields: jsonb('raw_fields').$type<Record<string, unknown>>(),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantNameIdx: index('hr_departments_tenant_name_idx').on(table.tenantId, table.name),
    zohoUk: uniqueIndex('hr_departments_tenant_zoho_uk')
      .on(table.tenantId, table.zohoRecordId)
      .where(sql`${table.zohoRecordId} IS NOT NULL`),
    nameUk: uniqueIndex('hr_departments_tenant_name_uk').on(table.tenantId, table.name),
    parentIdx: index('hr_departments_tenant_parent_idx').on(table.tenantId, table.parentId),
  }),
);

export type HrDepartment = typeof hrDepartments.$inferSelect;
export type NewHrDepartment = typeof hrDepartments.$inferInsert;
