/**
 * Notification pollers (ultraplan §2.3) — neither EFS nor the DWH pushes events, so state
 * changes are DIFFED on a schedule. Piloted per carrier via NOTIFY_POLL_CARRIERS (comma-
 * separated carrier ids; empty = the poll job no-ops), matching the rollout plan's
 * "flag per carrier, Onzmove first" stance.
 *
 * card_status: servercrm's per-card status snapshot vs the stored watermark. The FIRST run
 * of a scope only records the baseline (no events) — restarts and fresh pilots never blast
 * out a notification per existing card. External changes (agent widget, EFS auto-relock)
 * are exactly what this catches; the mini-app's own writes already notify inline.
 */
import { eq, sql } from 'drizzle-orm';
import { DEFAULT_TENANT_ID } from '../../config/constants.js';
import { env } from '../../config/env.js';
import { db } from '../../db/client.js';
import { miniAppNotificationState } from '../../db/schema/index.js';
import { findDwhCardByNumber } from '../../integrations/dwhCards.js';
import { logger } from '../../lib/logger.js';
import { serverCrmWrapper } from '../../wrappers/serverCrmWrapper.js';
import { notifyMiniApp } from './service.js';

function pilotCarriers(): string[] {
  return env.NOTIFY_POLL_CARRIERS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function getWatermark(scope: string): Promise<Record<string, unknown> | null> {
  const rows = await db
    .select()
    .from(miniAppNotificationState)
    .where(eq(miniAppNotificationState.scope, scope))
    .limit(1);
  return rows[0]?.watermark ?? null;
}

async function setWatermark(scope: string, watermark: Record<string, unknown>): Promise<void> {
  await db
    .insert(miniAppNotificationState)
    .values({ scope, watermark })
    .onConflictDoUpdate({
      target: miniAppNotificationState.scope,
      set: { watermark, updatedAt: sql`now()` },
    });
}

export async function runCardStatusPoll(): Promise<{ carriers: number; changes: number }> {
  const carriers = pilotCarriers();
  let changes = 0;
  for (const carrierId of carriers) {
    try {
      const cards = await serverCrmWrapper.getCards(carrierId);
      const current: Record<string, string> = {};
      for (const row of cards.data ?? []) {
        const cardNumber = String(row['card_number'] ?? '');
        const status = String(row['status'] ?? '').trim();
        if (cardNumber && status) current[cardNumber] = status;
      }
      const scope = `card_status:${carrierId}`;
      const prev = await getWatermark(scope);
      if (prev) {
        for (const [cardNumber, status] of Object.entries(current)) {
          const before = prev[cardNumber];
          if (typeof before !== 'string' || before === status) continue;
          changes += 1;
          // cardId is what pins a DRIVER copy to their own card — resolve it best-effort;
          // without it the owner still hears, the driver copy is silently skipped (fail-closed).
          const owner = env.DWH_DATABASE_URL ? await findDwhCardByNumber(cardNumber).catch(() => null) : null;
          const cardId = owner && String(owner.carrierId) === String(carrierId) ? owner.cardId : '';
          await notifyMiniApp({
            type: 'card_status',
            tenantId: DEFAULT_TENANT_ID,
            carrierId,
            dedupeKey: `card_status:${carrierId}:${cardNumber.slice(-6)}:${status}`,
            payload: { last6: cardNumber.slice(-6), prev: before, status, cardId },
          });
        }
      }
      await setWatermark(scope, current);
    } catch (err) {
      // One carrier's upstream hiccup must not starve the rest of the pilot.
      logger.warn({ err, carrierId }, 'card_status poll failed for carrier');
    }
  }
  return { carriers: carriers.length, changes };
}
