import { and, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { paymentReturns, type NewPaymentReturn, type PaymentReturn } from '../db/schema/index.js';

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

    const rows = await db
      .select()
      .from(paymentReturns)
      .where(where)
      .orderBy(NEWEST_FIRST)
      .limit(limit)
      .offset(offset);

    const totalRes = await db.select({ n: sql<number>`count(*)::int` }).from(paymentReturns).where(where);
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
          carrierId: sql`excluded.carrier_id`,
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
};
