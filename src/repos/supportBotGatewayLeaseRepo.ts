import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  supportBotGatewayLeases,
  type SupportBotGatewayLease,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { decideGatewayLease } from '../modules/carrier/supportBotGatewayLeasePolicy.js';
import { firstOrThrow } from './util.js';

export interface GatewayLeaseResult {
  acquired: boolean;
  changedHolder: boolean;
  lease: SupportBotGatewayLease;
}

/** DB-clock, tenant-scoped leadership for Telegram's single-consumer getUpdates contract. */
export const supportBotGatewayLeaseRepo = {
  async acquire(
    ctx: TenantContext,
    input: { botIdentity: string; holderId: string; ttlSeconds: number },
  ): Promise<GatewayLeaseResult> {
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`support-bot-poller:${ctx.tenantId}:${input.botIdentity}`}))`,
      );
      const clockRows = await tx.execute<{ now: Date | string }>(
        sql`SELECT CURRENT_TIMESTAMP AS now`,
      );
      const rawNow = firstOrThrow(clockRows, 'reading database clock returned no row').now;
      const now = rawNow instanceof Date ? rawNow : new Date(rawNow);
      const rows = await tx
        .select()
        .from(supportBotGatewayLeases)
        .where(
          and(
            eq(supportBotGatewayLeases.tenantId, ctx.tenantId),
            eq(supportBotGatewayLeases.botIdentity, input.botIdentity),
          ),
        )
        .for('update')
        .limit(1);
      const current = rows[0];
      const decision = decideGatewayLease(current, input.holderId, now);
      if (!decision.acquired && current) {
        return { acquired: false, changedHolder: false, lease: current };
      }
      const { changedHolder, fencingToken } = decision;
      const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1_000);
      if (current) {
        const updated = await tx
          .update(supportBotGatewayLeases)
          .set({
            holderId: input.holderId,
            fencingToken,
            expiresAt,
            updatedAt: now,
          })
          .where(eq(supportBotGatewayLeases.id, current.id))
          .returning();
        return {
          acquired: true,
          changedHolder,
          lease: firstOrThrow(updated, 'renewing support-bot gateway lease returned no row'),
        };
      }

      const inserted = await tx
        .insert(supportBotGatewayLeases)
        .values({
          tenantId: ctx.tenantId,
          botIdentity: input.botIdentity,
          holderId: input.holderId,
          fencingToken,
          expiresAt,
          updatedAt: now,
        })
        .returning();
      return {
        acquired: true,
        changedHolder: true,
        lease: firstOrThrow(inserted, 'creating support-bot gateway lease returned no row'),
      };
    });
  },

  async release(
    ctx: TenantContext,
    input: { botIdentity: string; holderId: string; fencingToken: number },
  ): Promise<boolean> {
    const rows = await db
      .update(supportBotGatewayLeases)
      .set({ expiresAt: new Date(0), updatedAt: new Date() })
      .where(
        and(
          eq(supportBotGatewayLeases.tenantId, ctx.tenantId),
          eq(supportBotGatewayLeases.botIdentity, input.botIdentity),
          eq(supportBotGatewayLeases.holderId, input.holderId),
          eq(supportBotGatewayLeases.fencingToken, input.fencingToken),
        ),
      )
      .returning({ id: supportBotGatewayLeases.id });
    return rows.length > 0;
  },
};
