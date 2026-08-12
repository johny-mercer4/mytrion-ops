import { createId } from '@paralleldrive/cuid2';
import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { MytrionAccessModes, MytrionId } from '../../lib/mytrions.js';

/**
 * mytrion_permission_sets — named, reusable, ADDITIVE grants, assigned to users.
 *
 * The Salesforce shape: a set is authored once ("Billing — Read Only", "Manager — Sales desk only")
 * and assigned to many people; a user's sets UNION together and union onto the three existing layers
 * (profile default → role default → per-user override). Nothing here ever subtracts.
 *
 * WHY A FOURTH LAYER RATHER THAN EXTENDING THE THIRD. The per-user override is per-user by
 * definition, so expressing "these forty agents get the same narrowed Billing" meant forty rows that
 * drift. A set is the reusable object that was missing.
 *
 * THREE THINGS A SET DELIBERATELY CANNOT DO:
 *
 *   1. Confer `allDepartmentAccess`. There is no column for it. A set is assigned to many users at
 *      once, so letting one raise all-access would escalate N people past the LAST_ADMIN rail in
 *      mytrionAccess.routes.ts, which only guards the explicit per-user path.
 *   2. Set `homeMytrion`. Home is single-valued and N sets would fight over it with no principled
 *      tiebreak. It stays on the three existing layers.
 *   3. Restrict anything. Additive means a set can only widen. In particular, `tabGrants` scoping is
 *      DEFEATED by any unscoped grant of the same Mytrion from any layer — assign "Billing, Ledger
 *      only" to someone whose profile default already grants Billing unscoped and every Billing tab
 *      still renders. That is the honest consequence of additivity, and the alternative ("any scoped
 *      source becomes a ceiling") reintroduces the non-expressible "everything except X" trap that
 *      `enforceableAllDept` already documents. The admin UI surfaces it in words instead of hiding it.
 *
 * No foreign keys — house rule. Orphaned assignments are tolerated and skipped by the resolver.
 */
export const mytrionPermissionSets = pgTable(
  'mytrion_permission_sets',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `mps_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    name: text('name').notNull(),
    /** trim+lowercase(name) — the uniqueness key, same convention as profileKey / roleKey. */
    key: text('key').notNull(),
    description: text('description'),
    /** Mytrions this set grants. Unioned with every other layer, never subtracted. */
    allowedMytrions: jsonb('allowed_mytrions').$type<MytrionId[]>().notNull().default([]),
    /**
     * read|full per granted Mytrion. Enforced for real — it reaches
     * `TenantContext.mytrionAccessModes` and `requireMytrionWrite`.
     *
     * Most permissive wins across layers: an explicit `full` here beats a per-user `read`. The
     * editor always writes an explicit mode for every grant, so this is never ambiguous.
     */
    mytrionAccessModes: jsonb('mytrion_access_modes')
      .$type<MytrionAccessModes>()
      .notNull()
      .default({}),
    /**
     * Per-Mytrion tab whitelist. A Mytrion ABSENT from this object is UNSCOPED — every tab it has,
     * including tabs added later. Only an explicitly present array scopes.
     *
     * That asymmetry is the whole rollout story. Existing sets and the majority of future ones carry
     * no entry, so a new tab appears for them automatically and nobody maintains anything. Fail-closed
     * applies only where an admin deliberately said "only these", which is exactly where a new tab
     * should require a decision rather than appearing unannounced.
     *
     * Tab keys are OPAQUE server-side: validated syntactically, never against a taxonomy. The tab
     * vocabulary lives in the frontend registry, and duplicating it here would turn "dynamic" into
     * "dynamic, after a server release" while buying no safety — tab grants are UI gating only.
     */
    tabGrants: jsonb('tab_grants')
      .$type<Partial<Record<MytrionId, string[]>>>()
      .notNull()
      .default({}),
    /**
     * OVERRIDE — the escape hatch from additivity.
     *
     * Additive is the safe default and it has one honest limitation: a set that scopes Billing to
     * Ledger is defeated by any unscoped Billing grant from a lower layer, because a union cannot
     * narrow. That is correct for "give these people a bit more", and useless for "these people get
     * EXACTLY this and nothing else".
     *
     * With this on, the permission-set layer becomes authoritative for whoever holds it: the sets'
     * grants, modes and tab scopes REPLACE the profile default, the role default and the per-user
     * override rather than unioning onto them. Precedence becomes
     *   1. permission sets  2. per-user override  3. profile / role defaults
     * which is the order an admin reads off this screen.
     *
     * Two things it deliberately cannot do. Env-named break-glass users stay immune, because that is
     * the recovery path if someone scopes themselves out of the app. And denies still subtract last,
     * so an override set can never re-grant something explicitly denied.
     */
    override: boolean('override').notNull().default(false),
    active: boolean('active').notNull().default(true),
    createdByZohoUserId: text('created_by_zoho_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantKeyUk: uniqueIndex('mytrion_permission_sets_tenant_key_uk').on(table.tenantId, table.key),
    tenantIdx: index('mytrion_permission_sets_tenant_idx').on(table.tenantId),
  }),
);

/**
 * mytrion_permission_set_assignments — which users hold which sets.
 *
 * `userName` / `email` are a denormalized CRM snapshot for display and audit only, the same posture
 * as worker_mytrion_access: the assignment is keyed on `zohoUserId`, and a stale name must never be
 * able to change who is granted what.
 */
export const mytrionPermissionSetAssignments = pgTable(
  'mytrion_permission_set_assignments',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `mpsa_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    permissionSetId: text('permission_set_id').notNull(),
    zohoUserId: text('zoho_user_id').notNull(),
    userName: text('user_name'),
    email: text('email'),
    assignedByZohoUserId: text('assigned_by_zoho_user_id'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    memberUk: uniqueIndex('mps_assignments_set_user_uk').on(
      table.tenantId,
      table.permissionSetId,
      table.zohoUserId,
    ),
    /** "Which sets does this user hold" — the per-request resolve path. */
    userIdx: index('mps_assignments_user_idx').on(table.tenantId, table.zohoUserId),
    /** "Who holds this set" — the admin listing and targeted cache invalidation. */
    setIdx: index('mps_assignments_set_idx').on(table.tenantId, table.permissionSetId),
  }),
);

export type MytrionPermissionSet = typeof mytrionPermissionSets.$inferSelect;
export type NewMytrionPermissionSet = typeof mytrionPermissionSets.$inferInsert;
export type MytrionPermissionSetAssignment = typeof mytrionPermissionSetAssignments.$inferSelect;
export type NewMytrionPermissionSetAssignment =
  typeof mytrionPermissionSetAssignments.$inferInsert;
