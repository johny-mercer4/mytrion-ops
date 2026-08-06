import { and, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  ledgerDailySnapshots,
  type LedgerDailySnapshot,
  type LedgerSnapshotStatus,
  type NewLedgerDailySnapshot,
} from '../db/schema/index.js';

/**
 * ledgerSnapshotRepo — the derived daily ledger cache (TZ §9's daily recompute).
 *
 * UPSERT, not append-only: the table is derived from the opening balances plus the external feeds, and
 * recomputing a past day legitimately changes it (a CMP payment reversal deletes the payment row, so
 * yesterday's AR credit really is different today). Contrast ./ledgerOpeningBalanceRepo.ts, where the
 * inputs are hand-entered and history must be preserved.
 *
 * NUMERIC round-trips as a string in Drizzle, and `opening`/`closing` are deliberately NULLABLE — null
 * means "no opening balance on file", never zero. `money()` preserves that distinction.
 */

/** NUMERIC → fixed-scale string, preserving null (which is meaningful here). */
function money(n: number | null | undefined): string | null {
  if (n === null || n === undefined) return null;
  return n.toFixed(2);
}

const numOrNull = (v: string | null): number | null => {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export interface SnapshotUpsertRow {
  asOfDate: string;
  carrierId: string;
  section: string;
  clientType: string;
  opening: number | null;
  debit: number;
  credit: number;
  closing: number | null;
  externalValue: number | null;
  externalSource: string | null;
  variance: number | null;
  status: LedgerSnapshotStatus;
  detail?: Record<string, number> | undefined;
}

export interface SnapshotRangeAggregate {
  carrierId: string;
  debit: number;
  credit: number;
}

export const ledgerSnapshotRepo = {
  /**
   * Upsert a day's rows in chunks. The unique key is (as_of_date, carrier_id, section), so a re-run
   * REPLACES rather than duplicating — which is what makes the nightly job idempotent.
   */
  async upsertMany(rows: readonly SnapshotUpsertRow[], chunkSize = 500): Promise<number> {
    if (!rows.length) return 0;
    let written = 0;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize).map<NewLedgerDailySnapshot>((r) => ({
        asOfDate: r.asOfDate,
        carrierId: r.carrierId,
        section: r.section,
        clientType: r.clientType,
        opening: money(r.opening),
        debit: money(r.debit) ?? '0',
        credit: money(r.credit) ?? '0',
        closing: money(r.closing),
        externalValue: money(r.externalValue),
        externalSource: r.externalSource,
        variance: money(r.variance),
        status: r.status,
        detail: r.detail ?? null,
      }));
      const res = await db
        .insert(ledgerDailySnapshots)
        .values(chunk)
        .onConflictDoUpdate({
          target: [
            ledgerDailySnapshots.asOfDate,
            ledgerDailySnapshots.carrierId,
            ledgerDailySnapshots.section,
          ],
          set: {
            clientType: sql`excluded.client_type`,
            opening: sql`excluded.opening`,
            debit: sql`excluded.debit`,
            credit: sql`excluded.credit`,
            closing: sql`excluded.closing`,
            externalValue: sql`excluded.external_value`,
            externalSource: sql`excluded.external_source`,
            variance: sql`excluded.variance`,
            status: sql`excluded.status`,
            detail: sql`excluded.detail`,
            computedAt: sql`now()`,
          },
        })
        .returning({ id: ledgerDailySnapshots.id });
      written += res.length;
    }
    return written;
  },

  /** Status counts for a day + section — the control-point queue headline. */
  async statusCounts(
    asOfDate: string,
    section?: string,
  ): Promise<Array<{ section: string; status: string; carriers: number; varianceTotal: number }>> {
    const conds = [eq(ledgerDailySnapshots.asOfDate, asOfDate)];
    if (section) conds.push(eq(ledgerDailySnapshots.section, section));
    const rows = await db
      .select({
        section: ledgerDailySnapshots.section,
        status: ledgerDailySnapshots.status,
        carriers: sql<number>`count(*)::int`,
        varianceTotal: sql<string>`coalesce(sum(abs(${ledgerDailySnapshots.variance})), 0)::text`,
      })
      .from(ledgerDailySnapshots)
      .where(and(...conds))
      .groupBy(ledgerDailySnapshots.section, ledgerDailySnapshots.status);
    return rows.map((r) => ({
      section: r.section,
      status: r.status,
      carriers: r.carriers,
      varianceTotal: Number(r.varianceTotal) || 0,
    }));
  },

  /**
   * The variance queue: rows needing attention for a day, worst first. `ORDER BY` ends in `id` so
   * offset paging cannot skip or repeat a row when many share a variance.
   */
  async listByStatus(opts: {
    asOfDate: string;
    section?: string | undefined;
    statuses: readonly LedgerSnapshotStatus[];
    limit: number;
    offset: number;
  }): Promise<{ rows: LedgerDailySnapshot[]; total: number }> {
    const conds = [
      eq(ledgerDailySnapshots.asOfDate, opts.asOfDate),
      inArray(ledgerDailySnapshots.status, [...opts.statuses]),
    ];
    if (opts.section) conds.push(eq(ledgerDailySnapshots.section, opts.section));
    const where = and(...conds);
    const [rows, counted] = await Promise.all([
      db
        .select()
        .from(ledgerDailySnapshots)
        .where(where)
        .orderBy(
          sql`abs(coalesce(${ledgerDailySnapshots.variance}, 0)) DESC`,
          desc(ledgerDailySnapshots.id),
        )
        .limit(opts.limit)
        .offset(opts.offset),
      db.select({ n: sql<number>`count(*)::int` }).from(ledgerDailySnapshots).where(where),
    ]);
    return { rows, total: counted[0]?.n ?? 0 };
  },

  /** One carrier's snapshot history for a section, newest first — the trend behind a variance. */
  async history(
    carrierId: string,
    section: string,
    limit = 90,
  ): Promise<LedgerDailySnapshot[]> {
    return db
      .select()
      .from(ledgerDailySnapshots)
      .where(
        and(
          eq(ledgerDailySnapshots.carrierId, String(carrierId).trim()),
          eq(ledgerDailySnapshots.section, section),
        ),
      )
      .orderBy(desc(ledgerDailySnapshots.asOfDate), desc(ledgerDailySnapshots.id))
      .limit(Math.min(400, Math.max(1, limit)));
  },

  /**
   * The closing balance per carrier on a given day — the O(1) opening lookup for a period starting the
   * next day, which is the whole reason this table exists.
   */
  async closingOn(
    asOfDate: string,
    section: string,
    carrierIds?: readonly string[],
  ): Promise<Map<string, number | null>> {
    const conds = [
      eq(ledgerDailySnapshots.asOfDate, asOfDate),
      eq(ledgerDailySnapshots.section, section),
    ];
    if (carrierIds?.length) {
      conds.push(inArray(ledgerDailySnapshots.carrierId, [...new Set(carrierIds)]));
    }
    const rows = await db
      .select({ carrierId: ledgerDailySnapshots.carrierId, closing: ledgerDailySnapshots.closing })
      .from(ledgerDailySnapshots)
      .where(and(...conds));
    return new Map(rows.map((r) => [r.carrierId, numOrNull(r.closing)]));
  },

  /** Daily Debit/Credit summed over a range — how a period is derived from the dailies. */
  async aggregateRange(opts: {
    section: string;
    startDate: string;
    endDateInclusive: string;
    carrierIds?: readonly string[] | undefined;
  }): Promise<Map<string, SnapshotRangeAggregate>> {
    const conds = [
      eq(ledgerDailySnapshots.section, opts.section),
      gte(ledgerDailySnapshots.asOfDate, opts.startDate),
      lte(ledgerDailySnapshots.asOfDate, opts.endDateInclusive),
    ];
    if (opts.carrierIds?.length) {
      conds.push(inArray(ledgerDailySnapshots.carrierId, [...new Set(opts.carrierIds)]));
    }
    const rows = await db
      .select({
        carrierId: ledgerDailySnapshots.carrierId,
        debit: sql<string>`coalesce(sum(${ledgerDailySnapshots.debit}), 0)::text`,
        credit: sql<string>`coalesce(sum(${ledgerDailySnapshots.credit}), 0)::text`,
      })
      .from(ledgerDailySnapshots)
      .where(and(...conds))
      .groupBy(ledgerDailySnapshots.carrierId);
    return new Map(
      rows.map((r) => [
        r.carrierId,
        { carrierId: r.carrierId, debit: Number(r.debit) || 0, credit: Number(r.credit) || 0 },
      ]),
    );
  },

  /** The most recent day computed, so a stale cache can be labelled rather than silently served. */
  async latestComputedDate(): Promise<string | null> {
    const rows = await db
      .select({ d: sql<string>`max(${ledgerDailySnapshots.asOfDate})::text` })
      .from(ledgerDailySnapshots);
    return rows[0]?.d ?? null;
  },

  /**
   * Retention: keep every day for `keepDays`, then month-ends only. Called by the sweep job.
   * Returns the number of rows dropped.
   */
  async thinOlderThan(keepDays = 120): Promise<number> {
    const cutoff = new Date(Date.now() - keepDays * 86_400_000).toISOString().slice(0, 10);
    const deleted = await db
      .delete(ledgerDailySnapshots)
      .where(
        and(
          lt(ledgerDailySnapshots.asOfDate, cutoff),
          // Keep month-ends: a day whose successor is in a different month is a month-end.
          sql`${ledgerDailySnapshots.asOfDate} <> (date_trunc('month', ${ledgerDailySnapshots.asOfDate}::date) + interval '1 month' - interval '1 day')::date`,
        ),
      )
      .returning({ id: ledgerDailySnapshots.id });
    return deleted.length;
  },
};
