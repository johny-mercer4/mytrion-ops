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
import { listDwhTransactions } from '../../integrations/dwhTransactions.js';
import { logger } from '../../lib/logger.js';
import { serverCrmWrapper } from '../../wrappers/serverCrmWrapper.js';
import { notifyMiniApp } from './service.js';

/** Backfill guard: at most this many receipts per card per run — a mart backfill or a busy
 *  fleet day can't turn into a notification storm. Excess is skipped (dedupe still covers re-runs). */
const RECEIPT_PER_CARD_CAP = 20;

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

/**
 * receipt poller (ultraplan §2.3 / handoff T2) — one Inbox receipt per new fueling TRANSACTION.
 * Source is the DWH transaction mart (listDwhTransactions, fast path), grouped from line items to
 * one row per transaction_id. Watermark `receipt:<carrierId>` holds the last transaction_date seen;
 * the FIRST run of a scope only records that baseline (no blast over history). Re-scans are safe:
 * the outbox dedupe_key is the transaction_id, so a boundary row can be re-seen without re-sending.
 *
 * PRICE IS NEVER IN THE PAYLOAD — a driver receives this, and drivers never see dollar figures.
 */
export async function runReceiptPoll(): Promise<{ carriers: number; receipts: number }> {
  const carriers = pilotCarriers();
  let receipts = 0;
  for (const carrierId of carriers) {
    try {
      const scope = `receipt:${carrierId}`;
      const prev = await getWatermark(scope);
      const lastDate = typeof prev?.['lastDate'] === 'string' ? (prev['lastDate'] as string) : null;

      const res = await listDwhTransactions({ carrierId, range: 'day', limit: 200 });
      const rows = res.data ?? [];

      // Collapse line items → one receipt per transaction_id (sum the fuel gallons; fees carry 0).
      const byTxn = new Map<string, { card: string; gallons: number; date: string; loc: string; city: string; state: string }>();
      for (const r of rows) {
        const txnId = String(r['transaction_id'] ?? '');
        const card = String(r['card_number'] ?? '');
        if (!txnId || !card) continue;
        const g = Number(r['line_item_fuel_quantity'] ?? 0) || 0;
        const cur = byTxn.get(txnId);
        if (cur) {
          cur.gallons += g;
        } else {
          byTxn.set(txnId, {
            card,
            gallons: g,
            date: String(r['transaction_date'] ?? ''),
            loc: String(r['location_name'] ?? ''),
            city: String(r['location_city'] ?? ''),
            state: String(r['location_state'] ?? ''),
          });
        }
      }
      if (byTxn.size === 0) continue;

      const maxDate = [...byTxn.values()].reduce((m, t) => (t.date > m ? t.date : m), lastDate ?? '');
      // First pass for this scope: baseline only — never blast the day's existing transactions.
      if (!lastDate) {
        await setWatermark(scope, { lastDate: maxDate });
        continue;
      }

      const fresh = [...byTxn.entries()]
        .filter(([, t]) => t.date >= lastDate)
        .sort((a, b) => (a[1].date < b[1].date ? -1 : 1));
      const perCard = new Map<string, number>();
      const cardIdCache = new Map<string, string>();
      for (const [txnId, t] of fresh) {
        const n = (perCard.get(t.card) ?? 0) + 1;
        perCard.set(t.card, n);
        if (n > RECEIPT_PER_CARD_CAP) continue;
        // cardId pins a DRIVER copy to their own card (fail-closed in the dispatcher); resolve once
        // per card. Owner still hears without it; the driver copy is silently skipped.
        let cardId = cardIdCache.get(t.card);
        if (cardId === undefined) {
          const owner = env.DWH_DATABASE_URL ? await findDwhCardByNumber(t.card).catch(() => null) : null;
          cardId = owner && String(owner.carrierId) === String(carrierId) ? owner.cardId : '';
          cardIdCache.set(t.card, cardId);
        }
        await notifyMiniApp({
          type: 'receipt',
          tenantId: DEFAULT_TENANT_ID,
          carrierId,
          dedupeKey: `receipt:${carrierId}:${txnId}`,
          payload: {
            last6: t.card.slice(-6),
            gallons: Number(t.gallons.toFixed(2)),
            location: t.loc,
            city: t.city,
            state: t.state,
            cardId,
          },
        });
        receipts += 1;
      }
      await setWatermark(scope, { lastDate: maxDate });
    } catch (err) {
      // One carrier's upstream hiccup must not starve the rest of the pilot.
      logger.warn({ err, carrierId }, 'receipt poll failed for carrier');
    }
  }
  return { carriers: carriers.length, receipts };
}
