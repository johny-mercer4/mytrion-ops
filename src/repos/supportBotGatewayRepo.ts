import { and, count, eq, inArray, lt, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  supportBotChats,
  supportBotMessages,
  type SupportBotChat,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { assertSupportBotGroupCapacity } from '../modules/carrier/supportBotGroupCapacity.js';
import { assertSupportBotMessageScope } from '../modules/carrier/supportBotMessageScope.js';

export interface SupportBotMessageInput {
  carrierId: string;
  chatId: string;
  msgId?: string | undefined;
  telegramUserId: string;
  name: string;
  direction: 'in' | 'out';
  text: string;
  photo: boolean;
  engaged: boolean;
  sentAt: Date;
}

export const supportBotGatewayRepo = {
  async insertMessages(
    ctx: TenantContext,
    messages: SupportBotMessageInput[],
  ): Promise<number> {
    if (messages.length === 0) return 0;
    return db.transaction(async (tx) => {
      const chatIds = [...new Set(messages.map((message) => message.chatId))];
      const chats = await tx
        .select({
          chatId: supportBotChats.chatId,
          carrierId: supportBotChats.carrierId,
          enabled: supportBotChats.enabled,
        })
        .from(supportBotChats)
        .where(
          and(
            eq(supportBotChats.tenantId, ctx.tenantId),
            inArray(supportBotChats.chatId, chatIds),
          ),
        );
      assertSupportBotMessageScope(messages, chats);
      const inserted = await tx
        .insert(supportBotMessages)
        .values(
          messages.map((message) => ({
            tenantId: ctx.tenantId,
            carrierId: message.carrierId,
            chatId: message.chatId,
            msgId: message.msgId ?? null,
            telegramUserId: message.telegramUserId,
            name: message.name,
            direction: message.direction,
            text: message.text,
            photo: message.photo,
            engaged: message.engaged,
            sentAt: message.sentAt,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: supportBotMessages.id });
      return inserted.length;
    });
  },

  async deleteMessagesOlderThan(ctx: TenantContext, cutoff: Date): Promise<number> {
    const deleted = await db
      .delete(supportBotMessages)
      .where(
        and(
          eq(supportBotMessages.tenantId, ctx.tenantId),
          lt(supportBotMessages.sentAt, cutoff),
        ),
      )
      .returning({ id: supportBotMessages.id });
    return deleted.length;
  },

  async listEnabledChats(ctx: TenantContext): Promise<SupportBotChat[]> {
    return db
      .select()
      .from(supportBotChats)
      .where(
        and(
          eq(supportBotChats.tenantId, ctx.tenantId),
          eq(supportBotChats.enabled, true),
        ),
      );
  },

  async findChat(
    ctx: TenantContext,
    chatId: string,
  ): Promise<SupportBotChat | undefined> {
    const rows = await db
      .select()
      .from(supportBotChats)
      .where(
        and(
          eq(supportBotChats.tenantId, ctx.tenantId),
          eq(supportBotChats.chatId, chatId),
        ),
      )
      .limit(1);
    return rows[0];
  },

  async disableChat(
    ctx: TenantContext,
    chatId: string,
  ): Promise<SupportBotChat | undefined> {
    const rows = await db
      .update(supportBotChats)
      .set({ enabled: false, updatedAt: new Date() })
      .where(
        and(
          eq(supportBotChats.tenantId, ctx.tenantId),
          eq(supportBotChats.chatId, chatId),
        ),
      )
      .returning();
    return rows[0];
  },

  async setChat(
    ctx: TenantContext,
    input: { chatId: string; carrierId: string; createdBy: string },
    maxGroups: number,
  ): Promise<SupportBotChat> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`support-bot:${ctx.tenantId}`}))`);
      const existing = await tx
        .select({ enabled: supportBotChats.enabled })
        .from(supportBotChats)
        .where(
          and(
            eq(supportBotChats.tenantId, ctx.tenantId),
            eq(supportBotChats.chatId, input.chatId),
          ),
        )
        .limit(1);
      if (!existing[0]?.enabled) {
        const totals = await tx
          .select({ value: count() })
          .from(supportBotChats)
          .where(
            and(
              eq(supportBotChats.tenantId, ctx.tenantId),
              eq(supportBotChats.enabled, true),
            ),
          );
        assertSupportBotGroupCapacity(false, totals[0]?.value ?? 0, maxGroups);
      }
      const rows = await tx
        .insert(supportBotChats)
        .values({
          tenantId: ctx.tenantId,
          chatId: input.chatId,
          carrierId: input.carrierId,
          createdBy: input.createdBy,
        })
        .onConflictDoUpdate({
          target: [supportBotChats.tenantId, supportBotChats.chatId],
          set: { carrierId: input.carrierId, enabled: true, updatedAt: new Date() },
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('Support bot chat upsert returned no row');
      return row;
    });
  },

  async autoBindChat(
    ctx: TenantContext,
    input: { chatId: string; carrierId: string; createdBy: string },
    maxGroups: number,
  ): Promise<{ row: SupportBotChat; bound: boolean }> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`support-bot:${ctx.tenantId}`}))`);
      const existingRows = await tx
        .select()
        .from(supportBotChats)
        .where(
          and(
            eq(supportBotChats.tenantId, ctx.tenantId),
            eq(supportBotChats.chatId, input.chatId),
          ),
        )
        .for('update')
        .limit(1);
      const existing = existingRows[0];
      if (existing?.enabled) return { row: existing, bound: false };

      const totals = await tx
        .select({ value: count() })
        .from(supportBotChats)
        .where(
          and(
            eq(supportBotChats.tenantId, ctx.tenantId),
            eq(supportBotChats.enabled, true),
          ),
        );
      assertSupportBotGroupCapacity(false, totals[0]?.value ?? 0, maxGroups);

      if (existing) {
        const rows = await tx
          .update(supportBotChats)
          .set({
            carrierId: input.carrierId,
            enabled: true,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(supportBotChats.tenantId, ctx.tenantId),
              eq(supportBotChats.chatId, input.chatId),
            ),
          )
          .returning();
        const row = rows[0];
        if (!row) throw new Error('Support bot chat update returned no row');
        return { row, bound: true };
      }

      const inserted = await tx
        .insert(supportBotChats)
        .values({
          tenantId: ctx.tenantId,
          chatId: input.chatId,
          carrierId: input.carrierId,
          createdBy: input.createdBy,
        })
        .onConflictDoNothing({
          target: [supportBotChats.tenantId, supportBotChats.chatId],
        })
        .returning();
      const row = inserted[0];
      if (row) return { row, bound: true };

      const racedRows = await tx
        .select()
        .from(supportBotChats)
        .where(
          and(
            eq(supportBotChats.tenantId, ctx.tenantId),
            eq(supportBotChats.chatId, input.chatId),
          ),
        )
        .limit(1);
      const raced = racedRows[0];
      if (!raced) throw new Error('Support bot chat race resolved without a row');
      return { row: raced, bound: false };
    });
  },
};
