import { and, asc, eq, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { agentMemories, type AgentMemory, type NewAgentMemory } from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { toVectorLiteral } from './util.js';

/** Same department semantics as knowledge retrieval: NULL (global) + the caller's departments. */
function memoryDepartmentFilter(ctx: TenantContext): SQL | undefined {
  if (ctx.allDepartmentAccess) return undefined;
  const col = agentMemories.departmentAccess;
  if (ctx.departments.length === 0) return isNull(col);
  return or(isNull(col), inArray(col, ctx.departments));
}

export const memoryRepo = {
  async insert(ctx: TenantContext, input: Omit<NewAgentMemory, 'tenantId' | 'audience'>): Promise<AgentMemory> {
    const [row] = await db
      .insert(agentMemories)
      .values({ ...input, tenantId: ctx.tenantId, audience: ctx.audience })
      .returning();
    if (!row) throw new Error('insert into agent_memories returned no row');
    return row;
  },

  /** Exposed builder so the RBAC suite can assert the WHERE offline. */
  buildSearchQuery(ctx: TenantContext, agentKey: string, embedding: number[], k: number) {
    const literal = toVectorLiteral(embedding);
    return db
      .select({
        id: agentMemories.id,
        content: agentMemories.content,
        kind: agentMemories.kind,
        importance: agentMemories.importance,
        score: sql<number>`1 - (${agentMemories.embedding} <=> ${literal}::vector)`,
      })
      .from(agentMemories)
      .where(
        and(
          eq(agentMemories.tenantId, ctx.tenantId),
          eq(agentMemories.audience, ctx.audience),
          eq(agentMemories.agentKey, agentKey),
          memoryDepartmentFilter(ctx),
        ),
      )
      .orderBy(sql`${agentMemories.embedding} <=> ${literal}::vector`)
      .limit(k);
  },

  async search(ctx: TenantContext, agentKey: string, embedding: number[], k: number) {
    const rows = await this.buildSearchQuery(ctx, agentKey, embedding, k);
    if (rows.length > 0) {
      await db
        .update(agentMemories)
        .set({ accessCount: sql`${agentMemories.accessCount} + 1`, lastAccessedAt: sql`now()` })
        .where(and(eq(agentMemories.tenantId, ctx.tenantId), inArray(agentMemories.id, rows.map((r) => r.id))));
    }
    return rows;
  },

  /** Keep at most `cap` rows per (agent, department): evict the least important beyond it. */
  async evictBeyondCap(ctx: TenantContext, agentKey: string, department: string | null, cap: number): Promise<void> {
    const deptCond =
      department === null ? isNull(agentMemories.departmentAccess) : eq(agentMemories.departmentAccess, department);
    const keep = db
      .select({ id: agentMemories.id })
      .from(agentMemories)
      .where(and(eq(agentMemories.tenantId, ctx.tenantId), eq(agentMemories.agentKey, agentKey), deptCond))
      .orderBy(sql`${agentMemories.importance} DESC`, asc(agentMemories.createdAt))
      .limit(cap);
    await db
      .delete(agentMemories)
      .where(
        and(
          eq(agentMemories.tenantId, ctx.tenantId),
          eq(agentMemories.agentKey, agentKey),
          deptCond,
          sql`${agentMemories.id} NOT IN (SELECT id FROM ${keep.as('keep')})`,
        ),
      );
  },

  /** Daily decay: exponential half-life; delete the expired and the faded. */
  async decayAndEvict(halflifeDays: number): Promise<number> {
    await db
      .update(agentMemories)
      .set({ importance: sql`${agentMemories.importance} * exp(-0.6931 / ${halflifeDays})` });
    const removed = await db
      .delete(agentMemories)
      .where(or(lt(agentMemories.importance, 0.05), sql`${agentMemories.expiresAt} < now()`))
      .returning({ id: agentMemories.id });
    return removed.length;
  },
};
