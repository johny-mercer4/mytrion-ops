/**
 * Mini-app notification outbox (see ultraplan §2): notifyMiniApp() is the ONLY way anything in
 * mytrion asks for a client notification. It inserts a row (idempotent on dedupeKey) and hands
 * delivery to the pg-boss `notification.dispatch` worker — with a direct best-effort fallback
 * when jobs are disabled (dev), so the behavior never regresses below the old inline send.
 *
 * Invariants enforced HERE, not at call sites:
 *  - notifyMiniApp never throws into the producing action (override-receipt rule);
 *  - role routing comes from NOTIFICATION_TYPES;
 *  - a driver copy requires payload.cardId === the driver's own registered card (fail-closed);
 *  - per-user opt-outs (mini_app_notification_prefs) are honored;
 *  - re-delivery is safe: a row leaves 'new' exactly once, and we only retry when NOTHING was
 *    delivered — so a partial fan-out is never double-sent.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  miniAppNotificationPrefs,
  miniAppNotificationReads,
  miniAppNotifications,
  registeredMiniAppCompanies,
  type MiniAppNotification,
} from '../../db/schema/index.js';
import { sendPlainReply } from '../../integrations/telegramCarrierBot.js';
import { miniAppTopicFor, realtimeHub } from '../realtime/hub.js';
import { logger } from '../../lib/logger.js';
import { jobsEnabled } from '../jobs/boss.js';
import { notificationDispatchJob } from '../jobs/catalog.js';
import { enqueue } from '../jobs/queue.js';
import { NOTIFICATION_TYPES, type MiniAppNotificationRole, type MiniAppNotificationType } from './registry.js';
import { renderNotification } from './templates.js';

export interface MiniAppNotifyInput {
  type: MiniAppNotificationType;
  tenantId: string;
  carrierId: string;
  /** Omit to fan out to every ACTIVE registration of the carrier the registry's roles allow. */
  telegramUserId?: string;
  /** One key per FACT — a duplicate insert is silently dropped (that is the point). */
  dedupeKey: string;
  /** Template inputs only. Never money-code values, never full PANs (use last6). */
  payload: Record<string, unknown>;
}

export async function notifyMiniApp(input: MiniAppNotifyInput): Promise<void> {
  try {
    const inserted = await db
      .insert(miniAppNotifications)
      .values({
        tenantId: input.tenantId,
        carrierId: input.carrierId,
        telegramUserId: input.telegramUserId ?? null,
        type: input.type,
        dedupeKey: input.dedupeKey,
        payload: input.payload,
      })
      .onConflictDoNothing({ target: miniAppNotifications.dedupeKey })
      .returning({ id: miniAppNotifications.id });
    const id = inserted[0]?.id;
    if (!id) return; // dedupe hit — this fact was already queued/sent

    if (jobsEnabled()) {
      await enqueue(notificationDispatchJob, { notificationId: id }, { singletonKey: id });
    } else {
      // Dev / jobs-off fallback: deliver inline, best-effort — same guarantees as the old
      // direct sendPlainReply, plus the outbox row for history.
      void dispatchMiniAppNotification(id).catch((err) => {
        logger.warn({ err, notificationId: id }, 'direct notification dispatch failed');
      });
    }
  } catch (err) {
    // A notification must never break the action that produced it.
    logger.error({ err, type: input.type, dedupeKey: input.dedupeKey }, 'notifyMiniApp failed');
  }
}

/** Worker entry (and dev fallback). Idempotent under pg-boss re-delivery: only 'new' rows act. */
export async function dispatchMiniAppNotification(notificationId: string): Promise<void> {
  const rows = await db
    .select()
    .from(miniAppNotifications)
    .where(eq(miniAppNotifications.id, notificationId))
    .limit(1);
  const ev = rows[0];
  if (!ev || ev.status !== 'new') return;

  const spec = NOTIFICATION_TYPES[ev.type];
  if (!spec) {
    await finish(ev, 'dead', 'unknown notification type');
    return;
  }

  const recipients = await db
    .select()
    .from(registeredMiniAppCompanies)
    .where(
      and(
        eq(registeredMiniAppCompanies.tenantId, ev.tenantId),
        eq(registeredMiniAppCompanies.carrierId, ev.carrierId),
        eq(registeredMiniAppCompanies.status, 'active'),
        ...(ev.telegramUserId ? [eq(registeredMiniAppCompanies.telegramUserId, ev.telegramUserId)] : []),
      ),
    );

  let delivered = 0;
  let lastError: string | null = null;
  for (const reg of recipients) {
    const role = reg.profile === 'driver' ? 'driver' : 'owner';
    if (!(spec.roles as readonly MiniAppNotificationRole[]).includes(role)) continue;
    if (role === 'driver') {
      // Fail-closed: a driver only ever hears about THEIR registered card.
      const evCardId = typeof ev.payload['cardId'] === 'string' ? ev.payload['cardId'] : '';
      if (!evCardId || evCardId !== (reg.cardId ?? '')) continue;
    }
    const pref = await db
      .select({ enabled: miniAppNotificationPrefs.enabled })
      .from(miniAppNotificationPrefs)
      .where(
        and(
          eq(miniAppNotificationPrefs.telegramUserId, reg.telegramUserId),
          eq(miniAppNotificationPrefs.type, ev.type),
        ),
      )
      .limit(1);
    if (pref[0] && !pref[0].enabled) continue;

    const text = renderNotification(spec.templateKey, reg.languageCode, ev.payload);
    if (!text) continue;
    try {
      await sendPlainReply(reg.telegramChatId ?? reg.telegramUserId, text);
      delivered += 1;
      // Live inbox push for an OPEN mini-app, over the EXISTING realtime hub. Best-effort
      // by nature: in a split worker deploy this process has no sockets (publish returns 0)
      // and the row still surfaces on the next inbox fetch — the hub's own scope note.
      realtimeHub.publish(miniAppTopicFor(reg.telegramUserId), {
        kind: 'notification',
        id: ev.id,
        type: ev.type,
        payload: ev.payload,
        createdAt: ev.createdAt.toISOString(),
        read: false,
      });
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  if (delivered > 0) {
    await finish(ev, 'sent', lastError);
    return;
  }
  if (lastError) {
    // Nothing went out AND something failed → leave 'new' and throw so pg-boss retries.
    // (Partial success never lands here, so retries can't double-send.)
    await db
      .update(miniAppNotifications)
      .set({ attempts: sql`${miniAppNotifications.attempts} + 1`, lastError })
      .where(eq(miniAppNotifications.id, ev.id));
    throw new Error(`notification ${ev.id} delivery failed: ${lastError}`);
  }
  // No eligible recipient (role filter, driver scope, prefs) — done, quietly.
  await finish(ev, 'skipped', null);
}

/** Idempotent per-user read receipt (unique on notification+user). Writes only the caller's own
 *  receipt keyed by their verified telegramUserId — reveals nothing, so no ownership check needed. */
export async function markNotificationRead(telegramUserId: string, notificationId: string): Promise<void> {
  await db
    .insert(miniAppNotificationReads)
    .values({ notificationId, telegramUserId })
    .onConflictDoNothing({ target: [miniAppNotificationReads.notificationId, miniAppNotificationReads.telegramUserId] });
}

/** Which of `notificationIds` this user has already read — for the inbox unread badge. */
export async function readNotificationIds(telegramUserId: string, notificationIds: string[]): Promise<Set<string>> {
  if (notificationIds.length === 0) return new Set();
  const rows = await db
    .select({ notificationId: miniAppNotificationReads.notificationId })
    .from(miniAppNotificationReads)
    .where(
      and(
        eq(miniAppNotificationReads.telegramUserId, telegramUserId),
        inArray(miniAppNotificationReads.notificationId, notificationIds),
      ),
    );
  return new Set(rows.map((r) => r.notificationId));
}

async function finish(ev: MiniAppNotification, status: 'sent' | 'skipped' | 'dead', lastError: string | null): Promise<void> {
  await db
    .update(miniAppNotifications)
    .set({
      status,
      lastError,
      attempts: sql`${miniAppNotifications.attempts} + 1`,
      sentAt: status === 'sent' ? new Date() : null,
    })
    .where(eq(miniAppNotifications.id, ev.id));
}
