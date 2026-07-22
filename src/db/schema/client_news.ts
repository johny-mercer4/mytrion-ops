import { createId } from '@paralleldrive/cuid2';
import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

// NOTE: no DB foreign keys by design; type-only/no sibling imports (drizzle-kit loads standalone).

/** Per-locale text — at least `en`; the mini-app falls back en → user language. */
export type LocalizedText = { en: string; ru?: string | undefined; uz?: string | undefined; es?: string | undefined };

export type ClientNewsScope = 'all' | 'carriers';
export type ClientNewsRole = 'owner' | 'driver';
export type ClientNewsSeverity = 'info' | 'important';

/**
 * client_news — announcements OCTANE WRITES for mini-app clients (the Inbox "news" tab):
 * feature launches, holiday schedules, maintenance windows, or a message targeted at ONE
 * carrier. The read path is ALWAYS filtered server-side by the caller's own carrierId and
 * role (from verified initData) — a post aimed at one client can never leak to another,
 * and a driver never sees owner-only news. `severity='important'` additionally pushes a
 * bot message through the notification outbox (type 'news').
 */
export const clientNews = pgTable(
  'client_news',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `nws_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    title: jsonb('title').$type<LocalizedText>().notNull(),
    body: jsonb('body').$type<LocalizedText>().notNull(),
    /** 'all' = every client; 'carriers' = only the ids in carrierIds. */
    audienceScope: text('audience_scope').$type<ClientNewsScope>().notNull().default('all'),
    carrierIds: jsonb('carrier_ids').$type<string[]>().notNull().default([]),
    roles: jsonb('roles').$type<ClientNewsRole[]>().notNull().default(['owner', 'driver']),
    severity: text('severity').$type<ClientNewsSeverity>().notNull().default('info'),
    pinned: boolean('pinned').notNull().default(false),
    publishAt: timestamp('publish_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** Author identity (admin ctx.userId) — audit trail beyond the audit_log row. */
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    publishIdx: index('client_news_publish_idx').on(table.tenantId, table.publishAt),
  }),
);

/** Read receipts → unread badge. One row per (post, telegram user). */
export const clientNewsReads = pgTable(
  'client_news_reads',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `nwr_${createId()}`),
    newsId: text('news_id').notNull(),
    telegramUserId: text('telegram_user_id').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    newsUserUq: uniqueIndex('client_news_reads_news_user_uq').on(table.newsId, table.telegramUserId),
  }),
);

export type ClientNewsPost = typeof clientNews.$inferSelect;
export type NewClientNewsPost = typeof clientNews.$inferInsert;
