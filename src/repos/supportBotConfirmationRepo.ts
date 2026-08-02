import { and, eq, lt } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  supportBotConfirmations,
  type SupportBotConfirmation,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow } from './util.js';

export interface CreateSupportBotConfirmationInput {
  tokenHash: string;
  carrierId: string;
  chatId: string;
  telegramUserId: string;
  messageId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  argumentsHash: string;
  expiresAt: Date;
}

export type ResolveSupportBotConfirmationResult =
  | { kind: 'resolved' | 'replay'; confirmation: SupportBotConfirmation }
  | { kind: 'not_found' | 'scope_mismatch' | 'expired' | 'already_resolved' };

/** Tenant-scoped, row-locked confirmation persistence. */
export const supportBotConfirmationRepo = {
  async findById(
    ctx: TenantContext,
    id: string,
  ): Promise<SupportBotConfirmation | undefined> {
    const rows = await db
      .select()
      .from(supportBotConfirmations)
      .where(
        and(
          eq(supportBotConfirmations.tenantId, ctx.tenantId),
          eq(supportBotConfirmations.id, id),
        ),
      )
      .limit(1);
    return rows[0];
  },

  async create(
    ctx: TenantContext,
    input: CreateSupportBotConfirmationInput,
  ): Promise<SupportBotConfirmation> {
    const rows = await db
      .insert(supportBotConfirmations)
      .values({ tenantId: ctx.tenantId, ...input })
      .returning();
    return firstOrThrow(rows, 'creating support-bot confirmation returned no row');
  },

  async resolve(
    ctx: TenantContext,
    input: {
      tokenHash: string;
      carrierId: string;
      chatId: string;
      telegramUserId: string;
      messageId: string;
      updateId: string;
      decision: 'confirm' | 'cancel';
    },
    now = new Date(),
  ): Promise<ResolveSupportBotConfirmationResult> {
    return db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(supportBotConfirmations)
        .where(
          and(
            eq(supportBotConfirmations.tenantId, ctx.tenantId),
            eq(supportBotConfirmations.tokenHash, input.tokenHash),
          ),
        )
        .limit(1)
        .for('update');
      const confirmation = rows[0];
      if (!confirmation) return { kind: 'not_found' };
      if (
        confirmation.carrierId !== input.carrierId ||
        confirmation.chatId !== input.chatId ||
        confirmation.telegramUserId !== input.telegramUserId ||
        confirmation.messageId !== input.messageId
      ) {
        return { kind: 'scope_mismatch' };
      }
      if (confirmation.status === 'consumed' && input.decision === 'confirm') {
        // A gateway may die after consuming the confirmation but before dispatch. Returning the
        // exact same action is safe because its stable confirmation turn id is idempotent/fenced.
        return { kind: 'replay', confirmation };
      }
      if (confirmation.status !== 'pending') return { kind: 'already_resolved' };
      if (confirmation.expiresAt.getTime() <= now.getTime()) {
        await tx
          .update(supportBotConfirmations)
          .set({ status: 'expired', resolvedAt: now })
          .where(eq(supportBotConfirmations.id, confirmation.id));
        return { kind: 'expired' };
      }
      const updated = await tx
        .update(supportBotConfirmations)
        .set({
          status: input.decision === 'confirm' ? 'consumed' : 'cancelled',
          resolvedAt: now,
          resolvedUpdateId: input.updateId,
        })
        .where(
          and(
            eq(supportBotConfirmations.id, confirmation.id),
            eq(supportBotConfirmations.status, 'pending'),
          ),
        )
        .returning();
      return {
        kind: 'resolved',
        confirmation: firstOrThrow(updated, 'resolving support-bot confirmation returned no row'),
      };
    });
  },

  async deleteResolvedBefore(ctx: TenantContext, cutoff: Date): Promise<number> {
    const rows = await db
      .delete(supportBotConfirmations)
      .where(
        and(
          eq(supportBotConfirmations.tenantId, ctx.tenantId),
          lt(supportBotConfirmations.expiresAt, cutoff),
        ),
      )
      .returning({ id: supportBotConfirmations.id });
    return rows.length;
  },
};
