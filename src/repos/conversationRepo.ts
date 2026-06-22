import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { conversations, messages, type Conversation } from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow, firstOrUndefined, normalizePagination } from './util.js';

export interface CreateConversationInput {
  title?: string | undefined;
  zohoUserId?: string | undefined;
  userName?: string | undefined;
  profile?: string | undefined;
  role?: string | undefined;
  departmentScope?: string | string[] | undefined;
}

export interface UpdateConversationInput {
  title?: string | undefined;
  departmentScope?: string | string[] | undefined;
}

export const conversationRepo = {
  async create(ctx: TenantContext, input: CreateConversationInput = {}): Promise<Conversation> {
    const values: typeof conversations.$inferInsert = {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      audience: ctx.audience,
    };
    if (input.title !== undefined) values.title = input.title;
    if (input.zohoUserId !== undefined) values.zohoUserId = input.zohoUserId;
    if (input.userName !== undefined) values.userName = input.userName;
    if (input.profile !== undefined) values.profile = input.profile;
    if (input.role !== undefined) values.role = input.role;
    if (input.departmentScope !== undefined) values.departmentScope = input.departmentScope;
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

  /** Tenant-scoped lookup by id (for the admin widget's CRUD: fetch/update/delete by id). */
  async findById(ctx: TenantContext, id: string): Promise<Conversation | undefined> {
    const rows = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.tenantId, ctx.tenantId)))
      .limit(1);
    return firstOrUndefined(rows);
  },

  /** A user's conversations, most-recent first (by lastMessageAt, then createdAt). */
  async listForUser(
    ctx: TenantContext,
    page?: { limit?: number; offset?: number },
  ): Promise<Conversation[]> {
    const { limit, offset } = normalizePagination(page);
    return db
      .select()
      .from(conversations)
      .where(and(eq(conversations.tenantId, ctx.tenantId), eq(conversations.userId, ctx.userId)))
      .orderBy(desc(conversations.lastMessageAt), desc(conversations.createdAt))
      .limit(limit)
      .offset(offset);
  },

  async countForUser(ctx: TenantContext): Promise<number> {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(conversations)
      .where(and(eq(conversations.tenantId, ctx.tenantId), eq(conversations.userId, ctx.userId)));
    return rows[0]?.count ?? 0;
  },

  /** End-of-turn bump: +2 transcript messages, refresh lastMessageAt/updatedAt, latest scope. */
  async bumpForTurn(
    ctx: TenantContext,
    id: string,
    opts: { departmentScope?: string | string[] | undefined } = {},
  ): Promise<void> {
    const now = new Date();
    await db
      .update(conversations)
      .set({
        messageCount: sql`${conversations.messageCount} + 2`,
        lastMessageAt: now,
        updatedAt: now,
        ...(opts.departmentScope !== undefined ? { departmentScope: opts.departmentScope } : {}),
      })
      .where(and(eq(conversations.id, id), eq(conversations.tenantId, ctx.tenantId)));
  },

  async setTitle(ctx: TenantContext, id: string, title: string): Promise<void> {
    await db
      .update(conversations)
      .set({ title, updatedAt: new Date() })
      .where(and(eq(conversations.id, id), eq(conversations.tenantId, ctx.tenantId)));
  },

  /** Tenant-scoped partial update (rename / change scope). Returns null if no such id. */
  async update(
    ctx: TenantContext,
    id: string,
    patch: UpdateConversationInput,
  ): Promise<Conversation | null> {
    const rows = await db
      .update(conversations)
      .set({
        updatedAt: new Date(),
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.departmentScope !== undefined ? { departmentScope: patch.departmentScope } : {}),
      })
      .where(and(eq(conversations.id, id), eq(conversations.tenantId, ctx.tenantId)))
      .returning();
    return rows[0] ?? null;
  },

  /** Owner-scoped partial update (tenant + userId). Returns null if not the caller's. */
  async updateOwned(
    ctx: TenantContext,
    id: string,
    patch: UpdateConversationInput,
  ): Promise<Conversation | null> {
    const rows = await db
      .update(conversations)
      .set({
        updatedAt: new Date(),
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.departmentScope !== undefined ? { departmentScope: patch.departmentScope } : {}),
      })
      .where(
        and(
          eq(conversations.id, id),
          eq(conversations.tenantId, ctx.tenantId),
          eq(conversations.userId, ctx.userId),
        ),
      )
      .returning();
    return rows[0] ?? null;
  },

  /** Tenant-scoped delete; cascades to the conversation's messages. Returns true if removed. */
  async deleteById(ctx: TenantContext, id: string): Promise<boolean> {
    return db.transaction(async (tx) => {
      await tx
        .delete(messages)
        .where(and(eq(messages.tenantId, ctx.tenantId), eq(messages.conversationId, id)));
      const rows = await tx
        .delete(conversations)
        .where(and(eq(conversations.id, id), eq(conversations.tenantId, ctx.tenantId)))
        .returning({ id: conversations.id });
      return rows.length > 0;
    });
  },

  /** Owner-scoped delete (tenant + userId), cascading to messages. Returns true if removed. */
  async deleteByIdOwned(ctx: TenantContext, id: string): Promise<boolean> {
    return db.transaction(async (tx) => {
      // Only the owner's conversation is removed; messages are removed for that conversation.
      const rows = await tx
        .delete(conversations)
        .where(
          and(
            eq(conversations.id, id),
            eq(conversations.tenantId, ctx.tenantId),
            eq(conversations.userId, ctx.userId),
          ),
        )
        .returning({ id: conversations.id });
      if (rows.length === 0) return false;
      await tx
        .delete(messages)
        .where(and(eq(messages.tenantId, ctx.tenantId), eq(messages.conversationId, id)));
      return true;
    });
  },
};
