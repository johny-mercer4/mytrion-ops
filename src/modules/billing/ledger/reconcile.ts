/**
 * Reconciliation — compare each section's Closing against an INDEPENDENT source (TZ §5, §9).
 *
 * This is the mechanism the whole module exists for: CMP generates the invoices, EFS holds the real
 * balances, and the Ledger's job is to be the third party that checks them against each other rather
 * than trusting either. So two rules are absolute:
 *
 *   • **Never auto-adjust the ledger to match the external source.** A variance is a WORK ITEM. Silently
 *     writing CMP's number into our closing balance would destroy the only signal the module produces.
 *     Any correction goes through a new opening-balance revision, which is audited.
 *
 *   • **A failed source is not a match.** If EFS 502s, the row is `source_unavailable`, not `ok`. Every
 *     external read is wrapped so one dead source degrades a row instead of failing the whole run.
 *
 * ⚠️ LIVE-EFS RECONCILIATION IS NOT WIRED, DELIBERATELY. Two independent blockers:
 *
 *   1. **No batch endpoint exists.** servercrm exposes only `GET /api/smart-balance/carrier-balance?
 *      carrierId=` (one carrier); the batched `getChildBalancesByCarrierIds` is an internal function
 *      with no route in front of it (verified 2026-08-06). Reconciling 2,800 carriers through the
 *      single endpoint is 2,800 calls against a rate-limited vendor API — an outage, not a slow job.
 *   2. **EFS has no as-of parameter.** It answers "what is the balance NOW", so even with a batch route
 *      a HISTORICAL day could never be checked against it.
 *
 * So Customer Balance reconciles against CMP's own `balance_after` running total on every day, tagged
 * `cmp_balance_after` — nobody should mistake it for an EFS confirmation. Enabling the live-EFS leg
 * needs a servercrm batch route first; when it exists, `fetchExternal` is the one place to change.
 * This is open question 2 in the plan.
 */
import { logger } from '../../../lib/logger.js';
import type { SectionMovement } from './compute.js';
import { cmpBalanceAsOf, openInvoiceBalance, unappliedPayments } from './feeds.js';
import { getLedgerSection, type LedgerSectionId } from './sections.js';
import type { LedgerSnapshotStatus } from '../../../db/schema/index.js';

/**
 * A variance under $1.00 is noise, not a finding — the floor matches `DEBT_OPEN_BALANCE_MIN`, which is
 * the threshold the debtors queue already uses for "is this worth chasing".
 */
export const TOLERANCE_ABS = 1.0;
/** 0.1% — rounding drift compounds on a six-figure balance and is not a reconciliation failure. */
export const TOLERANCE_REL = 0.001;

export function withinTolerance(closing: number, external: number): boolean {
  const variance = Math.abs(closing - external);
  return variance <= Math.max(TOLERANCE_ABS, Math.abs(external) * TOLERANCE_REL);
}

export interface ReconciledRow extends SectionMovement {
  externalValue: number | null;
  externalSource: string | null;
  variance: number | null;
  status: LedgerSnapshotStatus;
}

/** carrierId → balance, or a failure marker so the caller can tell "zero" from "unknown". */
interface ExternalResult {
  values: Map<string, number>;
  source: string;
  ok: boolean;
  /** True when the value is a different day from the one being reconciled. */
  stale: boolean;
  error?: string;
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

async function safe(
  label: string,
  fn: () => Promise<Map<string, number>>,
  source: string,
  stale = false,
): Promise<ExternalResult> {
  try {
    return { values: await fn(), source, ok: true, stale };
  } catch (e) {
    logger.warn({ err: (e as Error).message, label }, 'ledger: external source failed');
    return { values: new Map(), source, ok: false, stale, error: (e as Error).message };
  }
}

/**
 * Fetch the external figure for a section.
 *
 * `asOfDate` vs `today` matters for the sources that can only answer "now": open AR and unapplied
 * payments are point-in-time, so reconciling a PAST day against them is indicative at best. Those rows
 * are tagged `stale_external` rather than `ok`, so a match against the wrong day never reads as a
 * confirmation.
 */
export async function fetchExternal(
  section: LedgerSectionId,
  asOfDate: string,
  today: string,
  carrierIds: readonly string[],
): Promise<ExternalResult> {
  const def = getLedgerSection(section);
  switch (def.externalSource) {
    case 'efs':
      // See the module header: no batch EFS route exists and EFS has no as-of, so CMP's own
      // post-movement running balance is the independent figure for every day, today included.
      return safe(
        'cmp_balance_after',
        () => cmpBalanceAsOf(nextDay(asOfDate), carrierIds),
        'cmp_balance_after',
      );
    case 'cmp_invoice':
      // Open AR is a NOW figure; for a past day it is indicative only.
      return safe('open_invoices', () => openInvoiceBalance(carrierIds), 'cmp_invoice', asOfDate !== today);
    case 'payments_unapplied':
      return safe(
        'unapplied_payments',
        () => unappliedPayments(nextDay(asOfDate), carrierIds),
        'payments_unapplied',
        asOfDate !== today,
      );
    default:
      return { values: new Map(), source: def.externalSource, ok: true, stale: false };
  }
}

function nextDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

/**
 * Attach the external figure and a status to each computed row.
 *
 * Status precedence is deliberate: `no_opening` BEFORE `source_unavailable` before `variance`. A carrier
 * with no opening balance has no closing to compare, so calling it a variance would inflate the real
 * queue with rows that are only waiting on data entry.
 */
export function reconcileRows(
  rows: readonly SectionMovement[],
  external: ExternalResult,
): ReconciledRow[] {
  return rows.map((row) => {
    if (row.closing === null) {
      return {
        ...row,
        externalValue: external.values.get(row.carrierId) ?? null,
        externalSource: external.source,
        variance: null,
        status: 'no_opening' as const,
      };
    }

    const value = external.values.get(row.carrierId);
    if (value === undefined) {
      return {
        ...row,
        externalValue: null,
        externalSource: external.source,
        variance: null,
        status: 'source_unavailable' as const,
      };
    }

    const variance = round2(row.closing - value);
    const status: LedgerSnapshotStatus = external.stale
      ? 'stale_external'
      : withinTolerance(row.closing, value)
        ? 'ok'
        : 'variance';

    return {
      ...row,
      externalValue: round2(value),
      externalSource: external.source,
      variance,
      status,
    };
  });
}

export interface ReconSummary {
  ok: number;
  variance: number;
  no_opening: number;
  source_unavailable: number;
  stale_external: number;
  /** Absolute variance total across rows that actually reconciled — the size of the problem. */
  varianceTotal: number;
}

export function reconSummary(rows: readonly ReconciledRow[]): ReconSummary {
  const out: ReconSummary = {
    ok: 0,
    variance: 0,
    no_opening: 0,
    source_unavailable: 0,
    stale_external: 0,
    varianceTotal: 0,
  };
  for (const r of rows) {
    out[r.status] += 1;
    if (r.status === 'variance' && r.variance !== null) out.varianceTotal += Math.abs(r.variance);
  }
  out.varianceTotal = round2(out.varianceTotal);
  return out;
}
