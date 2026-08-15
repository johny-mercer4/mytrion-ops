import { createId } from '@paralleldrive/cuid2';
import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { VerificationStorageProvider } from './verification_flow.js';

/**
 * carrier_attachments — files attached to an existing carrier (Verification → Existing clients).
 *
 * Deliberately NOT `file_assets` (that table is shaped for agent-gateway tool files) and NOT
 * `verification_case_documents` (those are keyed on a verification case, and an existing client
 * may have no case). Mirrors `maintenance_case_attachments`: this row is metadata + key; the
 * bytes live behind `storageFor()`. The provider is stamped ON THE ROW so a later env flip
 * cannot repoint a read at a folder the bytes are not in.
 *
 * Tenant isolation is the repo's job: every query leads with `tenant_id`. `carrier_id` is the
 * DWH `dim_company.carrier_id` as text — that is the only entity these files belong to.
 */
export const carrierAttachments = pgTable(
  'carrier_attachments',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `cat_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    /** `octane.dim_company.carrier_id` — files are created against this id, never a case id. */
    carrierId: text('carrier_id').notNull(),
    fileName: text('file_name').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    s3Key: text('s3_key').notNull(),
    storageProvider: text('storage_provider')
      .$type<VerificationStorageProvider>()
      .notNull()
      .default('dropbox_verification'),
    uploadedByUserId: text('uploaded_by_user_id'),
    uploadedByName: text('uploaded_by_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantCarrierIdx: index('carrier_attachments_tenant_carrier_idx').on(
      table.tenantId,
      table.carrierId,
      table.createdAt,
    ),
  }),
);

export type CarrierAttachment = typeof carrierAttachments.$inferSelect;
export type NewCarrierAttachment = typeof carrierAttachments.$inferInsert;
