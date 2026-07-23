import { createId } from '@paralleldrive/cuid2';
import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { MytrionAccessModes, MytrionId } from '../../lib/mytrions.js';

/**
 * worker_mytrion_access — one row per (tenant, Zoho user) access OVERRIDE, layered on top of the
 * profile default (mytrion_profile_defaults). Keyed by the stable `zohoUserId` (the `zoho:<id>`
 * principal, id-part only). userName/email/profileName are a denormalized CRM snapshot for display
 * + audit, refreshed on save.
 *
 * Semantics (see mytrionAccessService.resolveWorkerAccess):
 *  - allowedMytrions NULL  → inherit the profile default's allowed set; non-null → REPLACE it.
 *  - deniedMytrions        → subtracted last (applies even to all-access), never null (default []).
 *  - allDepartmentAccess NULL → inherit; true/false → explicit override (but an env-marker admin
 *    is always pinned to all-access by the resolver — the DB can never lock a real admin out).
 *  - homeMytrion           → per-user auto-route landing override.
 *  - mytrionAccessModes    → per-Mytrion read|full; user explicit mode wins over role mode.
 *
 * No FKs (house rule); MytrionId values validated in the repo/Zod layer.
 */
export const workerMytrionAccess = pgTable(
  'worker_mytrion_access',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `wma_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    zohoUserId: text('zoho_user_id').notNull(),
    userName: text('user_name'),
    email: text('email'),
    profileName: text('profile_name'),
    /** NULL = inherit profile default; non-null = explicit replacement set. */
    allowedMytrions: jsonb('allowed_mytrions').$type<MytrionId[]>(),
    /** Subtractive, applied last. Never null. */
    deniedMytrions: jsonb('denied_mytrions').$type<MytrionId[]>().notNull().default([]),
    homeMytrion: text('home_mytrion').$type<MytrionId>(),
    /** NULL = inherit; true/false = explicit (env-marker admins are pinned true regardless). */
    allDepartmentAccess: boolean('all_department_access'),
    /** Zoho user ids this (possibly non-admin) worker may "View as" — targeted impersonation grant. */
    viewAsUserIds: jsonb('view_as_user_ids').$type<string[]>().notNull().default([]),
    /** Per-Mytrion read|full; omitted ids inherit role mode or default to full. */
    mytrionAccessModes: jsonb('mytrion_access_modes').$type<MytrionAccessModes>().notNull().default({}),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantUserUk: uniqueIndex('worker_mytrion_access_tenant_user_uk').on(
      table.tenantId,
      table.zohoUserId,
    ),
    tenantIdx: index('worker_mytrion_access_tenant_idx').on(table.tenantId),
  }),
);

export type WorkerMytrionAccess = typeof workerMytrionAccess.$inferSelect;
export type NewWorkerMytrionAccess = typeof workerMytrionAccess.$inferInsert;
