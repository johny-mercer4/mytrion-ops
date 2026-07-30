import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  supportBotMemories,
  type SupportBotMemory,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { toVectorLiteral } from './util.js';

export interface SupportBotMemoryScope {
  carrierId: string;
  chatId: string;
  telegramUserId: string;
}

function scopeWhere(ctx: TenantContext, scope: SupportBotMemoryScope) {
  return and(
    eq(supportBotMemories.tenantId, ctx.tenantId),
    eq(supportBotMemories.carrierId, scope.carrierId),
    eq(supportBotMemories.chatId, scope.chatId),
    eq(supportBotMemories.telegramUserId, scope.telegramUserId),
  );
}

export const supportBotMemoryRepo = {
  async insert(
    ctx: TenantContext,
    scope: SupportBotMemoryScope,
    input: {
      content: string;
      embedding: number[];
      sourceHash: string;
      expiresAt: Date;
    },
  ): Promise<SupportBotMemory | null> {
    const rows = await db
      .insert(supportBotMemories)
      .values({
        tenantId: ctx.tenantId,
        ...scope,
        content: input.content,
        embedding: input.embedding,
        sourceHash: input.sourceHash,
        expiresAt: input.expiresAt,
      })
      .onConflictDoNothing({
        target: [
          supportBotMemories.tenantId,
          supportBotMemories.carrierId,
          supportBotMemories.chatId,
          supportBotMemories.telegramUserId,
          supportBotMemories.sourceHash,
        ],
      })
      .returning();
    return rows[0] ?? null;
  },

  /** Exposed so isolation tests can inspect the generated SQL without a live database. */
  buildSearchQuery(
    ctx: TenantContext,
    scope: SupportBotMemoryScope,
    embedding: number[],
    k: number,
  ) {
    const literal = toVectorLiteral(embedding);
    return db
      .select({
        id: supportBotMemories.id,
        content: supportBotMemories.content,
        kind: supportBotMemories.kind,
        createdAt: supportBotMemories.createdAt,
        score: sql<number>`1 - (${supportBotMemories.embedding} <=> ${literal}::vector)`,
      })
      .from(supportBotMemories)
      .where(
        and(
          scopeWhere(ctx, scope),
          sql`${supportBotMemories.expiresAt} > now()`,
        ),
      )
      .orderBy(sql`${supportBotMemories.embedding} <=> ${literal}::vector`)
      .limit(Math.max(1, k));
  },

  async search(
    ctx: TenantContext,
    scope: SupportBotMemoryScope,
    embedding: number[],
    k: number,
  ) {
    const rows = await this.buildSearchQuery(ctx, scope, embedding, k);
    if (rows.length) {
      await db
        .update(supportBotMemories)
        .set({ lastAccessedAt: new Date() })
        .where(
          and(
            eq(supportBotMemories.tenantId, ctx.tenantId),
            inArray(
              supportBotMemories.id,
              rows.map((row) => row.id),
            ),
          ),
        );
    }
    return rows;
  },

  /** Keep the newest rows inside one fully-scoped user's memory partition. */
  async evictBeyondCap(
    ctx: TenantContext,
    scope: SupportBotMemoryScope,
    cap: number,
  ): Promise<number> {
    const keep = db
      .select({ id: supportBotMemories.id })
      .from(supportBotMemories)
      .where(
        and(
          scopeWhere(ctx, scope),
          sql`${supportBotMemories.expiresAt} > now()`,
        ),
      )
      .orderBy(desc(supportBotMemories.createdAt))
      .limit(Math.max(1, cap));
    const removed = await db
      .delete(supportBotMemories)
      .where(
        and(
          scopeWhere(ctx, scope),
          sql`(
            ${supportBotMemories.expiresAt} <= now()
            OR ${supportBotMemories.id} NOT IN (SELECT id FROM ${keep.as('keep')})
          )`,
        ),
      )
      .returning({ id: supportBotMemories.id });
    return removed.length;
  },
};
