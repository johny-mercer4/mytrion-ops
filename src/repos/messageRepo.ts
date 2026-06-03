import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { messages, type Message, type NewMessage } from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow, normalizePagination } from './util.js';

export interface AppendMessageInput {
  conversationId: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: unknown;
  toolCallId?: string;
  name?: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
}

export const messageRepo = {
  async append(ctx: TenantContext, input: AppendMessageInput): Promise<Message> {
    // Build the insert object without explicit `undefined` (exactOptionalPropertyTypes).
    const values: NewMessage = {
      tenantId: ctx.tenantId,
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
    };
    if (input.toolCalls !== undefined) values.toolCalls = input.toolCalls;
    if (input.toolCallId !== undefined) values.toolCallId = input.toolCallId;
    if (input.name !== undefined) values.name = input.name;
    if (input.model !== undefined) values.model = input.model;
    if (input.promptTokens !== undefined) values.promptTokens = input.promptTokens;
    if (input.completionTokens !== undefined) values.completionTokens = input.completionTokens;

    const rows = await db.insert(messages).values(values).returning();
    return firstOrThrow(rows, 'Failed to persist message');
  },

  /** The most recent `limit` messages, returned oldest-first (for prompt assembly). */
  async recent(ctx: TenantContext, conversationId: string, limit: number): Promise<Message[]> {
    const rows = await db
      .select()
      .from(messages)
      .where(
        and(eq(messages.tenantId, ctx.tenantId), eq(messages.conversationId, conversationId)),
      )
      .orderBy(desc(messages.createdAt))
      .limit(Math.max(1, limit));
    return rows.reverse();
  },

  /**
   * Conversation history in chronological order, tenant-scoped. The caller must
   * have already verified conversation ownership (conversationRepo.findOwned).
   */
  async listByConversation(
    ctx: TenantContext,
    conversationId: string,
    page?: { limit?: number; offset?: number },
  ): Promise<Message[]> {
    const { limit, offset } = normalizePagination(page);
    return db
      .select()
      .from(messages)
      .where(
        and(eq(messages.tenantId, ctx.tenantId), eq(messages.conversationId, conversationId)),
      )
      .orderBy(asc(messages.createdAt))
      .limit(limit)
      .offset(offset);
  },
};
