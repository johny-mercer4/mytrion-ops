import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  mytrionPermissionSetAssignments,
  mytrionPermissionSets,
  type MytrionPermissionSet,
  type MytrionPermissionSetAssignment,
  type NewMytrionPermissionSet,
  type NewMytrionPermissionSetAssignment,
} from '../db/schema/index.js';
import {
  isMytrionId,
  toMytrionAccessModes,
  toMytrionIds,
  type MytrionAccessMode,
  type MytrionAccessModes,
  type MytrionId,
} from '../lib/mytrions.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow } from './util.js';

export type TabGrants = Partial<Record<MytrionId, string[]>>;

export interface MytrionPermissionSetDto {
  id: string;
  name: string;
  key: string;
  description: string | null;
  allowedMytrions: MytrionId[];
  mytrionAccessModes: MytrionAccessModes;
  tabGrants: TabGrants;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MytrionPermissionSetAssignmentDto {
  id: string;
  permissionSetId: string;
  zohoUserId: string;
  userName: string | null;
  email: string | null;
  active: boolean;
  createdAt: string;
}

/** trim+lowercase, the same convention as profileKey / roleKey. */
export function permissionSetKeyOf(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Sanitise stored tab grants.
 *
 * Mytrion keys are validated against the taxonomy (that half is enforced, so it stays closed). Tab
 * keys are NOT — they are opaque strings server-side, checked only for shape. Duplicating the tab
 * vocabulary here would buy no safety (tab grants are UI gating) and would turn the requirement's
 * "dynamic" into "dynamic, after a server release".
 */
export function toTabGrants(value: unknown): TabGrants {
  if (typeof value !== 'object' || value === null) return {};
  const out: TabGrants = {};
  for (const [id, keys] of Object.entries(value as Record<string, unknown>)) {
    if (!isMytrionId(id) || !Array.isArray(keys)) continue;
    const clean = [...new Set(keys.filter((k): k is string => typeof k === 'string' && k !== ''))];
    out[id] = clean;
  }
  return out;
}

function toDto(row: MytrionPermissionSet): MytrionPermissionSetDto {
  return {
    id: row.id,
    name: row.name,
    key: row.key,
    description: row.description ?? null,
    allowedMytrions: toMytrionIds(row.allowedMytrions),
    mytrionAccessModes: toMytrionAccessModes(row.mytrionAccessModes),
    tabGrants: toTabGrants(row.tabGrants),
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toAssignmentDto(
  row: MytrionPermissionSetAssignment,
): MytrionPermissionSetAssignmentDto {
  return {
    id: row.id,
    permissionSetId: row.permissionSetId,
    zohoUserId: row.zohoUserId,
    userName: row.userName ?? null,
    email: row.email ?? null,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface CreatePermissionSetInput {
  name: string;
  description?: string | null;
  allowedMytrions?: MytrionId[];
  mytrionAccessModes?: MytrionAccessModes;
  tabGrants?: TabGrants;
  createdByZohoUserId?: string | null;
}

export const mytrionPermissionSetsRepo = {
  /** Every set for the tenant, by name. Tens of rows — the admin screen loads them all. */
  async list(ctx: TenantContext): Promise<MytrionPermissionSetDto[]> {
    const rows = await db
      .select()
      .from(mytrionPermissionSets)
      .where(eq(mytrionPermissionSets.tenantId, ctx.tenantId))
      .orderBy(asc(mytrionPermissionSets.name));
    return rows.map(toDto);
  },

  /**
   * Active sets only — the resolver path.
   *
   * A tenant-wide read of the same character as `mytrionProfileDefaultsRepo.list`, which the batch
   * resolver already does per call. Reading all of them and filtering in memory keeps
   * `computeAccess` to ONE round trip for sets instead of the sequential
   * assignments-then-sets-by-id pair, which would double cache-miss latency on the hot auth path.
   */
  async listActive(ctx: TenantContext): Promise<MytrionPermissionSetDto[]> {
    const rows = await db
      .select()
      .from(mytrionPermissionSets)
      .where(
        and(
          eq(mytrionPermissionSets.tenantId, ctx.tenantId),
          eq(mytrionPermissionSets.active, true),
        ),
      )
      .orderBy(asc(mytrionPermissionSets.name));
    return rows.map(toDto);
  },

  async findById(ctx: TenantContext, id: string): Promise<MytrionPermissionSetDto | undefined> {
    const rows = await db
      .select()
      .from(mytrionPermissionSets)
      .where(and(eq(mytrionPermissionSets.tenantId, ctx.tenantId), eq(mytrionPermissionSets.id, id)))
      .limit(1);
    return rows[0] ? toDto(rows[0]) : undefined;
  },

  async create(
    ctx: TenantContext,
    input: CreatePermissionSetInput,
  ): Promise<MytrionPermissionSetDto> {
    const name = input.name.trim();
    const values: NewMytrionPermissionSet = {
      tenantId: ctx.tenantId,
      name,
      key: permissionSetKeyOf(name),
      description: input.description?.trim() || null,
      allowedMytrions: toMytrionIds(input.allowedMytrions ?? []),
      mytrionAccessModes: toMytrionAccessModes(input.mytrionAccessModes ?? {}),
      tabGrants: toTabGrants(input.tabGrants ?? {}),
      createdByZohoUserId: input.createdByZohoUserId ?? null,
    };
    const rows = await db.insert(mytrionPermissionSets).values(values).returning();
    return toDto(firstOrThrow(rows, 'Failed to create permission set'));
  },

  /** Name / description / active. Grants are edited per Mytrion — see `setMytrionGrant`. */
  async updateMeta(
    ctx: TenantContext,
    id: string,
    patch: { name?: string; description?: string | null; active?: boolean },
  ): Promise<MytrionPermissionSetDto | undefined> {
    const set: Partial<NewMytrionPermissionSet> = { updatedAt: new Date() };
    if (patch.name !== undefined) {
      set.name = patch.name.trim();
      set.key = permissionSetKeyOf(patch.name);
    }
    if (patch.description !== undefined) set.description = patch.description?.trim() || null;
    if (patch.active !== undefined) set.active = patch.active;

    const rows = await db
      .update(mytrionPermissionSets)
      .set(set)
      .where(and(eq(mytrionPermissionSets.tenantId, ctx.tenantId), eq(mytrionPermissionSets.id, id)))
      .returning();
    return rows[0] ? toDto(rows[0]) : undefined;
  },

  /**
   * Grant (or re-scope) ONE Mytrion on a set.
   *
   * Rewrites just that key of the two jsonb columns with `jsonb_set`, in the UPDATE itself rather
   * than read-modify-write in JS. Two admins editing two different Mytrions of the same set is a
   * realistic concurrent edit — the editor PATCHes per row, by design — and read-modify-write would
   * silently drop whichever write landed second.
   *
   * `tabs: null` UNSCOPES the Mytrion (removes the key), which is not the same as `tabs: []`: absent
   * means "every tab, including future ones", empty means "no tabs at all".
   */
  async setMytrionGrant(
    ctx: TenantContext,
    id: string,
    mytrionId: MytrionId,
    grant: { mode: MytrionAccessMode; tabs: string[] | null },
  ): Promise<MytrionPermissionSetDto | undefined> {
    const tabsExpr =
      grant.tabs === null
        ? sql`${mytrionPermissionSets.tabGrants} - ${mytrionId}`
        : sql`jsonb_set(${mytrionPermissionSets.tabGrants}, ${sql.raw(`'{${mytrionId}}'`)}, ${JSON.stringify([...new Set(grant.tabs)])}::jsonb, true)`;

    const rows = await db
      .update(mytrionPermissionSets)
      .set({
        // `||` on a jsonb array appends; `- value` then re-append would reorder. Rebuild instead:
        // the set is small and order is display-only.
        allowedMytrions: sql`(
          SELECT COALESCE(jsonb_agg(DISTINCT elem), '[]'::jsonb)
          FROM jsonb_array_elements(${mytrionPermissionSets.allowedMytrions} || ${JSON.stringify([mytrionId])}::jsonb) AS elem
        )`,
        mytrionAccessModes: sql`jsonb_set(${mytrionPermissionSets.mytrionAccessModes}, ${sql.raw(`'{${mytrionId}}'`)}, ${JSON.stringify(grant.mode)}::jsonb, true)`,
        tabGrants: tabsExpr,
        updatedAt: new Date(),
      })
      .where(and(eq(mytrionPermissionSets.tenantId, ctx.tenantId), eq(mytrionPermissionSets.id, id)))
      .returning();
    return rows[0] ? toDto(rows[0]) : undefined;
  },

  /** Revoke one Mytrion from a set, dropping its mode and tab scope with it. */
  async removeMytrionGrant(
    ctx: TenantContext,
    id: string,
    mytrionId: MytrionId,
  ): Promise<MytrionPermissionSetDto | undefined> {
    const rows = await db
      .update(mytrionPermissionSets)
      .set({
        allowedMytrions: sql`(
          SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
          FROM jsonb_array_elements(${mytrionPermissionSets.allowedMytrions}) AS elem
          WHERE elem <> ${JSON.stringify(mytrionId)}::jsonb
        )`,
        mytrionAccessModes: sql`${mytrionPermissionSets.mytrionAccessModes} - ${mytrionId}`,
        tabGrants: sql`${mytrionPermissionSets.tabGrants} - ${mytrionId}`,
        updatedAt: new Date(),
      })
      .where(and(eq(mytrionPermissionSets.tenantId, ctx.tenantId), eq(mytrionPermissionSets.id, id)))
      .returning();
    return rows[0] ? toDto(rows[0]) : undefined;
  },

  async remove(ctx: TenantContext, id: string): Promise<boolean> {
    const rows = await db
      .delete(mytrionPermissionSets)
      .where(and(eq(mytrionPermissionSets.tenantId, ctx.tenantId), eq(mytrionPermissionSets.id, id)))
      .returning({ id: mytrionPermissionSets.id });
    // Assignments are deleted alongside — there are no FKs, so nothing cascades for us.
    if (rows.length > 0) {
      await db
        .delete(mytrionPermissionSetAssignments)
        .where(
          and(
            eq(mytrionPermissionSetAssignments.tenantId, ctx.tenantId),
            eq(mytrionPermissionSetAssignments.permissionSetId, id),
          ),
        );
    }
    return rows.length > 0;
  },
};

export const mytrionPermissionSetAssignmentsRepo = {
  /** The sets one worker holds. Indexed on (tenant, zoho_user_id) — the resolve path. */
  async listByZohoUserId(
    ctx: TenantContext,
    zohoUserId: string,
  ): Promise<MytrionPermissionSetAssignmentDto[]> {
    const rows = await db
      .select()
      .from(mytrionPermissionSetAssignments)
      .where(
        and(
          eq(mytrionPermissionSetAssignments.tenantId, ctx.tenantId),
          eq(mytrionPermissionSetAssignments.zohoUserId, zohoUserId),
          eq(mytrionPermissionSetAssignments.active, true),
        ),
      );
    return rows.map(toAssignmentDto);
  },

  /** Every active assignment for the tenant — one bulk read for `resolveBatch`. */
  async listAllActive(ctx: TenantContext): Promise<MytrionPermissionSetAssignmentDto[]> {
    const rows = await db
      .select()
      .from(mytrionPermissionSetAssignments)
      .where(
        and(
          eq(mytrionPermissionSetAssignments.tenantId, ctx.tenantId),
          eq(mytrionPermissionSetAssignments.active, true),
        ),
      );
    return rows.map(toAssignmentDto);
  },

  /** Who holds a given set — the admin screen. */
  async listBySetId(
    ctx: TenantContext,
    permissionSetId: string,
  ): Promise<MytrionPermissionSetAssignmentDto[]> {
    const rows = await db
      .select()
      .from(mytrionPermissionSetAssignments)
      .where(
        and(
          eq(mytrionPermissionSetAssignments.tenantId, ctx.tenantId),
          eq(mytrionPermissionSetAssignments.permissionSetId, permissionSetId),
        ),
      )
      .orderBy(asc(mytrionPermissionSetAssignments.userName));
    return rows.map(toAssignmentDto);
  },

  /** Assignment counts for a list of sets, for the list screen. */
  async countsBySetId(ctx: TenantContext, setIds: string[]): Promise<Record<string, number>> {
    if (setIds.length === 0) return {};
    const rows = await db
      .select({
        permissionSetId: mytrionPermissionSetAssignments.permissionSetId,
        count: sql<number>`count(*)::int`,
      })
      .from(mytrionPermissionSetAssignments)
      .where(
        and(
          eq(mytrionPermissionSetAssignments.tenantId, ctx.tenantId),
          eq(mytrionPermissionSetAssignments.active, true),
          inArray(mytrionPermissionSetAssignments.permissionSetId, setIds),
        ),
      )
      .groupBy(mytrionPermissionSetAssignments.permissionSetId);
    return Object.fromEntries(rows.map((r) => [r.permissionSetId, r.count]));
  },

  async assign(
    ctx: TenantContext,
    input: {
      permissionSetId: string;
      zohoUserId: string;
      userName?: string | null;
      email?: string | null;
      assignedByZohoUserId?: string | null;
    },
  ): Promise<MytrionPermissionSetAssignmentDto> {
    const values: NewMytrionPermissionSetAssignment = {
      tenantId: ctx.tenantId,
      permissionSetId: input.permissionSetId,
      zohoUserId: input.zohoUserId,
      userName: input.userName ?? null,
      email: input.email ?? null,
      assignedByZohoUserId: input.assignedByZohoUserId ?? null,
      active: true,
    };
    const rows = await db
      .insert(mytrionPermissionSetAssignments)
      .values(values)
      .onConflictDoUpdate({
        target: [
          mytrionPermissionSetAssignments.tenantId,
          mytrionPermissionSetAssignments.permissionSetId,
          mytrionPermissionSetAssignments.zohoUserId,
        ],
        // Re-assigning someone previously removed reactivates the row and refreshes the snapshot,
        // rather than failing on the unique index.
        set: {
          active: true,
          userName: values.userName,
          email: values.email,
          assignedByZohoUserId: values.assignedByZohoUserId,
          updatedAt: new Date(),
        },
      })
      .returning();
    return toAssignmentDto(firstOrThrow(rows, 'Failed to assign permission set'));
  },

  async unassign(ctx: TenantContext, permissionSetId: string, zohoUserId: string): Promise<boolean> {
    const rows = await db
      .delete(mytrionPermissionSetAssignments)
      .where(
        and(
          eq(mytrionPermissionSetAssignments.tenantId, ctx.tenantId),
          eq(mytrionPermissionSetAssignments.permissionSetId, permissionSetId),
          eq(mytrionPermissionSetAssignments.zohoUserId, zohoUserId),
        ),
      )
      .returning({ id: mytrionPermissionSetAssignments.id });
    return rows.length > 0;
  },
};
