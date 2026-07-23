import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { agentBlackboards, type AgentBlackboard } from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';

export const agentBlackboardRepo = {
  async get(ctx: TenantContext, conversationId: string): Promise<AgentBlackboard | null> {
    const [row] = await db
      .select()
      .from(agentBlackboards)
      .where(
        and(
          eq(agentBlackboards.tenantId, ctx.tenantId),
          eq(agentBlackboards.conversationId, conversationId),
        ),
      )
      .limit(1);
    return row ?? null;
  },

  async upsert(
    ctx: TenantContext,
    conversationId: string,
    payload: Record<string, unknown>,
  ): Promise<AgentBlackboard> {
    const existing = await this.get(ctx, conversationId);
    if (existing) {
      const [row] = await db
        .update(agentBlackboards)
        .set({ payload, updatedAt: new Date() })
        .where(
          and(
            eq(agentBlackboards.tenantId, ctx.tenantId),
            eq(agentBlackboards.id, existing.id),
          ),
        )
        .returning();
      if (!row) throw new Error('agent_blackboards update returned no row');
      return row;
    }
    const [row] = await db
      .insert(agentBlackboards)
      .values({
        tenantId: ctx.tenantId,
        audience: ctx.audience,
        conversationId,
        payload,
      })
      .returning();
    if (!row) throw new Error('agent_blackboards insert returned no row');
    return row;
  },
};
