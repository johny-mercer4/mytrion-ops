import { createId } from '@paralleldrive/cuid2';
import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { maintenanceCases } from './maintenance_cases.js';

/**
 * maintenance_case_attachments — files attached to a maintenance case (e.g. the shop invoice),
 * the CRM had this on every record; the Postgres-backed Maintenance case didn't. Bytes live in
 * R2 via the same `s3Storage` module used elsewhere (`src/modules/files/storage/s3Storage.ts`);
 * this table is only the metadata + key. Deliberately separate from `file_assets` — that table
 * is tenant-scoped and shaped for agent-gateway tool files (conversationId/agentTaskId/audience),
 * a different concern from "attached to maintenance case X", and `maintenance_cases` itself is
 * not tenant-scoped.
 */
export const maintenanceCaseAttachments = pgTable(
  'maintenance_case_attachments',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `mca_${createId()}`),
    caseId: text('case_id')
      .notNull()
      .references(() => maintenanceCases.id, { onDelete: 'cascade' }),
    fileName: text('file_name').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    s3Key: text('s3_key').notNull(),
    uploadedByUserId: text('uploaded_by_user_id'),
    uploadedByName: text('uploaded_by_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    caseIdx: index('maintenance_case_attachments_case_idx').on(table.caseId, table.createdAt),
  }),
);

export type MaintenanceCaseAttachment = typeof maintenanceCaseAttachments.$inferSelect;
export type NewMaintenanceCaseAttachment = typeof maintenanceCaseAttachments.$inferInsert;
