import { createId } from '@paralleldrive/cuid2';
import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { MytrionId } from '../../lib/mytrions.js';

/**
 * mytrion_profile_defaults — one row per (tenant, Zoho profile). The DEFAULT Mytrion access a
 * worker gets purely from their CRM profile (e.g. "Sales Agent" → Sales), before any per-user
 * override (worker_mytrion_access). `profileKey` is the trim+lowercase match key; `profileName`
 * is the display form. `homeMytrion` is the auto-route landing target; `allDepartmentAccess`
 * lets a profile see everything. Editable from Admin → User Management → Profile Defaults.
 *
 * No FKs (house rule); MytrionId values are validated in the repo/Zod layer, not by the DB.
 */
export const mytrionProfileDefaults = pgTable(
  'mytrion_profile_defaults',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `pd_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    profileName: text('profile_name').notNull(),
    profileKey: text('profile_key').notNull(),
    allowedMytrions: jsonb('allowed_mytrions').$type<MytrionId[]>().notNull().default([]),
    homeMytrion: text('home_mytrion').$type<MytrionId>(),
    allDepartmentAccess: boolean('all_department_access').notNull().default(false),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantProfileUk: uniqueIndex('mytrion_profile_defaults_tenant_profile_uk').on(
      table.tenantId,
      table.profileKey,
    ),
    tenantIdx: index('mytrion_profile_defaults_tenant_idx').on(table.tenantId),
  }),
);

export type MytrionProfileDefault = typeof mytrionProfileDefaults.$inferSelect;
export type NewMytrionProfileDefault = typeof mytrionProfileDefaults.$inferInsert;
