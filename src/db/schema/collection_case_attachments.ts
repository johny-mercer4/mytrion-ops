import { createId } from '@paralleldrive/cuid2';
import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { collectionCases } from './collection.js';

/**
 * collection_case_attachments — agency letters, court filings, USPS proofs of mailing.
 *
 * Same shape and the same seam as `maintenance_case_attachments`: bytes live in R2 or Dropbox via
 * `src/modules/files/storage/`, and this table is metadata plus the key. Deliberately separate
 * from `file_assets`, which is tenant-scoped and shaped for agent-gateway tool files — a
 * different concern from "attached to collection case X", and `collection_cases` is not
 * tenant-scoped either.
 */
export const COLLECTION_ATTACHMENT_KINDS = [
  'agency_letter',
  'court_filing',
  'usps_proof',
  'payment_proof',
  'correspondence',
  'other',
] as const;
export type CollectionAttachmentKind = (typeof COLLECTION_ATTACHMENT_KINDS)[number];

export const collectionCaseAttachments = pgTable(
  'collection_case_attachments',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `cca_${createId()}`),
    caseId: text('case_id')
      .notNull()
      .references(() => collectionCases.id, { onDelete: 'cascade' }),
    fileName: text('file_name').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    s3Key: text('s3_key').notNull(),
    /**
     * WHERE THESE BYTES ACTUALLY ARE. Resolved through `storageFor()` on every read and delete —
     * per-row, not a global setting, so rows written before the default flips keep resolving to
     * wherever their bytes really are.
     */
    storageProvider: text('storage_provider')
      .$type<'s3' | 'dropbox_maintenance'>()
      .notNull()
      .default('s3'),
    kind: text('kind').$type<CollectionAttachmentKind>(),
    uploadedByUserId: text('uploaded_by_user_id'),
    uploadedByName: text('uploaded_by_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    caseIdx: index('collection_case_attachments_case_idx').on(table.caseId, table.createdAt),
  }),
);

export type CollectionCaseAttachment = typeof collectionCaseAttachments.$inferSelect;
export type NewCollectionCaseAttachment = typeof collectionCaseAttachments.$inferInsert;
