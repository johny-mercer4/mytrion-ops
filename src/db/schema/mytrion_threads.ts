import { createId } from '@paralleldrive/cuid2';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/** What a thread is for. Tickets/requests are about a client; escalations are about a person. */
export type CommsThreadKind = 'ticket' | 'request' | 'escalation' | 'dm';

/**
 * Who may read a thread. `participants` = the member rows only (DMs, escalations).
 * `department` = members PLUS anyone holding that department (a queue everyone in CS can work).
 */
export type CommsThreadVisibility = 'participants' | 'department';

/** Generic conversation state. Ticket lifecycle status lives on mytrion_tickets, never here. */
export type CommsThreadState = 'open' | 'archived';

export type CommsMessageKind = 'message' | 'note' | 'system';
export type CommsMessageAuthorKind = 'worker' | 'carrier' | 'system';
export type CommsMemberKind = 'worker' | 'carrier';
export type CommsMemberRole = 'requester' | 'assignee' | 'watcher' | 'approver' | 'participant';
export type CommsMemberState = 'active' | 'left' | 'muted';
export type CommsMemberNotify = 'all' | 'mentions' | 'none';

/**
 * One conversation. Deliberately narrow: identity, visibility, recency and counters only.
 *
 * Tickets, requests, escalations and DMs all sit on this one substrate so there is a single message
 * write path, a single attachment join, a single read-state mechanism and a single realtime topic
 * family. Kind-specific facts live in their own table (mytrion_tickets, mytrion_escalations).
 */
export const mytrionThreads = pgTable(
  'mytrion_threads',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `mth_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    kind: text('kind').$type<CommsThreadKind>().notNull(),
    visibility: text('visibility').$type<CommsThreadVisibility>().notNull(),
    /** The owning queue (a KNOWN_DEPARTMENTS slug). NULL for a DM. */
    department: text('department'),
    subject: text('subject').notNull().default(''),
    state: text('state').$type<CommsThreadState>().notNull().default('open'),
    /**
     * Canonical sorted pair of Zoho user ids for a DM (`min:max`), so "open the DM with Bob" is a
     * race-free INSERT ... ON CONFLICT rather than a read-then-write. NULL for every other kind.
     */
    dmKey: text('dm_key'),
    /**
     * Monotonic message counter, and the `seq` allocator: bumping this as a transaction's first
     * statement returns the next seq and takes the row lock that totally orders messages within
     * one thread, with zero cross-thread contention.
     */
    messageCount: integer('message_count').notNull().default(0),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
    lastMessageId: text('last_message_id'),
    lastMessageSeq: integer('last_message_seq').notNull().default(0),
    /**
     * First ~160 chars of the latest message, for list rendering without a join.
     * MUST NOT be serialized to a customer-audience reader: on a carrier-visible ticket the latest
     * message may be an internal note, and a preview would leak it.
     */
    lastMessagePreview: text('last_message_preview'),
    lastMessageAuthorZohoUserId: text('last_message_author_zoho_user_id'),
    createdByZohoUserId: text('created_by_zoho_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    /** Department queue: "open threads for CS, most recent first". */
    deptRecentIdx: index('mytrion_threads_tenant_dept_recent_idx').on(
      table.tenantId,
      table.department,
      table.visibility,
      table.lastMessageAt,
    ),
    kindRecentIdx: index('mytrion_threads_tenant_kind_recent_idx').on(
      table.tenantId,
      table.kind,
      table.lastMessageAt,
    ),
    /**
     * Partial so only DMs occupy it — every other kind leaves dm_key NULL. The migration adds the
     * `WHERE dm_key IS NOT NULL` predicate that drizzle's uniqueIndex() cannot express.
     *
     * GOTCHA for the find-or-create upsert: Postgres will not accept a partial unique index as an
     * ON CONFLICT arbiter unless the statement RESTATES the predicate —
     * `ON CONFLICT (tenant_id, dm_key) WHERE dm_key IS NOT NULL DO NOTHING`. Without the WHERE it
     * fails with "there is no unique or exclusion constraint matching the ON CONFLICT
     * specification", which reads like a missing index rather than a missing predicate.
     */
    dmUk: uniqueIndex('mytrion_threads_tenant_dm_uk').on(table.tenantId, table.dmKey),
  }),
);

/**
 * A message in a thread: a reply, an internal note, or a system journal entry.
 *
 * `thread_kind` is denormalized so DM traffic can be filtered — and later partitioned away — without
 * joining, since chat will out-write tickets by orders of magnitude.
 */
export const mytrionThreadMessages = pgTable(
  'mytrion_thread_messages',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `mtm_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    threadId: text('thread_id').notNull(),
    threadKind: text('thread_kind').$type<CommsThreadKind>().notNull(),
    /** Position within the thread, allocated from mytrion_threads.message_count. */
    seq: integer('seq').notNull(),
    kind: text('kind').$type<CommsMessageKind>().notNull().default('message'),
    body: text('body').notNull(),
    /**
     * Plain text or restricted markdown — NEVER trusted HTML. Zoho Desk stores thread content as
     * HTML and the widget renders it raw; that XSS surface is not inherited.
     */
    bodyFormat: text('body_format').$type<'text' | 'markdown'>().notNull().default('text'),
    authorKind: text('author_kind').$type<CommsMessageAuthorKind>().notNull(),
    authorZohoUserId: text('author_zoho_user_id'),
    /** Carrier-side author: the carrier this message came from. No contact record is involved. */
    authorCarrierId: text('author_carrier_id'),
    /** Display name snapshot, so history stays readable after a rename or a departure. */
    authorName: text('author_name'),
    /**
     * True = internal note, invisible to a carrier. Default false (visible) is deliberate: the safe
     * value must be the one you get by forgetting the field, and for a REPLY that is "visible",
     * while "internal" has to be an explicit choice.
     */
    isInternal: boolean('is_internal').notNull().default(false),
    mentions: jsonb('mentions').$type<string[]>().notNull().default([]),
    /** For kind='system': the journal event name (e.g. 'assigned', 'escalated', 'closed'). */
    systemEvent: text('system_event'),
    detail: jsonb('detail').$type<Record<string, unknown>>(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    redactedAt: timestamp('redacted_at', { withTimezone: true }),
    redactedByZohoUserId: text('redacted_by_zoho_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    threadSeqUk: uniqueIndex('mytrion_thread_messages_thread_seq_uk').on(
      table.tenantId,
      table.threadId,
      table.seq,
    ),
    threadTimeIdx: index('mytrion_thread_messages_thread_time_idx').on(
      table.tenantId,
      table.threadId,
      table.createdAt,
    ),
    authorIdx: index('mytrion_thread_messages_tenant_author_idx').on(
      table.tenantId,
      table.authorZohoUserId,
      table.createdAt,
    ),
  }),
);

/**
 * Membership AND read state in one row.
 *
 * Merged on purpose: both are keyed (tenant, thread, member) and both are written on join and on
 * read, so splitting them would force the single most frequent query in the system — "my threads
 * with unread counts", which powers a nav badge — to join two 1:1 tables. Merged, it is one index
 * scan on the inbox index.
 *
 * Polymorphic because a carrier has no Zoho user id: keying solely on one would make a carrier
 * structurally unable to participate in the thread about their own request.
 */
export const mytrionThreadMembers = pgTable(
  'mytrion_thread_members',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `mtmb_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    threadId: text('thread_id').notNull(),
    memberKind: text('member_kind').$type<CommsMemberKind>().notNull(),
    /** Zoho user id for a worker; carrier id for a carrier. Never blank. */
    memberKey: text('member_key').notNull(),
    memberName: text('member_name'),
    role: text('role').$type<CommsMemberRole>().notNull().default('participant'),
    state: text('state').$type<CommsMemberState>().notNull().default('active'),
    notify: text('notify').$type<CommsMemberNotify>().notNull().default('all'),
    addedByZohoUserId: text('added_by_zoho_user_id'),
    /**
     * Read watermark as a seq, not a message id: `unread = thread.message_count - last_read_seq` is
     * then arithmetic, with no subquery to resolve an id's position.
     */
    lastReadSeq: integer('last_read_seq').notNull().default(0),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }),
    /**
     * Mirror of the thread's last_message_at, maintained in the same transaction as the message
     * insert. Costs a few extra row writes per message and buys "my threads, most recent first,
     * with unread counts" as a single index range scan instead of a join plus sort.
     */
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp('left_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    memberUk: uniqueIndex('mytrion_thread_members_thread_member_uk').on(
      table.tenantId,
      table.threadId,
      table.memberKind,
      table.memberKey,
    ),
    /** THE "my queue / my chats" index — single-table, no join. */
    inboxIdx: index('mytrion_thread_members_inbox_idx').on(
      table.tenantId,
      table.memberKind,
      table.memberKey,
      table.state,
      table.lastMessageAt,
    ),
    threadIdx: index('mytrion_thread_members_thread_idx').on(
      table.tenantId,
      table.threadId,
      table.state,
    ),
  }),
);

/**
 * A file attached to a thread, and optionally to one message within it.
 *
 * `thread_id` is denormalized alongside `message_id` so "every file on this ticket" (Desk's
 * Attachments tab, which the widget currently assembles from three separate reads) is one index
 * scan, and so a file can be attached to the thread with no message.
 *
 * Attachment events are one of the two things the live widget subscribes to, alongside messages.
 */
export const mytrionThreadAttachments = pgTable(
  'mytrion_thread_attachments',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `mta_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    threadId: text('thread_id').notNull(),
    messageId: text('message_id'),
    /** file_assets.id — one file catalog, never a second inventory. */
    fileAssetId: text('file_asset_id').notNull(),
    /** Mirrors file_assets.storage_provider so a list render needs no join. */
    storage: text('storage').$type<'s3' | 'dropbox'>().notNull().default('s3'),
    name: text('name').notNull(),
    mime: text('mime'),
    sizeBytes: integer('size_bytes'),
    /** Durable Dropbox shared link for the transfer lane. NULL on the inline S3 lane. */
    externalUrl: text('external_url'),
    /** Inherits the parent message's visibility: an internal note's file must not reach a carrier. */
    isInternal: boolean('is_internal').notNull().default(false),
    uploadedByZohoUserId: text('uploaded_by_zoho_user_id'),
    uploadedByCarrierId: text('uploaded_by_carrier_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    threadIdx: index('mytrion_thread_attachments_thread_idx').on(
      table.tenantId,
      table.threadId,
      table.createdAt,
    ),
    messageIdx: index('mytrion_thread_attachments_message_idx').on(table.tenantId, table.messageId),
    fileIdx: index('mytrion_thread_attachments_file_idx').on(table.tenantId, table.fileAssetId),
  }),
);

export type MytrionThread = typeof mytrionThreads.$inferSelect;
export type NewMytrionThread = typeof mytrionThreads.$inferInsert;
export type MytrionThreadMessage = typeof mytrionThreadMessages.$inferSelect;
export type NewMytrionThreadMessage = typeof mytrionThreadMessages.$inferInsert;
export type MytrionThreadMember = typeof mytrionThreadMembers.$inferSelect;
export type NewMytrionThreadMember = typeof mytrionThreadMembers.$inferInsert;
export type MytrionThreadAttachment = typeof mytrionThreadAttachments.$inferSelect;
export type NewMytrionThreadAttachment = typeof mytrionThreadAttachments.$inferInsert;
