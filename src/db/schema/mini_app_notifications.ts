import { createId } from '@paralleldrive/cuid2';
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { MiniAppNotificationType } from '../../modules/notifications/registry.js';

// NOTE: no DB foreign keys by design (see inbox_events.ts) — and only type-only sibling
// imports, so drizzle-kit can load this file standalone.

export type MiniAppNotificationStatus = 'new' | 'sent' | 'skipped' | 'dead';

/**
 * mini_app_notifications — the OUTBOX behind every proactive message the platform sends to
 * mini-app users (Telegram bot today; the mini-app Inbox feed reads the same rows later).
 *
 * Writers only INSERT here (via notifyMiniApp — never send inline); the pg-boss
 * `notification.dispatch` worker owns delivery, retries and rate behavior. This is the
 * override-receipt rule made law: a notification must never block or fail the action that
 * produced it. Routing (who may receive which type) lives in the notifications registry —
 * one source of truth, enforced at dispatch, exactly like the mini-app's server-side gates.
 */
export const miniAppNotifications = pgTable(
  'mini_app_notifications',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `man_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    carrierId: text('carrier_id').notNull(),
    /** Explicit recipient (registration's telegram_user_id). Null = fan out to every ACTIVE
     * registration of the carrier whose ROLE the registry allows for this type. */
    telegramUserId: text('telegram_user_id'),
    type: text('type').$type<MiniAppNotificationType>().notNull(),
    /** One row per FACT (e.g. 'card_status:5794015:CARD123:Hold'); the unique index makes
     * producers idempotent — pollers and double-fired handlers can insert blindly. */
    dedupeKey: text('dedupe_key').notNull(),
    /** Template inputs ONLY (last6, status, gallons…). Never money-code values, never full
     * PANs — the last-6 rule and the "value never in chat" rule are enforced by what is
     * allowed to be stored here. */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    status: text('status').$type<MiniAppNotificationStatus>().notNull().default('new'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (table) => ({
    dedupeUq: uniqueIndex('mini_app_notifications_dedupe_uq').on(table.dedupeKey),
    statusIdx: index('mini_app_notifications_status_idx').on(table.status, table.createdAt),
    carrierIdx: index('mini_app_notifications_carrier_idx').on(table.tenantId, table.carrierId, table.createdAt),
  }),
);

/** Per-user, per-type opt-out. No row = enabled (defaults ON, so the table stays tiny). */
export const miniAppNotificationPrefs = pgTable(
  'mini_app_notification_prefs',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `mnp_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    carrierId: text('carrier_id').notNull(),
    telegramUserId: text('telegram_user_id').notNull(),
    type: text('type').$type<MiniAppNotificationType>().notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userTypeUq: uniqueIndex('mini_app_notification_prefs_user_type_uq').on(table.telegramUserId, table.type),
  }),
);

/** Read receipts → per-user unread badge. One row per (notification, telegram user), mirroring
 *  client_news_reads. A notification can fan out to several users, so read state is per-user, not
 *  a column on the outbox row. Marking only writes the caller's own receipt — no ownership risk. */
export const miniAppNotificationReads = pgTable(
  'mini_app_notification_reads',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `mnr_${createId()}`),
    notificationId: text('notification_id').notNull(),
    telegramUserId: text('telegram_user_id').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    notifUserUq: uniqueIndex('mini_app_notification_reads_notif_user_uq').on(
      table.notificationId,
      table.telegramUserId,
    ),
  }),
);

/** Poller watermarks — "what have I already seen" per scope (e.g. 'card_status:<carrierId>'),
 *  so worker restarts never re-notify and the first run of a scope is silent (baseline only). */
export const miniAppNotificationState = pgTable('mini_app_notification_state', {
  scope: text('scope').primaryKey(),
  watermark: jsonb('watermark').$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type MiniAppNotification = typeof miniAppNotifications.$inferSelect;
export type NewMiniAppNotification = typeof miniAppNotifications.$inferInsert;
export type MiniAppNotificationPref = typeof miniAppNotificationPrefs.$inferSelect;
