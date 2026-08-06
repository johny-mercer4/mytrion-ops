import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { LedgerImportPreviewRow } from '../../modules/billing/ledger/importTypes.js';

/**
 * ledger_import_batches — the journal for a bulk opening-balance spreadsheet upload.
 *
 * Flow: upload → parse + validate (writes NOTHING, status `pending`) → the agent reviews the
 * per-row verdicts → commit (applies the accepted rows) or discard. Committed batches can be
 * reverted, which supersedes every revision the batch created and restores the prior values as NEW
 * revisions — the append-only chain in ./ledger_opening_balances.ts is the revert journal, so this
 * table only needs to remember which batch owned which write.
 *
 * The row verdicts live in `validation` jsonb rather than a staging table so COMMIT IS A PURE
 * FUNCTION OF THE STORED BATCH: it applies exactly what the agent previewed, and each row's stored
 * `previousAmount` gives optimistic concurrency for free (the live value moved since the preview →
 * refuse rather than silently overwrite someone else's correction).
 *
 * `file_sha256` + the partial unique index make a re-upload of the same bytes return the existing
 * pending batch instead of creating a second one — the duplicate-detection idea already used by the
 * manual-Chase route in src/routes/v1/billing.routes.ts.
 *
 * NOTE for the sweep job: `validation` is the only large column here (10k rows of verdicts). Null it
 * out on committed/reverted batches older than 30 days and keep the counts — the counts are the
 * audit record, the row detail is a review aid.
 *
 * Not tenant-scoped — see the header of ./ledger_opening_balances.ts for the reasoning.
 */
export type LedgerImportStatus = 'pending' | 'committed' | 'discarded' | 'reverted';

export const ledgerImportBatches = pgTable(
  'ledger_import_batches',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `lib_${createId()}`),

    status: text('status').$type<LedgerImportStatus>().notNull().default('pending'),

    fileName: text('file_name').notNull(),
    fileBytes: integer('file_bytes').notNull(),
    /** Re-upload idempotency key. */
    fileSha256: text('file_sha256').notNull(),
    /** Template version read from the workbook's hidden __meta sheet. */
    templateVersion: text('template_version'),

    rowCount: integer('row_count').notNull().default(0),
    acceptedCount: integer('accepted_count').notNull().default(0),
    rejectedCount: integer('rejected_count').notNull().default(0),
    changedCount: integer('changed_count').notNull().default(0),
    newCount: integer('new_count').notNull().default(0),
    unchangedCount: integer('unchanged_count').notNull().default(0),

    /** Per-row verdicts. Paged OUT of here by the preview GET — never returned whole. */
    validation: jsonb('validation').$type<LedgerImportPreviewRow[]>(),
    /** Whole-file problems: wrong sheet name, missing/re-arranged columns, unreadable workbook. */
    fileErrors: jsonb('file_errors').$type<string[]>(),

    uploadedByUserId: text('uploaded_by_user_id'),
    uploadedByName: text('uploaded_by_name'),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
    /** Pending batches expire so a stale preview can never be committed against moved data. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),

    committedAt: timestamp('committed_at', { withTimezone: true }),
    committedByName: text('committed_by_name'),
    revertedAt: timestamp('reverted_at', { withTimezone: true }),
    revertedByName: text('reverted_by_name'),
  },
  (table) => ({
    /** A re-upload of identical bytes resumes the live pending batch instead of forking it. */
    pendingShaUk: uniqueIndex('ledger_import_batches_pending_sha_uk')
      .on(table.fileSha256)
      .where(sql`${table.status} = 'pending'`),
    statusUploadedIdx: index('ledger_import_batches_status_uploaded_idx').on(
      table.status,
      table.uploadedAt,
    ),

    statusCheck: check(
      'ledger_import_batches_status_check',
      sql`${table.status} IN ('pending', 'committed', 'discarded', 'reverted')`,
    ),
  }),
);

export type LedgerImportBatch = typeof ledgerImportBatches.$inferSelect;
export type NewLedgerImportBatch = typeof ledgerImportBatches.$inferInsert;
