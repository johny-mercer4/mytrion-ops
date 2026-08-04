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

/**
 * Money-ish search query → the amount it names ("$1,234.56", "1,234", "500.5" → 1234.56 / 1234 / 500.5).
 * `exact` is false for a whole-dollar query, which matches the cents range (1234 → 1234.00–1234.99)
 * so a user who types the dollars finds the row without knowing its cents.
 * (Mirrored client-side in apps/mytrion-crm/src/mytrions/billing/transactionModel.ts.)
 */
export function parseAmountQuery(query: string): { value: number; exact: boolean } | null {
  const s = (query || '').trim().replace(/^\$\s*/, '').replace(/,/g, '');
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(s)) return null;
  const value = Number(s);
  return Number.isFinite(value) ? { value, exact: s.includes('.') } : null;
}

/** Candidate-search filters (a return → its original MX payment). */
export interface CandidateFilters {
  query?: string | undefined;
  amount?: string | number | undefined;
  beforeDate?: string | undefined;
  customerName?: string | undefined;
  limit?: number | undefined;
}

/**
 * Which pass produced the candidate list (the picker labels the list from this):
 *   text    → the agent's own query (reference / Payment ID / customer)
 *   suggest → same amount or same customer, on/before the return date
 *   window  → nothing suggested, so every MX charge in the 7 days before the return
 */
export type CandidateMode = 'text' | 'suggest' | 'window';

export interface CandidateResult {
  rows: PaymentTransaction[];
  mode: CandidateMode;
}

/** End of the return day ('2026-07-20' → '2026-07-20 23:59:59+00'); the payment precedes the return. */
function dayEndBound(day: string | undefined): string | null {
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day} 23:59:59+00` : null;
}

/** N days before a yyyy-mm-dd day, as a start-of-day bound. */
function dayStartBefore(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return `${d.toISOString().slice(0, 10)} 00:00:00+00`;
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

  /** Free-text search across payer/memo/txn fields + exact carrier id + amount. Capped, newest first. */
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
    // Amount search: compare on abs() so a query works for returns/refunds stored as negatives.
    const amt = parseAmountQuery(q);
    if (amt) {
      const abs = sql`abs(${paymentTransactions.amount})`;
      conds.push(
        amt.exact
          ? sql`${abs} = ${amt.value.toFixed(2)}`
          : sql`${abs} >= ${amt.value.toFixed(2)} and ${abs} < ${(amt.value + 1).toFixed(2)}`,
      );
    }
    return db
      .select()
      .from(paymentTransactions)
      .where(or(...conds))
      .orderBy(NEWEST_FIRST)
      .limit(Math.min(2000, Math.max(1, limit)));
  },

  /**
   * Candidate original payments for a return (MX only — returns originate from MX charges). Port of
   * the Deluge mytrionSearchReturnCandidates' three modes.
   *
   * The agent's typed query used to be DISCARDED whenever the return carried a customer name
   * (`customerName || query`), and neither the reference nor the Payment ID was ever searched — so
   * pasting the value the return arrived with found nothing. Text mode now searches both id columns:
   * `external_txn_id` is the MX Reference, `source_record_id` is the MX payment id (the field Zoho
   * labels "Payment ID" and stores in Name), and a return's reference can be either one.
   */
  async findReturnCandidates(f: CandidateFilters): Promise<CandidateResult> {
    const limit = Math.min(500, Math.max(1, f.limit ?? 50));
    const isMx = eq(paymentTransactions.source, 'mx');
    const page = (where: SQL | undefined): Promise<PaymentTransaction[]> =>
      db.select().from(paymentTransactions).where(where).orderBy(NEWEST_FIRST).limit(limit);

    // ── TEXT: the agent is looking for something specific. No amount/date narrowing — an exact
    //    amount match is what already failed automatically, and a partial return differs anyway.
    const query = (f.query ?? '').trim();
    if (query.length >= 2) {
      const like = `%${query}%`;
      const hit = or(
        ilike(paymentTransactions.externalTxnId, like), // MX Reference
        ilike(paymentTransactions.sourceRecordId, like), // MX Payment ID (Zoho: Name)
        ilike(paymentTransactions.senderName, like),
        ilike(paymentTransactions.name, like),
      );
      return { rows: await page(and(isMx, hit)), mode: 'text' };
    }

    // ── SUGGEST: same amount OR same customer, on/before the return date. The reference already
    //    failed to match, so these are the next-strongest signals (the widget ORs them too).
    const endBound = dayEndBound(f.beforeDate);
    const terms: SQL[] = [];
    const amt = f.amount != null && f.amount !== '' ? Number(f.amount) : null;
    if (amt != null && Number.isFinite(amt)) {
      terms.push(sql`abs(${paymentTransactions.amount} - ${amt.toFixed(2)}) < 0.01`);
    }
    const customer = (f.customerName ?? '').trim();
    if (customer.length >= 3) {
      const like = `%${customer}%`;
      const nameCond = or(ilike(paymentTransactions.senderName, like), ilike(paymentTransactions.name, like));
      if (nameCond) terms.push(nameCond);
    }
    if (terms.length) {
      const conds: SQL[] = [isMx];
      const anyTerm = terms.length === 1 ? terms[0] : or(...terms);
      if (anyTerm) conds.push(anyTerm);
      if (endBound) conds.push(sql`${paymentTransactions.occurredAt} <= ${endBound}`);
      const rows = await page(and(...conds));
      if (rows.length) return { rows, mode: 'suggest' };
    }

    // ── WINDOW: nothing suggested → the 7 days leading up to the return, so there is something to scan.
    if (endBound && f.beforeDate) {
      const rows = await page(
        and(
          isMx,
          sql`${paymentTransactions.occurredAt} >= ${dayStartBefore(f.beforeDate, 7)}`,
          sql`${paymentTransactions.occurredAt} <= ${endBound}`,
        ),
      );
      return { rows, mode: 'window' };
    }
    return { rows: [], mode: 'suggest' };
  },

  async getById(id: number): Promise<PaymentTransaction | undefined> {
    const rows = await db.select().from(paymentTransactions).where(eq(paymentTransactions.id, id)).limit(1);
    return rows[0];
  },

  /** Look up a row by its natural key (source, source_record_id) — e.g. to detect a duplicate
   *  manual add before upserting (the upsert would silently update, hiding the duplicate). */
  async findBySourceRecord(source: string, sourceRecordId: string): Promise<PaymentTransaction | undefined> {
    const rows = await db
      .select()
      .from(paymentTransactions)
      .where(and(eq(paymentTransactions.source, source), eq(paymentTransactions.sourceRecordId, sourceRecordId)))
      .limit(1);
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

  /**
   * Flag a just-ingested row as mapped WITHOUT any CMP action — for feeds that arrive already
   * reconciled (e.g. the pre-mapped Stripe accounts that need no invoice payment, so they should
   * skip the agent's unmapped queue). Flips ONLY when the row is still unmapped, so a Zap retry
   * never re-stamps mapped_at and a mapping an agent made in the app is never clobbered.
   */
  async markIngestMapped(
    source: string,
    sourceRecordId: string,
    opts: { mappingType?: string; mappedBy?: string } = {},
  ): Promise<PaymentTransaction | undefined> {
    const rows = await db
      .update(paymentTransactions)
      .set({
        isInvoiceMapped: true,
        mappingType: opts.mappingType ?? 'Stripe (auto)',
        mappedBy: opts.mappedBy ?? 'Zapier (auto)',
        mappedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(paymentTransactions.source, source),
          eq(paymentTransactions.sourceRecordId, sourceRecordId),
          eq(paymentTransactions.isInvoiceMapped, false),
        ),
      )
      .returning();
    return rows[0];
  },

  /**
   * Stamp a carrier resolved by the CMP-direct name search (servercrm's ingest-time auto-map job,
   * `jobs/mxAutoMapByName.js`) onto a specific row. Same guarded shape as `markIngestMapped` (flips
   * only when still unmapped, so a lost race or a re-attempt never clobbers a mapping made since —
   * by an agent, or by this same job's own previous tick) but keyed on `id` (the job already has it
   * from its own SELECT) and also requires no `carrier_id` already on file, so a name-guessed
   * carrier can never override one this system already knows for certain.
   */
  async applyAutoMap(
    id: number,
    opts: { carrierId: string; mappingType: string; mappedBy: string },
  ): Promise<PaymentTransaction | undefined> {
    const rows = await db
      .update(paymentTransactions)
      .set({
        carrierId: opts.carrierId,
        isInvoiceMapped: true,
        mappingType: opts.mappingType,
        mappedBy: opts.mappedBy,
        mappedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(paymentTransactions.id, id),
          eq(paymentTransactions.isInvoiceMapped, false),
          sql`coalesce(${paymentTransactions.carrierId}, '') = ''`,
        ),
      )
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
   * Whether some OTHER transaction's stored CMP reference already points at this exact CMP payment
   * — guards a resolver-based reversal (returnsCmpReversal.ts) from deleting a payment that's
   * genuinely the record of a different, already-mapped charge. `excludeId` is the row being
   * reversed itself (never a false positive against its own, usually-empty, ref).
   */
  async isCmpPaymentClaimed(invoiceId: string, paymentId: string, excludeId: number): Promise<boolean> {
    const rows = await db.execute(sql`
      select exists (
        select 1 from payment_transactions
        where id != ${excludeId}
          and (
            (cmp_ref ->> 'paymentId' = ${paymentId} and cmp_ref ->> 'invoiceId' = ${invoiceId})
            or exists (
              select 1 from jsonb_array_elements(coalesce(split_allocations, '[]'::jsonb)) as e
              where e ->> 'paymentId' = ${paymentId} and e ->> 'invoiceId' = ${invoiceId}
            )
          )
      ) as hit
    `);
    return Boolean(rows[0]?.hit);
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
