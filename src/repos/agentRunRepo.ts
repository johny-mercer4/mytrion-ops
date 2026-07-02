import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { agentRuns, type AgentRun, type NewAgentRun } from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';

export const agentRunRepo = {
  /** Persist one orchestrator/child run (status + usage + cost). Tenant comes from ctx. */
  async record(ctx: TenantContext, entry: Omit<NewAgentRun, 'tenantId'>): Promise<AgentRun> {
    const [row] = await db
      .insert(agentRuns)
      .values({ ...entry, tenantId: ctx.tenantId })
      .returning();
    if (!row) throw new Error('insert into agent_runs returned no row');
    return row;
  },

  /** Recent runs for a conversation (attribution/debugging), tenant-scoped. */
  async listForConversation(ctx: TenantContext, conversationId: string, limit = 50): Promise<AgentRun[]> {
    return db
      .select()
      .from(agentRuns)
      .where(and(eq(agentRuns.tenantId, ctx.tenantId), eq(agentRuns.conversationId, conversationId)))
      .orderBy(desc(agentRuns.createdAt))
      .limit(limit);
  },
};
