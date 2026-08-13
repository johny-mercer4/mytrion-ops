import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  horizonWorkerTelegramLinks,
  type HorizonWorkerTelegramLink,
} from '../db/schema/index.js';
import { ConflictError } from '../lib/errors.js';
import { planHorizonTelegramWebAppBind } from '../modules/horizon/telegramLink.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow, isUniqueViolation } from './util.js';

const clean = (value: string | null | undefined): string | null => value?.trim() || null;

export interface HorizonTelegramWebAppBindInput {
  zohoUserId: string;
  telegramUserId: string;
  telegramChatId: string;
  telegramUsername?: string | null | undefined;
  zohoUsername?: string | null | undefined;
  zohoEmail?: string | null | undefined;
}

export interface HorizonTelegramBotStartRefreshInput {
  telegramUserId: string;
  telegramChatId: string;
  telegramUsername?: string | null | undefined;
}

function keysOf(
  row: HorizonWorkerTelegramLink | undefined,
): { id: string; zohoUserId: string; telegramUserId: string } | undefined {
  if (!row) return undefined;
  return { id: row.id, zohoUserId: row.zohoUserId, telegramUserId: row.telegramUserId };
}

export const horizonWorkerTelegramRepo = {
  async findByZohoUserId(
    ctx: TenantContext,
    zohoUserId: string,
  ): Promise<HorizonWorkerTelegramLink | undefined> {
    const rows = await db
      .select()
      .from(horizonWorkerTelegramLinks)
      .where(
        and(
          eq(horizonWorkerTelegramLinks.tenantId, ctx.tenantId),
          eq(horizonWorkerTelegramLinks.zohoUserId, zohoUserId),
        ),
      )
      .limit(1);
    return rows[0];
  },

  async findByTelegramUserId(
    ctx: TenantContext,
    telegramUserId: string,
  ): Promise<HorizonWorkerTelegramLink | undefined> {
    const rows = await db
      .select()
      .from(horizonWorkerTelegramLinks)
      .where(
        and(
          eq(horizonWorkerTelegramLinks.tenantId, ctx.tenantId),
          eq(horizonWorkerTelegramLinks.telegramUserId, telegramUserId),
        ),
      )
      .limit(1);
    return rows[0];
  },

  /**
   * Bind the Zoho worker from the Bearer session to the Telegram user from verified initData.
   * Re-activates a revoked row for the same pair. Never accepts tenant/zoho ids from the client.
   */
  async upsertWebAppBind(
    ctx: TenantContext,
    input: HorizonTelegramWebAppBindInput,
  ): Promise<HorizonWorkerTelegramLink> {
    const zohoUserId = input.zohoUserId.trim();
    const telegramUserId = input.telegramUserId.trim();
    const telegramChatId = input.telegramChatId.trim();
    const now = new Date();
    const snapshot = {
      telegramChatId,
      telegramUsername: clean(input.telegramUsername),
      zohoUsername: clean(input.zohoUsername),
      zohoEmail: clean(input.zohoEmail),
      linkedVia: 'webapp_bind' as const,
      status: 'active' as const,
      updatedAt: now,
    };

    try {
      return await db.transaction(async (tx) => {
        const zohoRows = await tx
          .select()
          .from(horizonWorkerTelegramLinks)
          .where(
            and(
              eq(horizonWorkerTelegramLinks.tenantId, ctx.tenantId),
              eq(horizonWorkerTelegramLinks.zohoUserId, zohoUserId),
            ),
          )
          .limit(1);
        const telegramRows = await tx
          .select()
          .from(horizonWorkerTelegramLinks)
          .where(
            and(
              eq(horizonWorkerTelegramLinks.tenantId, ctx.tenantId),
              eq(horizonWorkerTelegramLinks.telegramUserId, telegramUserId),
            ),
          )
          .limit(1);

        const plan = planHorizonTelegramWebAppBind({
          byZoho: keysOf(zohoRows[0]),
          byTelegram: keysOf(telegramRows[0]),
          zohoUserId,
        });
        if (plan.action === 'conflict') {
          throw new ConflictError(plan.message, { code: plan.code });
        }

        if (plan.action === 'update') {
          const rows = await tx
            .update(horizonWorkerTelegramLinks)
            .set({
              telegramUserId,
              ...snapshot,
            })
            .where(
              and(
                eq(horizonWorkerTelegramLinks.tenantId, ctx.tenantId),
                eq(horizonWorkerTelegramLinks.id, plan.id),
              ),
            )
            .returning();
          return firstOrThrow(rows, 'Failed to refresh Horizon Telegram link');
        }

        const rows = await tx
          .insert(horizonWorkerTelegramLinks)
          .values({
            tenantId: ctx.tenantId,
            zohoUserId,
            telegramUserId,
            ...snapshot,
            linkedAt: now,
          })
          .returning();
        return firstOrThrow(rows, 'Failed to create Horizon Telegram link');
      });
    } catch (err) {
      if (err instanceof ConflictError) throw err;
      if (isUniqueViolation(err)) {
        throw new ConflictError('This Telegram account is already linked to another worker', {
          code: 'TELEGRAM_LINKED_TO_OTHER_WORKER',
        });
      }
      throw err;
    }
  },

  /**
   * /start in a private chat: refresh chat_id + username on an existing active link only.
   * Does not create a row — Telegram is not Zoho identity.
   */
  async refreshFromBotStart(
    ctx: TenantContext,
    input: HorizonTelegramBotStartRefreshInput,
  ): Promise<HorizonWorkerTelegramLink | undefined> {
    const telegramUserId = input.telegramUserId.trim();
    const telegramChatId = input.telegramChatId.trim();
    const username = clean(input.telegramUsername);
    const patch: {
      telegramChatId: string;
      updatedAt: Date;
      telegramUsername?: string;
    } = {
      telegramChatId,
      updatedAt: new Date(),
    };
    if (username) patch.telegramUsername = username;

    const rows = await db
      .update(horizonWorkerTelegramLinks)
      .set(patch)
      .where(
        and(
          eq(horizonWorkerTelegramLinks.tenantId, ctx.tenantId),
          eq(horizonWorkerTelegramLinks.telegramUserId, telegramUserId),
          eq(horizonWorkerTelegramLinks.status, 'active'),
        ),
      )
      .returning();
    return rows[0];
  },
};
