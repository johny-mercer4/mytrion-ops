import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  scopeRiskItems,
  type ScopeRiskCategory,
  type ScopeRiskItem,
  type NewScopeRiskItem,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow } from './util.js';

/** Flat DTO returned to the widget (no tenantId; timestamps as ISO 8601). */
export interface ScopeRiskDto {
  id: string;
  nodeId: string;
  category: ScopeRiskCategory;
  label: string;
  icon: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScopeRiskInput {
  nodeId: string;
  category: ScopeRiskCategory;
  label: string;
  icon?: string | undefined;
  position?: number | undefined;
}

export interface UpdateScopeRiskInput {
  label?: string | undefined;
  icon?: string | undefined;
  category?: ScopeRiskCategory | undefined;
  position?: number | undefined;
}

function toDto(row: ScopeRiskItem): ScopeRiskDto {
  return {
    id: row.id,
    nodeId: row.nodeId,
    category: row.category,
    label: row.label,
    icon: row.icon,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Category display order (blocker, red_flag, manual) so list output matches the widget's panels.
const categoryRank = sql`case ${scopeRiskItems.category}
  when 'blocker' then 0 when 'red_flag' then 1 when 'manual' then 2 else 3 end`;

export const scopeRiskRepo = {
  /** All items for one node, ordered by category (blocker→red_flag→manual) then position. */
  async listByNode(ctx: TenantContext, nodeId: string): Promise<ScopeRiskDto[]> {
    const rows = await db
      .select()
      .from(scopeRiskItems)
      .where(and(eq(scopeRiskItems.tenantId, ctx.tenantId), eq(scopeRiskItems.nodeId, nodeId)))
      .orderBy(categoryRank, asc(scopeRiskItems.position), asc(scopeRiskItems.createdAt));
    return rows.map(toDto);
  },

  /** Every node's items (bulk preload), ordered by node, then category, then position. */
  async listAll(ctx: TenantContext): Promise<ScopeRiskDto[]> {
    const rows = await db
      .select()
      .from(scopeRiskItems)
      .where(eq(scopeRiskItems.tenantId, ctx.tenantId))
      .orderBy(
        asc(scopeRiskItems.nodeId),
        categoryRank,
        asc(scopeRiskItems.position),
        asc(scopeRiskItems.createdAt),
      );
    return rows.map(toDto);
  },

  /** Create one item. Without an explicit position it is appended within (nodeId, category). */
  async create(ctx: TenantContext, input: CreateScopeRiskInput): Promise<ScopeRiskDto> {
    const position = input.position ?? (await nextPosition(ctx, input.nodeId, input.category));
    const values: NewScopeRiskItem = {
      tenantId: ctx.tenantId,
      nodeId: input.nodeId,
      category: input.category,
      label: input.label,
      icon: input.icon ?? '',
      position,
    };
    const rows = await db.insert(scopeRiskItems).values(values).returning();
    return toDto(firstOrThrow(rows, 'Failed to insert scope risk item'));
  },

  /** Patch the provided fields (tenant-scoped). Returns null if no such id for this tenant. */
  async update(
    ctx: TenantContext,
    id: string,
    patch: UpdateScopeRiskInput,
  ): Promise<ScopeRiskDto | null> {
    const set: Partial<NewScopeRiskItem> = { updatedAt: new Date() };
    if (patch.label !== undefined) set.label = patch.label;
    if (patch.icon !== undefined) set.icon = patch.icon;
    if (patch.category !== undefined) set.category = patch.category;
    if (patch.position !== undefined) set.position = patch.position;
    const rows = await db
      .update(scopeRiskItems)
      .set(set)
      .where(and(eq(scopeRiskItems.id, id), eq(scopeRiskItems.tenantId, ctx.tenantId)))
      .returning();
    const row = rows[0];
    return row ? toDto(row) : null;
  },

  /** Delete one item (tenant-scoped). Returns true if a row was removed. */
  async deleteById(ctx: TenantContext, id: string): Promise<boolean> {
    const rows = await db
      .delete(scopeRiskItems)
      .where(and(eq(scopeRiskItems.id, id), eq(scopeRiskItems.tenantId, ctx.tenantId)))
      .returning({ id: scopeRiskItems.id });
    return rows.length > 0;
  },

  /** Delete many (tenant-scoped). Returns the ids actually removed. */
  async deleteMany(ctx: TenantContext, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await db
      .delete(scopeRiskItems)
      .where(and(eq(scopeRiskItems.tenantId, ctx.tenantId), inArray(scopeRiskItems.id, ids)))
      .returning({ id: scopeRiskItems.id });
    return rows.map((r) => r.id);
  },

  /** Count items for a node (used by the seed script to stay idempotent). */
  async countForNode(ctx: TenantContext, nodeId: string): Promise<number> {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(scopeRiskItems)
      .where(and(eq(scopeRiskItems.tenantId, ctx.tenantId), eq(scopeRiskItems.nodeId, nodeId)));
    return rows[0]?.count ?? 0;
  },
};

/** Next append position within (nodeId, category): current count in that group. */
async function nextPosition(
  ctx: TenantContext,
  nodeId: string,
  category: ScopeRiskCategory,
): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(scopeRiskItems)
    .where(
      and(
        eq(scopeRiskItems.tenantId, ctx.tenantId),
        eq(scopeRiskItems.nodeId, nodeId),
        eq(scopeRiskItems.category, category),
      ),
    );
  return rows[0]?.count ?? 0;
}
