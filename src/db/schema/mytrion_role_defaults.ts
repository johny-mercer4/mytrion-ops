import { createId } from '@paralleldrive/cuid2';
import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { MytrionAccessModes, MytrionId } from '../../lib/mytrions.js';

/**
 * mytrion_role_defaults — one row per (tenant, Zoho CRM role). DEFAULT Mytrion access a worker
 * gets from their CRM role (e.g. "Collections Agent" → Billing), layered on top of the profile
 * default and below any per-user override (worker_mytrion_access). `roleKey` is trim+lowercase;
 * `roleName` is display. Same grant shape as profile defaults: specific Mytrions, home auto-route,
 * or all-department (Full Mytrions). `mytrionAccessModes` sets read|full per Mytrion (Billing
 * first). Editable from Admin → User Management → Role Defaults.
 */
export const mytrionRoleDefaults = pgTable(
  'mytrion_role_defaults',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `rd_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    roleName: text('role_name').notNull(),
    roleKey: text('role_key').notNull(),
    allowedMytrions: jsonb('allowed_mytrions').$type<MytrionId[]>().notNull().default([]),
    homeMytrion: text('home_mytrion').$type<MytrionId>(),
    allDepartmentAccess: boolean('all_department_access').notNull().default(false),
    /** Per-Mytrion read|full; omitted ids default to full when granted. */
    mytrionAccessModes: jsonb('mytrion_access_modes').$type<MytrionAccessModes>().notNull().default({}),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantRoleUk: uniqueIndex('mytrion_role_defaults_tenant_role_uk').on(table.tenantId, table.roleKey),
    tenantIdx: index('mytrion_role_defaults_tenant_idx').on(table.tenantId),
  }),
);

export type MytrionRoleDefault = typeof mytrionRoleDefaults.$inferSelect;
export type NewMytrionRoleDefault = typeof mytrionRoleDefaults.$inferInsert;
