/**
 * Aging and the control points from TZ §9.
 *
 * Four things live here, each a "signal" the TZ asks for rather than a balance:
 *   • AR aging — how overdue the open invoices are, in the TZ's buckets (plus two it omits; see
 *     ./arRules.ts for why `current` and `no_due_date` had to be added).
 *   • Unbilled aging — spend that should already have been invoiced. Measured against the carrier's own
 *     last invoice window rather than calendar arithmetic on `billing_cycle`, because the invoice's
 *     `date_to` is what CMP actually billed through.
 *   • Un Top-Upped aging — the TZ's 24-hour alarm on money received but not yet loaded.
 *   • The top-level control sum — total funding out vs total loaded on.
 */
import { dwh } from '../../../integrations/dwh.js';
import { paymentTransactionRepo } from '../../../repos/paymentTransactionRepo.js';
import {
  LEDGER_AGING_BUCKETS,
  OPEN_INVOICE,
  DUE,
  agingBucketSql,
  agingOrderSql,
  type AgingBucketDef,
} from './arRules.js';
import { LEDGER_TZ } from './feeds.js';

const round2 = (x: number): number => Math.round(x * 100) / 100;

export interface AgingBucketResult {
  key: string;
  label: string;
  tone: AgingBucketDef['tone'];
  amount: number;
  invoices: number;
  carriers: number;
}

export interface ArAgingResult {
  buckets: AgingBucketResult[];
  total: number;
  invoices: number;
  /** Surfaced separately as a data-quality flag rather than folded into a real bucket. */
  noDueDate: { amount: number; invoices: number };
}

/**
 * AR aging across the open book, bucketed by days past due.
 *
 * Point-in-time by nature — "how overdue is it" is answered against today, not against a period. The
 * bucket SQL is generated from the shared definition so this and the Receivables analytics report cannot
 * drift on what counts as open.
 */
export async function arAging(carrierIds?: readonly string[]): Promise<ArAgingResult> {
  const params: unknown[] = [];
  let filter = '';
  if (carrierIds?.length) {
    params.push([...new Set(carrierIds)]);
    filter = ` AND i.carrier_id::text = ANY($${params.length}::text[])`;
  }
  const bucketSql = agingBucketSql(LEDGER_AGING_BUCKETS);
  const rows = await dwh.query<{
    bucket: string;
    amt: string;
    invoices: string;
    carriers: string;
  }>(
    `SELECT ${bucketSql} AS bucket,
            COALESCE(SUM(${DUE}), 0)          AS amt,
            COUNT(*)                          AS invoices,
            COUNT(DISTINCT i.carrier_id)      AS carriers
       FROM public.cmp_invoice i
      WHERE ${OPEN_INVOICE}${filter}
      GROUP BY bucket
      ORDER BY ${agingOrderSql(LEDGER_AGING_BUCKETS)}`,
    params,
  );

  const byKey = new Map(rows.map((r) => [r.bucket, r]));
  const buckets = LEDGER_AGING_BUCKETS.map((def) => {
    const row = byKey.get(def.key);
    return {
      key: def.key,
      label: def.label,
      tone: def.tone,
      amount: round2(Number(row?.amt ?? 0)),
      invoices: Number(row?.invoices ?? 0),
      carriers: Number(row?.carriers ?? 0),
    };
  });

  const noDue = buckets.find((b) => b.key === 'no_due_date');
  return {
    buckets,
    total: round2(buckets.reduce((n, b) => n + b.amount, 0)),
    invoices: buckets.reduce((n, b) => n + b.invoices, 0),
    noDueDate: { amount: noDue?.amount ?? 0, invoices: noDue?.invoices ?? 0 },
  };
}

export interface UnbilledOverCycleRow {
  carrierId: string;
  companyName: string;
  /** Card spend dated on or before the carrier's last invoiced-through date. */
  amount: number;
  transactions: number;
  /** The `date_to` of the carrier's most recent invoice — what CMP has billed through. */
  lastInvoicedThrough: string | null;
  oldestDays: number;
}

/**
 * Spend that SHOULD already have been invoiced (TZ §5.1's control point on Unbilled Transactions).
 *
 * The test is per-carrier and data-driven: anything dated at or before that carrier's most recent
 * invoice `date_to` was inside a window CMP has already billed, so if it is still unbilled CMP missed
 * it. Transactions dated after that are simply in flight and are NOT flagged.
 *
 * Chosen over calendar arithmetic on `dim_company.billing_cycle` / `payment_day` because the invoice's
 * own window is the authoritative statement of what was billed, and the cycle fields drift.
 */
export async function unbilledOverCycle(limit = 100): Promise<UnbilledOverCycleRow[]> {
  const rows = await dwh.query<{
    carrier_id: string | number;
    company_name: string | null;
    amt: string;
    txns: string;
    last_through: string | Date | null;
    oldest_days: string | null;
  }>(
    `WITH last_inv AS (
       SELECT carrier_id, MAX(date_to) AS last_through
         FROM public.cmp_invoice
        WHERE status <> 'CANCELLED'
        GROUP BY carrier_id
     ),
     company AS (
       SELECT DISTINCT ON (carrier_id) carrier_id, company_name
         FROM octane.dim_company
        WHERE carrier_id IS NOT NULL
        ORDER BY carrier_id, update_date DESC NULLS LAST
     )
     SELECT t.carrier_id,
            c.company_name,
            COALESCE(SUM(t.funded_total), 0)                        AS amt,
            COUNT(*)                                                AS txns,
            l.last_through,
            MAX((CURRENT_DATE - t.transaction_date::date))::int      AS oldest_days
       FROM public.cmp_transaction t
       JOIN last_inv l ON l.carrier_id = t.carrier_id
       LEFT JOIN company c ON c.carrier_id::text = t.carrier_id::text
      WHERE t.carrier_id IS NOT NULL
        -- Inside a window CMP has already billed through, yet still carrying no invoice reference.
        AND t.transaction_date < l.last_through
        AND (t.invoice_ref IS NULL OR btrim(t.invoice_ref) = '')
      GROUP BY t.carrier_id, c.company_name, l.last_through
     HAVING COALESCE(SUM(t.funded_total), 0) > 0
      ORDER BY amt DESC, t.carrier_id
      LIMIT ${Math.min(500, Math.max(1, limit))}`,
  );

  return rows.map((r) => ({
    carrierId: String(r.carrier_id),
    companyName: r.company_name ?? '',
    amount: round2(Number(r.amt)),
    transactions: Number(r.txns),
    lastInvoicedThrough: r.last_through
      ? String(r.last_through instanceof Date ? r.last_through.toISOString() : r.last_through).slice(0, 10)
      : null,
    oldestDays: Number(r.oldest_days ?? 0),
  }));
}

/** The TZ's 24-hour checkpoint on Un Top-Upped Payments, plus the longer tails. */
export const UNTOPPED_BUCKETS = [
  { key: 'lt24h', label: 'Under 24h', maxHours: 24, tone: 'good' as const },
  { key: 'h24_72', label: '24–72h', maxHours: 72, tone: 'warn' as const },
  { key: 'd3_7', label: '3–7 days', maxHours: 168, tone: 'danger' as const },
  { key: 'gt7d', label: 'Over 7 days', maxHours: Number.POSITIVE_INFINITY, tone: 'danger' as const },
];

export interface UntoppedAgingResult {
  buckets: { key: string; label: string; tone: 'good' | 'warn' | 'danger'; amount: number; payments: number }[];
  /** Anything past 24h — the TZ's alarm threshold. */
  alarmAmount: number;
  alarmPayments: number;
  total: number;
}

/**
 * Aging of money received but not yet loaded onto EFS.
 *
 * Covered by the existing `payment_transactions_mapped_idx` on (is_invoice_mapped, occurred_at) — no new
 * index needed.
 */
export async function untoppedAging(carrierIds?: readonly string[]): Promise<UntoppedAgingResult> {
  const rows = await paymentTransactionRepo.unappliedAgeRows(carrierIds);
  const buckets = UNTOPPED_BUCKETS.map((b) => ({
    key: b.key,
    label: b.label,
    tone: b.tone,
    amount: 0,
    payments: 0,
  }));

  let total = 0;
  let alarmAmount = 0;
  let alarmPayments = 0;
  for (const r of rows) {
    total += r.amount;
    const idx = UNTOPPED_BUCKETS.findIndex((b) => r.ageHours < b.maxHours);
    const bucket = buckets[idx === -1 ? buckets.length - 1 : idx];
    if (bucket) {
      bucket.amount = round2(bucket.amount + r.amount);
      bucket.payments += 1;
    }
    if (r.ageHours >= 24) {
      alarmAmount += r.amount;
      alarmPayments += 1;
    }
  }

  return {
    buckets,
    alarmAmount: round2(alarmAmount),
    alarmPayments,
    total: round2(total),
  };
}

export interface ControlSumCheck {
  key: string;
  label: string;
  left: { label: string; amount: number };
  right: { label: string; amount: number };
  variance: number;
  status: 'ok' | 'variance';
}

/**
 * The top-level control sum (TZ §9's last checkpoint): total outflow from the funding account should
 * equal the total loaded onto customer balances.
 *
 * ⚠️ Ships the CMP-INTERNAL leg only. The TZ names the EFS Parent Account as the left-hand side, but
 * `fetchEfsLoads` is per-carrier and 90-day capped — 2,800 calls is not a design. So this compares CMP's
 * own movement total against the sum of its per-carrier `balance_after` deltas: fully computable, no
 * vendor calls, and it catches the failure this check exists for (a load recorded against one side and
 * not the other). The true EFS-parent leg needs the `finance.parent_snapshot` payload inspected first —
 * open question 8 in the plan.
 */
export async function controlSums(period: {
  startDate: string;
  endDateExclusive: string;
}): Promise<ControlSumCheck[]> {
  const rows = await dwh.query<{ loads: string; draws: string; carriers: string }>(
    `SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount END), 0)  AS loads,
            COALESCE(SUM(CASE WHEN amount < 0 THEN -amount END), 0) AS draws,
            COUNT(DISTINCT carrier_id)                              AS carriers
       FROM public.cmp_billing_history
      WHERE create_date >= $1::date - interval '1 day'
        AND create_date <  $2::date + interval '1 day'
        AND (create_date AT TIME ZONE 'UTC' AT TIME ZONE '${LEDGER_TZ}')::date >= $1::date
        AND (create_date AT TIME ZONE 'UTC' AT TIME ZONE '${LEDGER_TZ}')::date <  $2::date`,
    [period.startDate, period.endDateExclusive],
  );
  const agg = rows[0];
  const loads = round2(Number(agg?.loads ?? 0));
  const draws = round2(Number(agg?.draws ?? 0));

  // The staging table carries CMP's own running balance, so the sum of its per-carrier deltas over the
  // window is an independent restatement of the same movement.
  const deltaRows = await dwh.query<{ delta: string }>(
    `WITH bounds AS (
       SELECT carrier_id,
              (ARRAY_AGG(balance_after ORDER BY create_date DESC))[1] AS last_after,
              (ARRAY_AGG(balance_after ORDER BY create_date ASC))[1]  AS first_after,
              (ARRAY_AGG(amount        ORDER BY create_date ASC))[1]  AS first_amount
         FROM octane.stg_cmp_billing_history
        WHERE (create_date AT TIME ZONE 'UTC' AT TIME ZONE '${LEDGER_TZ}')::date >= $1::date
          AND (create_date AT TIME ZONE 'UTC' AT TIME ZONE '${LEDGER_TZ}')::date <  $2::date
          AND balance_after IS NOT NULL
        GROUP BY carrier_id
     )
     SELECT COALESCE(SUM(last_after - (first_after - COALESCE(first_amount, 0))), 0) AS delta
       FROM bounds`,
    [period.startDate, period.endDateExclusive],
  );
  const balanceDelta = round2(Number(deltaRows[0]?.delta ?? 0));
  const netMovement = round2(loads - draws);
  const variance = round2(netMovement - balanceDelta);

  return [
    {
      key: 'cmp_internal',
      label: 'CMP movement vs its own running balance',
      left: { label: 'Loads − draws', amount: netMovement },
      right: { label: 'Balance-after delta', amount: balanceDelta },
      variance,
      status: Math.abs(variance) <= 1 ? 'ok' : 'variance',
    },
    {
      key: 'loads_draws',
      label: 'Loads vs draws',
      left: { label: 'Loads', amount: loads },
      right: { label: 'Draws', amount: draws },
      variance: netMovement,
      status: 'ok',
    },
  ];
}
