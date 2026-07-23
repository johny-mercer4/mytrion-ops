import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

// NOTE: no DB foreign keys by design — isolation + integrity live in the repo layer
// (see CLAUDE.md), so each schema file loads standalone under drizzle-kit.

/**
 * mytrion_inbox_messages — our own copy of the Zoho CRM "Inbox" module (`Org_Module`). One row per
 * per-agent notification ("New Task Assigned", "Tracking Number Updated", …). Replaces reading the
 * inbox live from Zoho and the servercrm `crm_inbox_notification` WebSocket: rows are created via
 * our webhook / repo, and creating one publishes a live event to the owner's `/v1/realtime` topic
 * (inbox:worker:<zohoUserId>) so the Sales app refreshes in real time.
 *
 * Owner mapping: `owner_zoho_user_id` = the Zoho CRM user id from `Org_Module.Owner.id`, matched
 * against the caller's session Zoho id (the same id `resolveZohoUserId` derives). `type`/`priority`
 * are stored as the raw Zoho strings (free text, NOT a pgEnum — the module carries values beyond
 * its own picklist, e.g. "Update") so the frontend's existing `mapInboxType` keeps working.
 */
export const mytrionInboxMessages = pgTable(
  'mytrion_inbox_messages',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `mim_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    /** Zoho `Org_Module` record id — present when the row originated from Zoho; the idempotency key. */
    zohoRecordId: text('zoho_record_id'),
    /** Zoho `Owner.id` — the recipient agent. Scope key for every read + the live-push topic. */
    ownerZohoUserId: text('owner_zoho_user_id').notNull(),
    ownerName: text('owner_name'),
    ownerEmail: text('owner_email'),
    /** Zoho `Subject` (falls back to `Name` at the write site). */
    subject: text('subject').notNull(),
    /** Zoho `Name` — kept for parity with the module. */
    name: text('name'),
    /** Zoho `Content` — HTML; the frontend strips tags for the preview. */
    content: text('content'),
    /** Zoho `Type` (Task/Update/Assignment/Warning/Critical/Info/…) — free text, not an enum. */
    type: text('type').notNull().default('Info'),
    /** Zoho `Priority` (small/medium/high) — stored raw; the frontend maps small→small. */
    priority: text('priority').notNull().default('medium'),
    tag: text('tag'),
    /** Zoho `Source_Url` — deep link back to the source CRM record. */
    sourceUrl: text('source_url'),
    /** Zoho `Record_Status__s` (Available/Draft/Trash) — Trash rows are hidden from the list. */
    recordStatus: text('record_status').notNull().default('Available'),
    /** Zoho `Created_Time` (when the notification was raised in the CRM). */
    zohoCreatedAt: timestamp('zoho_created_at', { withTimezone: true }),
    /** NULL = unread. Reserved: read-state is client-side (localStorage) for the initial cutover. */
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ownerIdx: index('mytrion_inbox_messages_tenant_owner_idx').on(
      table.tenantId,
      table.ownerZohoUserId,
      table.createdAt,
    ),
    // Idempotent Zoho retries: at most one row per (tenant, zoho_record_id) when the id is present.
    zohoUnique: uniqueIndex('mytrion_inbox_messages_tenant_zoho_uk')
      .on(table.tenantId, table.zohoRecordId)
      .where(sql`${table.zohoRecordId} IS NOT NULL`),
  }),
);

export type MytrionInboxMessage = typeof mytrionInboxMessages.$inferSelect;
export type NewMytrionInboxMessage = typeof mytrionInboxMessages.$inferInsert;
