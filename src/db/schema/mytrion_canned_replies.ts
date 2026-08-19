import { createId } from '@paralleldrive/cuid2';
import { boolean, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Canned replies — reusable message templates an agent inserts into the composer.
 *
 * Team-shared and tenant-scoped; this is NOT client data (it carries no carrier, no card, nothing
 * per-ticket), so the gate is tenant + `active`, not the comms reader filter. `department` optionally
 * narrows a template to one queue's agents; NULL means everyone.
 */
export const mytrionCannedReplies = pgTable(
  'mytrion_canned_replies',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `mcr_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** Optional queue scope. NULL = available to every agent. */
    department: text('department'),
    /** Deactivate rather than delete when a template is retired but worth keeping for reference. */
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdByZohoUserId: text('created_by_zoho_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pickerIdx: index('mytrion_canned_replies_picker_idx').on(
      table.tenantId,
      table.active,
      table.sortOrder,
    ),
  }),
);

export type MytrionCannedReply = typeof mytrionCannedReplies.$inferSelect;
export type NewMytrionCannedReply = typeof mytrionCannedReplies.$inferInsert;
