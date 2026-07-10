import { createId } from '@paralleldrive/cuid2';
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// NOTE: no DB foreign keys by design — isolation + integrity live in the repo layer
// (see CLAUDE.md), and keeping schema files free of value-level sibling imports lets
// drizzle-kit load each file individually.

export type InboxPriority = 'low' | 'medium' | 'high';

/**
 * Who an event belongs to. 'worker' — an Octane employee, owner id is their ZOHO USER ID
 * (matches agent_zoho_user_id everywhere else). 'client' — a carrier account, owner id is
 * the carrier_users row id (`cu_…`). One column pair covers both audiences.
 */
export type InboxOwnerKind = 'worker' | 'client';

/**
 * inbox_events — the persisted feed behind the real-time WebSocket. Every row is one
 * notification for one owner; creating a row publishes it live to the owner's topic
 * (`inbox:<ownerKind>:<ownerId>`), and the table is the source of truth for history and
 * unread counts when the socket wasn't connected.
 */
export const inboxEvents = pgTable(
  'inbox_events',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `ie_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    priority: text('priority').$type<InboxPriority>().notNull().default('medium'),
    /** Free grouping label — a department ('retention'), module, or campaign. */
    tag: text('tag'),
    /** Event type slug, dot-namespaced (e.g. 'retention.case.created', 'chat.mention'). */
    type: text('type').notNull(),
    ownerKind: text('owner_kind').$type<InboxOwnerKind>().notNull(),
    /** Zoho user id (worker) or carrier_users id (client) — see InboxOwnerKind. */
    ownerId: text('owner_id').notNull(),
    /** Short human headline shown in the inbox list. */
    title: text('title').notNull(),
    detail: text('detail'),
    /** Null = unread. Set once when the owner opens/acknowledges it. */
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ownerIdx: index('inbox_events_tenant_owner_idx').on(
      table.tenantId,
      table.ownerKind,
      table.ownerId,
      table.createdAt,
    ),
    typeIdx: index('inbox_events_tenant_type_idx').on(table.tenantId, table.type),
    tagIdx: index('inbox_events_tenant_tag_idx').on(table.tenantId, table.tag),
  }),
);

export type InboxEvent = typeof inboxEvents.$inferSelect;
export type NewInboxEvent = typeof inboxEvents.$inferInsert;
