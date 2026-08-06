import { desc, eq, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { ragRuns, type NewRagRun, type RagRun } from '../db/schema/rag_runs.js';
import type { TenantContext } from '../types/tenantContext.js';

export const ragRunRepo = {
  async record(ctx: TenantContext, entry: Omit<NewRagRun, 'tenantId' | 'userId'>): Promise<RagRun> {
    const [row] = await db
      .insert(ragRuns)
      .values({ ...entry, tenantId: ctx.tenantId, userId: ctx.userId })
      .returning();
    if (!row) throw new Error('insert into rag_runs returned no row');
    return row;
  },

  async listForConversation(ctx: TenantContext, conversationId: string, limit = 50): Promise<RagRun[]> {
    return db
      .select()
      .from(ragRuns)
      .where(and(eq(ragRuns.tenantId, ctx.tenantId), eq(ragRuns.conversationId, conversationId)))
      .orderBy(desc(ragRuns.createdAt))
      .limit(limit);
  },
};
