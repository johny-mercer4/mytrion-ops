import { and, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  paymentReturns,
  paymentTransactions,
  type NewPaymentReturn,
  type PaymentReturn,
  type PaymentTransaction,
} from '../db/schema/index.js';

/**
 * paymentReturnRepo — ACH returns + card disputes (replaces the Zoho `MX_Merchant_Returns` module).
 * Ingested from the MX Merchant API; matched (manually or automatically) to the original payment,
 * which reverses the payment in CMP (external) and flags the transaction returned — without
 * unmapping it. Not tenant-scoped (global operational table).
 */

export interface ReturnPage {
  rows: PaymentReturn[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface ListReturnFilters {
  matched?: boolean | undefined;
  carrierId?: string | undefined;
  query?: string | undefined;
}

/** Fields written when a return is linked to its original payment. */
export interface LinkMatchInput {
  originalTransactionId: number;
  matchNote: string;
  matchedBy: string;
  /** CMP reversal confirmed (invoice payment deleted / prepay balance decremented). */
  isReversed: boolean;
}

const NEWEST_FIRST = sql`${paymentReturns.returnDate} DESC NULLS LAST, ${paymentReturns.id} DESC`;

/** Must match `servercrm/services/zohoReturnMatchSync.js`'s `ZOHO_ACTOR` exactly. */
const ZOHO_SYNC_ACTOR = 'Zoho (workflow)';

export const paymentReturnRepo = {
  async listPage(opts: { page: number; limit: number } & ListReturnFilters): Promise<ReturnPage> {
    const page = Math.max(1, opts.page || 1);
    const limit = Math.min(2000, Math.max(1, opts.limit || 200));
    const offset = (page - 1) * limit;

    const conds: SQL[] = [];
    if (opts.matched !== undefined) conds.push(eq(paymentReturns.matched, opts.matched));
    if (opts.carrierId && opts.carrierId.trim()) conds.push(eq(paymentReturns.carrierId, opts.carrierId.trim()));
    if (opts.query && opts.query.trim()) {
      const like = `%${opts.query.trim()}%`;
      const q = or(ilike(paymentReturns.reason, like), ilike(paymentReturns.sourceRecordId, like));
      if (q) conds.push(q);
    }
    const where = conds.length ? and(...conds) : undefined;

    // Page + total run concurrently — independent queries, so one round-trip's wall time not two.
    const [rows, totalRes] = await Promise.all([
      db.select().from(paymentReturns).where(where).orderBy(NEWEST_FIRST).limit(limit).offset(offset),
      db.select({ n: sql<number>`count(*)::int` }).from(paymentReturns).where(where),
    ]);
    const total = totalRes[0]?.n ?? 0;

    return { rows, page, limit, total, hasMore: offset + rows.length < total };
  },

  async getById(id: number): Promise<PaymentReturn | undefined> {
    const rows = await db.select().from(paymentReturns).where(eq(paymentReturns.id, id)).limit(1);
    return rows[0];
  },

  /** Ingest upsert (new data only); conflict updates the source facts, never the match columns. */
  async upsertMany(rows: NewPaymentReturn[]): Promise<number> {
    if (!rows.length) return 0;
    const inserted = await db
      .insert(paymentReturns)
      .values(rows)
      .onConflictDoUpdate({
        target: [paymentReturns.source, paymentReturns.sourceRecordId],
        set: {
          returnType: sql`excluded.return_type`,
          carrierId: sql`excluded.carrier_id`,
          customerName: sql`excluded.customer_name`,
          referenceNumber: sql`excluded.reference_number`,
          last4: sql`excluded.last4`,
          amount: sql`excluded.amount`,
          returnDate: sql`excluded.return_date`,
          reason: sql`excluded.reason`,
          raw: sql`excluded.raw`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: paymentReturns.id });
    return inserted.length;
  },

  /** Link a return to its original payment after the CMP reversal (or a no-reversal match). */
  async linkMatch(returnId: number, input: LinkMatchInput): Promise<PaymentReturn | undefined> {
    const rows = await db
      .update(paymentReturns)
      .set({
        matched: true,
        originalTransactionId: input.originalTransactionId,
        matchNote: input.matchNote,
        matchedBy: input.matchedBy,
        matchedAt: new Date(),
        isReversed: input.isReversed,
        updatedAt: new Date(),
      })
      .where(eq(paymentReturns.id, returnId))
      .returning();
    return rows[0];
  },

  /**
   * Already-matched returns still sitting `is_reversed = false` — candidates for the CMP-backfill
   * script (`scripts/backfillReturnCmpReversals.ts`). LEFT JOINs the original transaction (some rows
   * have `original_transaction_id IS NULL` — a return recorded with no link at all, predating the
   * payments backfill) so the caller can bucket those separately rather than silently drop them.
   * Structural filter only (matched + not reversed) — the caller decides eligibility per-row from
   * the joined transaction's own mapping/source fields, since the historical `match_note` text takes
   * more than one shape (this repo's own bare string vs. the Zoho-workflow-wrapped sentence).
   */
  async listStuckUnreversed(limit = 500): Promise<Array<{ ret: PaymentReturn; tx: PaymentTransaction | undefined }>> {
    const rows = await db
      .select({ ret: paymentReturns, tx: paymentTransactions })
      .from(paymentReturns)
      .leftJoin(paymentTransactions, eq(paymentTransactions.id, paymentReturns.originalTransactionId))
      .where(and(eq(paymentReturns.matched, true), eq(paymentReturns.isReversed, false)))
      .orderBy(NEWEST_FIRST)
      .limit(limit);
    return rows.map((r) => ({ ret: r.ret, tx: r.tx ?? undefined }));
  },

  /**
   * Record a resolver-found CMP reversal for an ALREADY-matched return (the backfill path — these
   * rows can't go back through `linkMatch`/`assertReturnMatchable`, which would 409). A conditional
   * UPDATE on `is_reversed = false`: idempotent (a re-run's `listStuckUnreversed` no longer selects
   * an already-fixed row) and safe against a concurrent live match reaching the row first.
   *
   * Deliberately does NOT touch `matched_at` or overwrite `matched_by` wholesale — these 97 rows'
   * original attribution (an agent's name, or the Zoho sync) must survive. The one exception: when
   * `matched_by` is the exact Zoho-sync marker, append to it so the row becomes "app-owned" from the
   * Zoho→PG sync's point of view (`servercrm/services/zohoReturnMatchSync.js`) — otherwise its next
   * 2-hourly tick overwrites `match_note` right back to the stale text (it never re-deletes the CMP
   * payment, since `is_reversed` only ever goes false→true, but the pill would regress).
   */
  async recordCmpReversal(
    returnId: number,
    input: { matchNote: string; isReversed: boolean; resolvedBy: string },
  ): Promise<PaymentReturn | undefined> {
    const rows = await db
      .update(paymentReturns)
      .set({
        matchNote: input.matchNote,
        isReversed: input.isReversed,
        matchedBy: sql`case when ${paymentReturns.matchedBy} = ${ZOHO_SYNC_ACTOR}
          then ${paymentReturns.matchedBy} || ' + ' || ${input.resolvedBy}
          else ${paymentReturns.matchedBy} end`,
        updatedAt: new Date(),
      })
      .where(and(eq(paymentReturns.id, returnId), eq(paymentReturns.isReversed, false)))
      .returning();
    return rows[0];
  },
};
