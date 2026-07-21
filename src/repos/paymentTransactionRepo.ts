import { and, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  paymentTransactions,
  type NewPaymentTransaction,
  type PaymentTransaction,
} from '../db/schema/index.js';

/**
 * paymentTransactionRepo — read/write access to the unified payments store (replaces the four Zoho
 * payment modules). Reads back the whole ledger for the billing panel (which filters/groups
 * client-side); writes are the PG-owned mapping columns (the actual payment is applied/reversed in
 * CMP, external). Ingest uses `upsertMany`, which NEVER overwrites the mapping columns.
 *
 * Not tenant-scoped (global operational table, money-code precedent). NUMERIC round-trips as a
 * string in Drizzle — the `money()` helper formats writes at fixed scale.
 */

/** NUMERIC → fixed-scale string (or undefined to leave unset). */
function money(n: number | null | undefined, scale = 2): string | null | undefined {
  if (n === null) return null;
  return n === undefined ? undefined : n.toFixed(scale);
}

export interface ListTxFilters {
  source?: string | undefined; // 'mx' | 'zelle' | 'chase' | 'stripe'
  isMapped?: boolean | undefined;
  isReturned?: boolean | undefined;
  carrierId?: string | undefined;
  /** occurred_at >= this instant (yyyy-mm-dd or ISO). */
  dateFrom?: string | undefined;
  /** occurred_at <= this instant. */
  dateTo?: string | undefined;
}

export interface TxPage {
  rows: PaymentTransaction[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

/** Whole-dataset aggregates (independent of pagination) for the source filter + summary tiles. */
export interface TxStats {
  total: number;
  mapped: number;
  unmapped: number;
  totalAmount: number;
  bySource: Record<string, number>;
}

/** Mapping-column patch applied after a successful CMP write. */
export interface MappingPatch {
  carrierId?: string | null;
  isInvoiceMapped?: boolean;
  mappingType?: string | null;
  mappedBy?: string | null;
  mappedAt?: Date | null;
  cmpRef?: Record<string, unknown> | null;
  splitAllocations?: Record<string, unknown>[] | null;
}

/** Candidate-search filters (a return → its original MX payment). */
export interface CandidateFilters {
  query?: string | undefined;
  amount?: string | number | undefined;
  beforeDate?: string | undefined;
  customerName?: string | undefined;
  limit?: number | undefined;
}

const NEWEST_FIRST = sql`${paymentTransactions.occurredAt} DESC NULLS LAST, ${paymentTransactions.id} DESC`;

function buildFilters(f: ListTxFilters): SQL[] {
  const conds: SQL[] = [];
  if (f.source) conds.push(eq(paymentTransactions.source, f.source));
  if (f.isMapped !== undefined) conds.push(eq(paymentTransactions.isInvoiceMapped, f.isMapped));
  if (f.isReturned !== undefined) conds.push(eq(paymentTransactions.isReturned, f.isReturned));
  if (f.carrierId && f.carrierId.trim()) conds.push(eq(paymentTransactions.carrierId, f.carrierId.trim()));
  if (f.dateFrom) conds.push(sql`${paymentTransactions.occurredAt} >= ${f.dateFrom}`);
  if (f.dateTo) conds.push(sql`${paymentTransactions.occurredAt} <= ${f.dateTo}`);
  return conds;
}

export const paymentTransactionRepo = {
  /** One page (newest first) + the grand total matching the filters (for "X total available"). */
  async listPage(opts: { page: number; limit: number } & ListTxFilters): Promise<TxPage> {
    const page = Math.max(1, opts.page || 1);
    const limit = Math.min(2000, Math.max(1, opts.limit || 200));
    const offset = (page - 1) * limit;
    const conds = buildFilters(opts);
    const where = conds.length ? and(...conds) : undefined;

    // Page + total run concurrently — they're independent, so this is one round-trip's wall time,
    // not two (matters most from a dev laptop where every query crosses to the remote DB).
    const [rows, totalRes] = await Promise.all([
      db.select().from(paymentTransactions).where(where).orderBy(NEWEST_FIRST).limit(limit).offset(offset),
      db.select({ n: sql<number>`count(*)::int` }).from(paymentTransactions).where(where),
    ]);
    const total = totalRes[0]?.n ?? 0;

    return { rows, page, limit, total, hasMore: offset + rows.length < total };
  },

  /** Whole-dataset counts/sum grouped by source + mapped flag (one query) — powers the source
   *  filter and summary tiles so they reflect ALL transactions, not just the loaded page. */
  async stats(): Promise<TxStats> {
    const grouped = await db
      .select({
        source: paymentTransactions.source,
        mapped: paymentTransactions.isInvoiceMapped,
        n: sql<number>`count(*)::int`,
        amt: sql<string>`coalesce(sum(${paymentTransactions.amount}), 0)::text`,
      })
      .from(paymentTransactions)
      .groupBy(paymentTransactions.source, paymentTransactions.isInvoiceMapped);

    const out: TxStats = { total: 0, mapped: 0, unmapped: 0, totalAmount: 0, bySource: {} };
    for (const r of grouped) {
      out.total += r.n;
      out.bySource[r.source] = (out.bySource[r.source] ?? 0) + r.n;
      if (r.mapped) out.mapped += r.n;
      else out.unmapped += r.n;
      out.totalAmount += Number(r.amt) || 0;
    }
    return out;
  },

  /** Free-text search across payer/memo/txn fields + exact carrier id. Capped, newest first. */
  async search(query: string, limit = 500): Promise<PaymentTransaction[]> {
    const q = (query || '').trim();
    if (!q) return [];
    const like = `%${q}%`;
    const conds: (SQL | undefined)[] = [
      ilike(paymentTransactions.senderName, like),
      ilike(paymentTransactions.name, like),
      ilike(paymentTransactions.memo, like),
      ilike(paymentTransactions.description, like),
      ilike(paymentTransactions.externalTxnId, like),
      ilike(paymentTransactions.email, like),
    ];
    if (/^\d+$/.test(q)) conds.push(eq(paymentTransactions.carrierId, q));
    return db
      .select()
      .from(paymentTransactions)
      .where(or(...conds))
      .orderBy(NEWEST_FIRST)
      .limit(Math.min(2000, Math.max(1, limit)));
  },

  /** Candidate original payments for a return: MX rows near an amount, on/before a date, by name. */
  async findReturnCandidates(f: CandidateFilters): Promise<PaymentTransaction[]> {
    const conds: SQL[] = [eq(paymentTransactions.source, 'mx')];
    const amt = f.amount != null && f.amount !== '' ? Number(f.amount) : null;
    if (amt != null && Number.isFinite(amt)) {
      conds.push(sql`abs(${paymentTransactions.amount} - ${amt.toFixed(2)}) < 0.01`);
    }
    if (f.beforeDate) conds.push(sql`${paymentTransactions.occurredAt} <= ${f.beforeDate}`);
    const name = (f.customerName || f.query || '').trim();
    if (name) {
      const like = `%${name}%`;
      const nameCond = or(
        ilike(paymentTransactions.senderName, like),
        ilike(paymentTransactions.name, like),
      );
      if (nameCond) conds.push(nameCond);
    }
    return db
      .select()
      .from(paymentTransactions)
      .where(and(...conds))
      .orderBy(NEWEST_FIRST)
      .limit(Math.min(500, Math.max(1, f.limit ?? 50)));
  },

  async getById(id: number): Promise<PaymentTransaction | undefined> {
    const rows = await db.select().from(paymentTransactions).where(eq(paymentTransactions.id, id)).limit(1);
    return rows[0];
  },

  /**
   * Ingest upsert (new data only). Conflict on the natural key updates the source FACT columns +
   * raw + synced_at, but DELIBERATELY leaves the PG-owned mapping/returns columns untouched — a
   * re-sync must never clobber a mapping an agent made.
   */
  async upsertMany(rows: NewPaymentTransaction[]): Promise<number> {
    if (!rows.length) return 0;
    const inserted = await db
      .insert(paymentTransactions)
      .values(rows)
      .onConflictDoUpdate({
        target: [paymentTransactions.source, paymentTransactions.sourceRecordId],
        set: {
          amount: sql`excluded.amount`,
          currency: sql`excluded.currency`,
          occurredAt: sql`excluded.occurred_at`,
          name: sql`excluded.name`,
          status: sql`excluded.status`,
          txnType: sql`excluded.txn_type`,
          externalTxnId: sql`excluded.external_txn_id`,
          senderName: sql`excluded.sender_name`,
          memo: sql`excluded.memo`,
          description: sql`excluded.description`,
          email: sql`excluded.email`,
          cardBrand: sql`excluded.card_brand`,
          cardLast4: sql`excluded.card_last4`,
          customerRef: sql`excluded.customer_ref`,
          receiptUrl: sql`excluded.receipt_url`,
          proposedCarrierIds: sql`excluded.proposed_carrier_ids`,
          sourceModule: sql`excluded.source_module`,
          raw: sql`excluded.raw`,
          syncedAt: sql`now()`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: paymentTransactions.id });
    return inserted.length;
  },

  /** Stamp the mapping columns after a successful CMP apply. Returns the updated row (or undefined). */
  async applyMapping(id: number, patch: MappingPatch): Promise<PaymentTransaction | undefined> {
    const set: Partial<NewPaymentTransaction> = { updatedAt: new Date() };
    if (patch.carrierId !== undefined) set.carrierId = patch.carrierId;
    if (patch.isInvoiceMapped !== undefined) set.isInvoiceMapped = patch.isInvoiceMapped;
    if (patch.mappingType !== undefined) set.mappingType = patch.mappingType;
    if (patch.mappedBy !== undefined) set.mappedBy = patch.mappedBy;
    if (patch.mappedAt !== undefined) set.mappedAt = patch.mappedAt;
    if (patch.cmpRef !== undefined) set.cmpRef = patch.cmpRef;
    if (patch.splitAllocations !== undefined) set.splitAllocations = patch.splitAllocations;
    const rows = await db
      .update(paymentTransactions)
      .set(set)
      .where(eq(paymentTransactions.id, id))
      .returning();
    return rows[0];
  },

  /** Clear all mapping columns after a successful CMP reversal (full unmap). */
  async clearMapping(id: number): Promise<PaymentTransaction | undefined> {
    const rows = await db
      .update(paymentTransactions)
      .set({
        carrierId: null,
        isInvoiceMapped: false,
        mappingType: null,
        mappedBy: null,
        mappedAt: null,
        cmpRef: null,
        splitAllocations: null,
        updatedAt: new Date(),
      })
      .where(eq(paymentTransactions.id, id))
      .returning();
    return rows[0];
  },

  /** Flag a payment as returned/charged-back (mapping is KEPT — widget parity). */
  async setReturned(id: number, at: Date): Promise<PaymentTransaction | undefined> {
    const rows = await db
      .update(paymentTransactions)
      .set({ isReturned: true, returnedAt: at, updatedAt: new Date() })
      .where(eq(paymentTransactions.id, id))
      .returning();
    return rows[0];
  },

  /**
   * Prepay aggregate: sum amount per (carrier_id, source) over [startYmd, endExclusiveYmd) in UTC —
   * feeds the mytrion-ops prepay ledger's zelle/chase/merchant columns. Bounds are UTC (matches how
   * MX `occurred_at` is stored), exclusive end (the widget's date convention).
   */
  async sumForPrepay(
    sources: string[],
    startYmd: string,
    endExclusiveYmd: string,
  ): Promise<Array<{ carrierId: string; source: string; total: number }>> {
    if (sources.length === 0) return [];
    const startUtc = `${startYmd}T00:00:00+00:00`;
    const endUtc = `${endExclusiveYmd}T00:00:00+00:00`;
    const rows = await db
      .select({
        carrierId: paymentTransactions.carrierId,
        source: paymentTransactions.source,
        total: sql<number>`sum(${paymentTransactions.amount})::float8`,
      })
      .from(paymentTransactions)
      .where(
        and(
          inArray(paymentTransactions.source, sources),
          sql`${paymentTransactions.carrierId} is not null`,
          sql`${paymentTransactions.occurredAt} >= ${startUtc}`,
          sql`${paymentTransactions.occurredAt} < ${endUtc}`,
        ),
      )
      .groupBy(paymentTransactions.carrierId, paymentTransactions.source);
    return rows.map((r) => ({ carrierId: String(r.carrierId), source: r.source, total: Number(r.total) || 0 }));
  },

  /** Format money for callers building NewPaymentTransaction rows. */
  money,
};
