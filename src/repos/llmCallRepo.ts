import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { llmCalls, type LlmCall, type NewLlmCall } from '../db/schema/llm_calls.js';
import type { TenantContext } from '../types/tenantContext.js';

export const llmCallRepo = {
  async record(ctx: TenantContext, entry: Omit<NewLlmCall, 'tenantId' | 'userId'>): Promise<LlmCall> {
    const [row] = await db
      .insert(llmCalls)
      .values({ ...entry, tenantId: ctx.tenantId, userId: ctx.userId })
      .returning();
    if (!row) throw new Error('insert into llm_calls returned no row');
    return row;
  },

  async listForRun(ctx: TenantContext, agentRunId: string): Promise<LlmCall[]> {
    return db
      .select()
      .from(llmCalls)
      .where(and(eq(llmCalls.tenantId, ctx.tenantId), eq(llmCalls.agentRunId, agentRunId)))
      .orderBy(desc(llmCalls.createdAt));
  },
};
