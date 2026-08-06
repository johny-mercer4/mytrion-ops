import { sql } from 'drizzle-orm';
import {
  bigserial,
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * ledger_daily_snapshots — one computed Opening/Debit/Credit/Closing per carrier per section per day,
 * with the external figure it was reconciled against (TZ §9's daily control point).
 *
 * WHY IT EXISTS. Two reasons, both structural:
 *   • EFS is a live, per-carrier, rate-limited vendor API. Reconciling Customer Balance against the
 *     real EFS balance cannot happen inside a page load for 2,800 carriers. The nightly job is the only
 *     EFS consumer, and it uses the BATCH endpoint.
 *   • It makes an arbitrary period cheap. `opening` for any window is the snapshot closing at
 *     (start − 1 day), and Debit/Credit are the sum of the daily rows across the range — one indexed
 *     Postgres query instead of re-running seven DWH aggregates plus a per-carrier roll-forward.
 *
 * DERIVED, therefore UPSERTED — unlike ./ledger_opening_balances.ts, which is append-only. The source
 * of truth is the opening balances plus the external feeds, and a recompute of a past day legitimately
 * changes: a CMP payment reversal deletes the payment row, so yesterday's AR credit really is different
 * today. Append-only here would accumulate garbage revisions of a cache.
 *
 * `opening`/`closing` are NULLABLE and stay null when the carrier has no opening balance — the same
 * rule the compute layer enforces. `status` distinguishes that case (`no_opening`) from a genuine
 * variance so the launch-migration backlog stays measurable instead of drowning the real queue.
 *
 * Not tenant-scoped — see the header of ./ledger_opening_balances.ts.
 *
 * Sizing: ~2,850 in-scope carriers × 3 sections ≈ 8.5k rows/day ≈ 3.1M/year. Thin rows older than 120
 * days to month-ends only.
 */
export type LedgerSnapshotStatus =
  /** Closing matches the external source within tolerance. */
  | 'ok'
  /** Outside tolerance, both sides known — a work item. */
  | 'variance'
  /** No opening balance on file, so no closing could be stated. Distinct from `variance` on purpose. */
  | 'no_opening'
  /** The external feed failed (EFS 502, DWH statement_timeout) — degrade the row, not the run. */
  | 'source_unavailable'
  /** The external value is from a different day than `as_of_date` (EFS answers "now" only). */
  | 'stale_external';

export const ledgerDailySnapshots = pgTable(
  'ledger_daily_snapshots',
  {
    // High row count and no natural text key → bigserial, the payment_transactions precedent.
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    asOfDate: date('as_of_date').notNull(),
    carrierId: text('carrier_id').notNull(),
    section: text('section').notNull(),
    /** The type RESOLVED AT COMPUTE TIME, so a later type change does not silently rewrite history. */
    clientType: text('client_type').notNull(),

    /** NULL when no opening balance exists — never coerced to 0. */
    opening: numeric('opening', { precision: 14, scale: 2 }),
    debit: numeric('debit', { precision: 14, scale: 2 }).notNull().default('0'),
    credit: numeric('credit', { precision: 14, scale: 2 }).notNull().default('0'),
    /** NULL whenever `opening` is NULL. */
    closing: numeric('closing', { precision: 14, scale: 2 }),

    /** EFS balance / CMP figure. NULL when the source failed or does not apply. */
    externalValue: numeric('external_value', { precision: 14, scale: 2 }),
    /** 'efs' | 'cmp_balance_after' | 'cmp_invoice' | 'payments_unapplied' | null. */
    externalSource: text('external_source'),
    /** closing − external_value. NULL when either side is unknown. */
    variance: numeric('variance', { precision: 14, scale: 2 }),

    status: text('status').$type<LedgerSnapshotStatus>().notNull(),
    /** Component breakdown (fuel / money code / maintenance / loads / draws …) for the drill-down. */
    detail: jsonb('detail').$type<Record<string, number>>(),

    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    /** The upsert key — one row per day per carrier per section. */
    dayUk: uniqueIndex('ledger_daily_snapshots_day_uk').on(
      table.asOfDate,
      table.carrierId,
      table.section,
    ),
    /** The control-point queues: "show me today's variances for AR". */
    queueIdx: index('ledger_daily_snapshots_queue_idx').on(
      table.asOfDate,
      table.section,
      table.status,
    ),
    /** Per-carrier history + the (start − 1 day) opening lookup. */
    carrierIdx: index('ledger_daily_snapshots_carrier_idx').on(
      table.carrierId,
      table.section,
      sql`${table.asOfDate} DESC`,
    ),
  }),
);

export type LedgerDailySnapshot = typeof ledgerDailySnapshots.$inferSelect;
export type NewLedgerDailySnapshot = typeof ledgerDailySnapshots.$inferInsert;
