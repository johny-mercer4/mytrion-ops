/**
 * entity_notes — polymorphic, tenant-scoped user notes attachable to any module record.
 *
 * Design mirrors Zoho Notes: a single table joins to any parent via (entity_type, entity_id).
 * No FK to parent tables — notes survive case/task deletion (same pattern as
 * retention_ownership_transfers). entity_id is TEXT so the same table binds to bigserial
 * PKs (coerced on write) and cuid2 PKs without schema branching.
 *
 * Supported entity_type values (open list — add without a migration):
 *   'retention_case' | 'worker_task' | 'maintenance_case' | 'verification_case'
 */
import { createId } from '@paralleldrive/cuid2';
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const entityNotes = pgTable(
  'entity_notes',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `en_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    /** Logical module name — e.g. 'retention_case', 'worker_task', 'maintenance_case'. */
    entityType: text('entity_type').notNull(),
    /** PK of the parent row as text (bigserial cast on write; cuid2 as-is). */
    entityId: text('entity_id').notNull(),
    content: text('content').notNull(),
    /** Zoho user id of the author when available. */
    authorZohoUserId: text('author_zoho_user_id'),
    /** Denormalized display name — no join needed at read time. */
    authorName: text('author_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    entityIdx: index('entity_notes_tenant_type_entity_idx').on(
      table.tenantId,
      table.entityType,
      table.entityId,
      table.createdAt,
    ),
  }),
);

export type EntityNote = typeof entityNotes.$inferSelect;
export type NewEntityNote = typeof entityNotes.$inferInsert;
