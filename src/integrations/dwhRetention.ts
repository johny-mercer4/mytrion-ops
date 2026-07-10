/**
 * DWH retention signals — the transaction-frequency layer that feeds retention-case
 * generation. Reads `octane.dim_company` (client identity; debtors and never-swiped
 * companies excluded at the source) joined with 90-day aggregates from
 * `octane.mart_transaction_line_items`. Read-only (dwhQuery pool enforces it).
 *
 * Frequency model (Retention future workflow, entry point):
 *   high   — a transaction expected every 2 days
 *   medium — every 5 days
 *   low    — every 7 days
 * A carrier is classified from its average transaction gap over the last 90 days and
 * BREACHES when its days-inactive exceed the class threshold.
 */
import type { FrequencyClass } from '../db/schema/index.js';
import { dwhQuery } from './dwh.js';

export const FREQUENCY_THRESHOLD_DAYS: Record<FrequencyClass, number> = {
  high: 2,
  medium: 5,
  low: 7,
};

/** Classify a carrier from its distinct transaction days in the last 90 days. */
export function classifyFrequency(txDays90d: number): {
  frequencyClass: FrequencyClass;
  thresholdDays: number;
} {
  const avgGapDays = txDays90d >= 2 ? 90 / txDays90d : Number.POSITIVE_INFINITY;
  const frequencyClass: FrequencyClass =
    avgGapDays <= FREQUENCY_THRESHOLD_DAYS.high
      ? 'high'
      : avgGapDays <= FREQUENCY_THRESHOLD_DAYS.medium
        ? 'medium'
        : 'low';
  return { frequencyClass, thresholdDays: FREQUENCY_THRESHOLD_DAYS[frequencyClass] };
}

/** Whole days elapsed since a timestamp (floored; never negative). */
export function daysSince(date: Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86_400_000));
}

export interface RetentionCandidate {
  carrierId: string;
  companyName: string | null;
  applicationId: string | null;
  agentName: string | null;
  agentZohoUserId: string | null;
  activeCards: number | null;
  lastTransactionAt: Date | null;
  daysInactive: number;
  txCount90d: number;
  gallons90d: number;
  frequencyClass: FrequencyClass;
  thresholdDays: number;
  /** True when daysInactive exceeds the class threshold — the case-generation trigger. */
  breached: boolean;
}

interface CandidateRow {
  carrier_id: number;
  company_name: string | null;
  application_id: number | null;
  agent: string | null;
  agent_zoho_user_id: number | null;
  total_active_cards: number | string | null;
  last_tx: string | Date | null;
  tx_days_90d: number | string | null;
  gallons_90d: number | string | null;
}

function toDate(v: string | Date | null): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toCandidate(row: CandidateRow, now: Date): RetentionCandidate {
  const lastTransactionAt = toDate(row.last_tx);
  const daysInactive = lastTransactionAt ? daysSince(lastTransactionAt, now) : 90;
  const txCount90d = Number(row.tx_days_90d ?? 0);
  const { frequencyClass, thresholdDays } = classifyFrequency(txCount90d);
  return {
    carrierId: String(row.carrier_id),
    companyName: row.company_name,
    applicationId: row.application_id != null ? String(row.application_id) : null,
    agentName: row.agent,
    agentZohoUserId: row.agent_zoho_user_id != null ? String(row.agent_zoho_user_id) : null,
    activeCards: row.total_active_cards != null ? Number(row.total_active_cards) : null,
    lastTransactionAt,
    daysInactive,
    txCount90d,
    gallons90d: Number(row.gallons_90d ?? 0),
    frequencyClass,
    thresholdDays,
    breached: daysInactive > thresholdDays,
  };
}

/**
 * Scan for frequency-breach candidates: active, non-debtor carriers with at least one
 * historical swipe whose latest transaction is older than the MINIMUM threshold (2 days —
 * precise per-class breach filtering happens in `toCandidate`). `lookbackDays` bounds how
 * long-dead an account may be and still enter the scan (long-churned accounts were
 * caught when they lapsed; re-sweeping them nightly would flood the list forever).
 * Highest 90-day volume first — the SOP's "high-volume clients with a recent drop".
 */
export async function scanRetentionCandidates(
  opts: { lookbackDays?: number; limit?: number; now?: Date } = {},
): Promise<RetentionCandidate[]> {
  const lookbackDays = Math.min(Math.max(opts.lookbackDays ?? 45, 3), 365);
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 2000);
  const rows = await dwhQuery<CandidateRow>(
    `with tx as (
       select carrier_id,
              max(transaction_date)                       as last_tx_90d,
              count(distinct transaction_date::date)      as tx_days_90d,
              coalesce(sum(transaction_fuel_quantity), 0) as gallons_90d
         from octane.mart_transaction_line_items
        where carrier_id is not null
          and transaction_date >= now() - interval '90 days'
        group by carrier_id
     ),
     company as (
       select distinct on (carrier_id)
              carrier_id, company_name, application_id, agent, agent_zoho_user_id,
              total_active_cards, last_transaction_date
         from octane.dim_company
        where carrier_id is not null
          and is_active = 1
          and coalesce(is_debtor, false) = false
          and first_swipe_date is not null
        order by carrier_id, update_date desc nulls last
     )
     select c.carrier_id,
            c.company_name,
            c.application_id,
            c.agent,
            c.agent_zoho_user_id,
            c.total_active_cards,
            greatest(tx.last_tx_90d, c.last_transaction_date) as last_tx,
            coalesce(tx.tx_days_90d, 0)                       as tx_days_90d,
            coalesce(tx.gallons_90d, 0)                       as gallons_90d
       from company c
       left join tx on tx.carrier_id = c.carrier_id
      where greatest(tx.last_tx_90d, c.last_transaction_date) is not null
        and greatest(tx.last_tx_90d, c.last_transaction_date) < now() - interval '2 days'
        and greatest(tx.last_tx_90d, c.last_transaction_date) >= now() - ($1 || ' days')::interval
      order by coalesce(tx.gallons_90d, 0) desc
      limit ${limit}`,
    [String(lookbackDays)],
  );
  const now = opts.now ?? new Date();
  return rows.map((row) => toCandidate(row, now));
}

/**
 * Latest transaction per carrier (any age) — used to close open cases whose client came
 * back ("Returned" branch). Non-numeric ids are skipped (carrier ids are DWH integers).
 */
export async function fetchCarrierLastTransactions(
  carrierIds: string[],
): Promise<Map<string, Date>> {
  const numeric = [...new Set(carrierIds.filter((id) => /^\d+$/.test(id)))];
  const result = new Map<string, Date>();
  if (numeric.length === 0) return result;
  const rows = await dwhQuery<{ carrier_id: number; last_tx: string | Date | null }>(
    `select carrier_id, max(transaction_date) as last_tx
       from octane.mart_transaction_line_items
      where carrier_id = any($1::int[])
      group by carrier_id`,
    [numeric],
  );
  for (const row of rows) {
    const d = toDate(row.last_tx);
    if (d) result.set(String(row.carrier_id), d);
  }
  return result;
}
