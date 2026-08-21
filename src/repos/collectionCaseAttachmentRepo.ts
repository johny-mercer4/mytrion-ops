import { asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  collectionCaseAttachments,
  type CollectionCaseAttachment,
  type NewCollectionCaseAttachment,
} from '../db/schema/collection_case_attachments.js';
import { firstOrUndefined } from './util.js';

/**
 * Files on a collection case — agency letters, court filings, USPS proofs of mailing.
 *
 * Metadata only; the bytes live in R2 or Dropbox via `storageFor()`, resolved per row from
 * `storageProvider` so a file written before the default flipped still reads from where it is.
 * Same seam and the same rule as `maintenanceAttachmentRepo`.
 */
export const collectionCaseAttachmentRepo = {
  async insert(row: NewCollectionCaseAttachment): Promise<CollectionCaseAttachment | undefined> {
    return firstOrUndefined(await db.insert(collectionCaseAttachments).values(row).returning());
  },

  async listByCaseId(caseId: string): Promise<CollectionCaseAttachment[]> {
    return db
      .select()
      .from(collectionCaseAttachments)
      .where(eq(collectionCaseAttachments.caseId, caseId))
      .orderBy(asc(collectionCaseAttachments.createdAt));
  },

  /** How many files each case carries, for the list — one grouped read, never one per row. */
  async countsByCase(caseIds: readonly string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (caseIds.length === 0) return out;
    const rows = await db
      .select({
        caseId: collectionCaseAttachments.caseId,
        n: sql<number>`count(*)::int`,
      })
      .from(collectionCaseAttachments)
      .where(inArray(collectionCaseAttachments.caseId, [...caseIds]))
      .groupBy(collectionCaseAttachments.caseId);
    for (const r of rows) out.set(r.caseId, r.n);
    return out;
  },

  async getById(id: string): Promise<CollectionCaseAttachment | undefined> {
    return firstOrUndefined(
      await db
        .select()
        .from(collectionCaseAttachments)
        .where(eq(collectionCaseAttachments.id, id))
        .limit(1),
    );
  },

  /**
   * A real delete. Unlike the case itself, an attachment carries no accounting weight — removing
   * one has no ledger impact, so there is nothing to preserve by soft-deleting it.
   */
  async delete(id: string): Promise<CollectionCaseAttachment | undefined> {
    return firstOrUndefined(
      await db
        .delete(collectionCaseAttachments)
        .where(eq(collectionCaseAttachments.id, id))
        .returning(),
    );
  },
};
