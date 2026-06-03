import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { conversations, type Conversation } from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow, firstOrUndefined, normalizePagination } from './util.js';

export const conversationRepo = {
  async create(ctx: TenantContext, input?: { title?: string }): Promise<Conversation> {
    const values: typeof conversations.$inferInsert = {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      audience: ctx.audience,
    };
    if (input?.title !== undefined) values.title = input.title;
    const rows = await db.insert(conversations).values(values).returning();
    return firstOrThrow(rows, 'Failed to create conversation');
  },

  /**
   * Scoped by tenant AND owner — a user only ever resolves their own conversations.
   * Returns undefined for another tenant's or another user's conversation (no leak).
   */
  async findOwned(ctx: TenantContext, id: string): Promise<Conversation | undefined> {
    const rows = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, id),
          eq(conversations.tenantId, ctx.tenantId),
          eq(conversations.userId, ctx.userId),
        ),
      )
      .limit(1);
    return firstOrUndefined(rows);
  },

  async listForUser(
    ctx: TenantContext,
    page?: { limit?: number; offset?: number },
  ): Promise<Conversation[]> {
    const { limit, offset } = normalizePagination(page);
    return db
      .select()
      .from(conversations)
      .where(and(eq(conversations.tenantId, ctx.tenantId), eq(conversations.userId, ctx.userId)))
      .orderBy(desc(conversations.updatedAt))
      .limit(limit)
      .offset(offset);
  },

  async touch(ctx: TenantContext, id: string): Promise<void> {
    await db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(and(eq(conversations.id, id), eq(conversations.tenantId, ctx.tenantId)));
  },

  async setTitle(ctx: TenantContext, id: string, title: string): Promise<void> {
    await db
      .update(conversations)
      .set({ title, updatedAt: new Date() })
      .where(
        and(
          eq(conversations.id, id),
          eq(conversations.tenantId, ctx.tenantId),
          eq(conversations.userId, ctx.userId),
        ),
      );
  },
};
