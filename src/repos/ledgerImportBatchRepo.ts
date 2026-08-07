import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  ledgerImportBatches,
  type LedgerImportBatch,
  type LedgerImportStatus,
} from '../db/schema/index.js';
import type {
  LedgerImportPreviewRow,
  LedgerImportSummary,
} from '../modules/billing/ledger/importTypes.js';
import { firstOrThrow } from './util.js';

/**
 * ledgerImportBatchRepo — the opening-balance spreadsheet journal.
 *
 * The row verdicts live in `validation` jsonb so COMMIT IS A PURE FUNCTION OF THE STORED BATCH: it
 * applies exactly what the agent previewed. `listRows` pages OUT of that blob and is the only way the
 * API reads it — returning the whole thing would put ~10k rows (megabytes, uncompressed: this app has
 * no @fastify/compress) on the wire.
 */

export interface CreateBatchInput {
  fileName: string;
  fileBytes: number;
  fileSha256: string;
  templateVersion?: string | null | undefined;
  summary: LedgerImportSummary;
  rows: LedgerImportPreviewRow[];
  fileErrors?: string[] | undefined;
  uploadedByUserId?: string | undefined;
  uploadedByName?: string | undefined;
  /** Pending TTL — a stale preview must not be committable against moved data. */
  expiresAt: Date;
}

export const ledgerImportBatchRepo = {
  async create(input: CreateBatchInput): Promise<LedgerImportBatch> {
    const inserted = await db
      .insert(ledgerImportBatches)
      .values({
        fileName: input.fileName,
        fileBytes: input.fileBytes,
        fileSha256: input.fileSha256,
        templateVersion: input.templateVersion ?? null,
        rowCount: input.summary.rowCount,
        acceptedCount: input.summary.accepted,
        rejectedCount: input.summary.rejected,
        changedCount: input.summary.changed,
        newCount: input.summary.new,
        unchangedCount: input.summary.unchanged,
        validation: input.rows,
        fileErrors: input.fileErrors ?? null,
        uploadedByUserId: input.uploadedByUserId ?? null,
        uploadedByName: input.uploadedByName ?? null,
        expiresAt: input.expiresAt,
      })
      .returning();
    return firstOrThrow(inserted, 'import batch insert returned no row');
  },

  async findById(id: string): Promise<LedgerImportBatch | undefined> {
    const rows = await db
      .select()
      .from(ledgerImportBatches)
      .where(eq(ledgerImportBatches.id, String(id).trim()))
      .limit(1);
    return rows[0];
  },

  /** A live pending batch for identical bytes — so a re-upload resumes rather than forks. */
  async findPendingBySha(sha: string): Promise<LedgerImportBatch | undefined> {
    const rows = await db
      .select()
      .from(ledgerImportBatches)
      .where(and(eq(ledgerImportBatches.fileSha256, sha), eq(ledgerImportBatches.status, 'pending')))
      .limit(1);
    return rows[0];
  },

  /**
   * Page the stored verdicts. Filtering happens in JS because the rows are one jsonb document — a
   * `jsonb_array_elements` query would be the alternative, and is not worth it for ≤10k rows already
   * being read as a unit.
   */
  async listRows(
    id: string,
    opts: { limit: number; offset: number; verdict?: string | undefined; changeKind?: string | undefined },
  ): Promise<{ rows: LedgerImportPreviewRow[]; total: number }> {
    const batch = await this.findById(id);
    if (!batch) return { rows: [], total: 0 };
    let all = batch.validation ?? [];
    if (opts.verdict) all = all.filter((r) => r.verdict === opts.verdict);
    if (opts.changeKind) all = all.filter((r) => r.changeKind === opts.changeKind);
    return { rows: all.slice(opts.offset, opts.offset + opts.limit), total: all.length };
  },

  /** Every accepted row, for commit. Not paged — commit needs the whole set in one transaction. */
  async acceptedRows(id: string): Promise<LedgerImportPreviewRow[]> {
    const batch = await this.findById(id);
    return (batch?.validation ?? []).filter((r) => r.verdict === 'accept');
  },

  async setStatus(
    id: string,
    status: LedgerImportStatus,
    actor?: { name?: string | undefined },
  ): Promise<LedgerImportBatch> {
    const now = new Date();
    const patch: Partial<typeof ledgerImportBatches.$inferInsert> = { status };
    if (status === 'committed') {
      patch.committedAt = now;
      patch.committedByName = actor?.name ?? null;
    }
    if (status === 'reverted') {
      patch.revertedAt = now;
      patch.revertedByName = actor?.name ?? null;
    }
    const updated = await db
      .update(ledgerImportBatches)
      .set(patch)
      .where(eq(ledgerImportBatches.id, String(id).trim()))
      .returning();
    return firstOrThrow(updated, `import batch ${id} not found`);
  },

  async listRecent(limit = 25): Promise<LedgerImportBatch[]> {
    return db
      .select({
        id: ledgerImportBatches.id,
        status: ledgerImportBatches.status,
        fileName: ledgerImportBatches.fileName,
        fileBytes: ledgerImportBatches.fileBytes,
        fileSha256: ledgerImportBatches.fileSha256,
        templateVersion: ledgerImportBatches.templateVersion,
        rowCount: ledgerImportBatches.rowCount,
        acceptedCount: ledgerImportBatches.acceptedCount,
        rejectedCount: ledgerImportBatches.rejectedCount,
        changedCount: ledgerImportBatches.changedCount,
        newCount: ledgerImportBatches.newCount,
        unchangedCount: ledgerImportBatches.unchangedCount,
        // `validation` is deliberately NOT selected — a list of batches must not drag every row's
        // verdicts along with it.
        validation: sql<null>`null`,
        fileErrors: ledgerImportBatches.fileErrors,
        uploadedByUserId: ledgerImportBatches.uploadedByUserId,
        uploadedByName: ledgerImportBatches.uploadedByName,
        uploadedAt: ledgerImportBatches.uploadedAt,
        expiresAt: ledgerImportBatches.expiresAt,
        committedAt: ledgerImportBatches.committedAt,
        committedByName: ledgerImportBatches.committedByName,
        revertedAt: ledgerImportBatches.revertedAt,
        revertedByName: ledgerImportBatches.revertedByName,
      })
      .from(ledgerImportBatches)
      .orderBy(desc(ledgerImportBatches.uploadedAt), desc(ledgerImportBatches.id))
      .limit(Math.min(100, Math.max(1, limit)));
  },

  /**
   * Sweep: drop the verdict blob from settled batches older than `days`, keeping the counts. The
   * counts are the audit record; the per-row detail is a review aid with a short useful life.
   */
  async pruneValidation(days = 30): Promise<number> {
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const updated = await db
      .update(ledgerImportBatches)
      .set({ validation: null })
      .where(
        and(
          lt(ledgerImportBatches.uploadedAt, cutoff),
          sql`${ledgerImportBatches.status} in ('committed', 'reverted', 'discarded')`,
          sql`${ledgerImportBatches.validation} is not null`,
        ),
      )
      .returning({ id: ledgerImportBatches.id });
    return updated.length;
  },
};
