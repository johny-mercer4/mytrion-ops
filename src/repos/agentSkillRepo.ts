import { and, asc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { agentSkills, type AgentSkill, type NewAgentSkill } from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { toVectorLiteral } from './util.js';

function skillDepartmentFilter(ctx: TenantContext): SQL | undefined {
  if (ctx.allDepartmentAccess) return undefined;
  const col = agentSkills.departmentAccess;
  if (ctx.departments.length === 0) return isNull(col);
  return or(isNull(col), inArray(col, ctx.departments));
}

export const agentSkillRepo = {
  async insert(ctx: TenantContext, input: Omit<NewAgentSkill, 'tenantId' | 'audience'>): Promise<AgentSkill> {
    const [row] = await db
      .insert(agentSkills)
      .values({ ...input, tenantId: ctx.tenantId, audience: ctx.audience })
      .returning();
    if (!row) throw new Error('insert into agent_skills returned no row');
    return row;
  },

  async search(
    ctx: TenantContext,
    agentKey: string,
    embedding: number[],
    k: number,
  ): Promise<Array<AgentSkill & { score: number }>> {
    const literal = toVectorLiteral(embedding);
    const rows = await db
      .select({
        id: agentSkills.id,
        tenantId: agentSkills.tenantId,
        audience: agentSkills.audience,
        agentKey: agentSkills.agentKey,
        departmentAccess: agentSkills.departmentAccess,
        queryPattern: agentSkills.queryPattern,
        trajectoryJson: agentSkills.trajectoryJson,
        toolsUsed: agentSkills.toolsUsed,
        schemaVersion: agentSkills.schemaVersion,
        embedding: agentSkills.embedding,
        successCount: agentSkills.successCount,
        importance: agentSkills.importance,
        accessCount: agentSkills.accessCount,
        lastAccessedAt: agentSkills.lastAccessedAt,
        createdAt: agentSkills.createdAt,
        updatedAt: agentSkills.updatedAt,
        score: sql<number>`1 - (${agentSkills.embedding} <=> ${literal}::vector)`,
      })
      .from(agentSkills)
      .where(
        and(
          eq(agentSkills.tenantId, ctx.tenantId),
          eq(agentSkills.audience, ctx.audience),
          eq(agentSkills.agentKey, agentKey),
          eq(agentSkills.schemaVersion, '1'),
          skillDepartmentFilter(ctx),
        ),
      )
      .orderBy(sql`${agentSkills.embedding} <=> ${literal}::vector`)
      .limit(k);

    if (rows.length > 0) {
      await db
        .update(agentSkills)
        .set({
          accessCount: sql`${agentSkills.accessCount} + 1`,
          lastAccessedAt: sql`now()`,
          successCount: sql`${agentSkills.successCount}`,
        })
        .where(and(eq(agentSkills.tenantId, ctx.tenantId), inArray(agentSkills.id, rows.map((r) => r.id))));
    }
    return rows;
  },

  async bumpSuccess(ctx: TenantContext, id: string): Promise<void> {
    await db
      .update(agentSkills)
      .set({
        successCount: sql`${agentSkills.successCount} + 1`,
        importance: sql`LEAST(1.0, ${agentSkills.importance} + 0.05)`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(agentSkills.tenantId, ctx.tenantId), eq(agentSkills.id, id)));
  },

  async evictBeyondCap(ctx: TenantContext, agentKey: string, department: string | null, cap: number): Promise<void> {
    const deptCond =
      department === null ? isNull(agentSkills.departmentAccess) : eq(agentSkills.departmentAccess, department);
    const keep = db
      .select({ id: agentSkills.id })
      .from(agentSkills)
      .where(and(eq(agentSkills.tenantId, ctx.tenantId), eq(agentSkills.agentKey, agentKey), deptCond))
      .orderBy(sql`${agentSkills.importance} DESC`, asc(agentSkills.createdAt))
      .limit(cap);
    await db
      .delete(agentSkills)
      .where(
        and(
          eq(agentSkills.tenantId, ctx.tenantId),
          eq(agentSkills.agentKey, agentKey),
          deptCond,
          sql`${agentSkills.id} NOT IN (SELECT id FROM ${keep.as('keep')})`,
        ),
      );
  },
};
