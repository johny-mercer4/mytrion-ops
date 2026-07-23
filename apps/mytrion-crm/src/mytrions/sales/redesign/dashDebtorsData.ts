/**
 * Debtors dashboard — agent-scoped via dashboard.debtors (CMP + Zoho deal enrich).
 * Client rules mirror Billing Mytrion:
 *   PENDING / PARTIALLY_PAID · remaining ≥ $1 · age ≥ 2 days · hard = 15+ days.
 */
import { callTouchpoint } from '@/api/touchpoints';
import { DEBTORS_DASH_TTL_MS, readDashCache, writeDashCache } from './dashCache';
import { n } from './dashFormat';

const CACHE_PREFIX = 'mytrion_debtors';

/** Same floors as Billing / dwhClientRoster / dwhRetention. */
export const DEBT_MIN_DAYS = 2;
export const DEBT_MIN_REMAINING = 1;
export const HARD_DEBT_DAYS = 15;

export interface DebtorInvoice {
  invoiceId: string;
  dateFrom: string;
  dateTo: string;
  createDate: string;
  debtDays: number;
  status: string;
  remaining: number;
  total: number;
}

export interface DebtorCard {
  id: string;
  companyName: string;
  dealName: string;
  carrierId: string;
  stage: string;
  worstStatus: string;
  invoices: DebtorInvoice[];
  invoiceCount: number;
  totalOwed: number;
  totalPaid: number;
  totalRemaining: number;
  maxDebtDays: number;
  hasPending: boolean;
  hasPartial: boolean;
  isHardDebtor: boolean;
}

export interface DebtorsRaw {
  debtors: DebtorCard[];
  totalDebtors: number;
  totalHardDebtors: number;
  totalDebtAmount: number;
  cachedAt?: string;
  fromCache?: boolean;
}

export interface DebtorsSummary {
  totalRemaining: number;
  pendingCount: number;
  partialCount: number;
  hardCount: number;
  largestDebt: number;
  debtorCount: number;
}

export type DebtorStatusFilter = 'all' | 'pending' | 'partial' | 'hard';

function mapInvoice(inv: Record<string, unknown>): DebtorInvoice {
  return {
    invoiceId: String(inv.invoice_id ?? ''),
    dateFrom: String(inv.date_from ?? ''),
    dateTo: String(inv.date_to ?? ''),
    createDate: String(inv.create_date ?? ''),
    debtDays: n(inv.debt_days),
    status: String(inv.status ?? ''),
    remaining: n(inv.remaining_amount),
    total: n(inv.total_amount),
  };
}

function mapDebtorsPayload(res: {
  debtors?: unknown[];
  total_debtors?: unknown;
  total_hard_debtors?: unknown;
  total_debt_amount?: unknown;
}): DebtorsRaw {
  const raw = res.debtors ?? [];
  const debtors: DebtorCard[] = raw.map((d, i) => {
    const row = d as Record<string, unknown>;
    const invoices = ((row.invoices ?? []) as Record<string, unknown>[]).map(mapInvoice);
    const id = String(row.id ?? row.carrier_id ?? `d-${i}`);
    return {
      id,
      companyName: String(row.company_name ?? ''),
      dealName: String(row.deal_name ?? ''),
      carrierId: String(row.carrier_id ?? ''),
      stage: String(row.stage ?? ''),
      worstStatus: String(row.worst_status ?? ''),
      invoices,
      invoiceCount: invoices.length,
      totalOwed: n(row.total_owed),
      totalPaid: n(row.total_paid),
      totalRemaining: n(row.total_remaining),
      maxDebtDays: n(row.max_debt_days),
      hasPending: Boolean(row.has_pending),
      hasPartial: Boolean(row.has_partial),
      isHardDebtor: !!row.is_hard_debtor,
    };
  });
  return {
    debtors,
    totalDebtors: n(res.total_debtors),
    totalHardDebtors: n(res.total_hard_debtors),
    totalDebtAmount: n(res.total_debt_amount),
  };
}

export async function loadDebtorsRaw(
  opts: { force?: boolean; summaryOnly?: boolean } = {},
): Promise<DebtorsRaw> {
  // The Home "Money Owed" summary uses summaryOnly — the backend then skips the Zoho deal-enrichment
  // COQL (the summary never reads deal metadata). Cache it under a SEPARATE key so the enrichment-less
  // rows can't leak into the full Debtors dashboard (or vice-versa).
  const cacheKey = opts.summaryOnly ? `${CACHE_PREFIX}:summary` : CACHE_PREFIX;
  if (!opts.force) {
    const hit = readDashCache<DebtorsRaw>(cacheKey, DEBTORS_DASH_TTL_MS);
    if (hit) {
      return { ...hit.data, cachedAt: hit.cachedAt.toISOString(), fromCache: true };
    }
  }
  const res = await callTouchpoint('dashboard.debtors', opts.summaryOnly ? { summaryOnly: true } : {});
  const mapped = mapDebtorsPayload(res);
  const cachedAt = writeDashCache(cacheKey, mapped);
  return { ...mapped, cachedAt: cachedAt.toISOString(), fromCache: false };
}

/**
 * Billing-aligned invoice gate + search. Recomputes card totals from qualifying invoices only.
 */
export function filterDebtors(
  debtors: DebtorCard[],
  search: string,
  status: DebtorStatusFilter = 'all',
): DebtorCard[] {
  let list = debtors
    .map((d) => {
      const invoices = d.invoices.filter(
        (inv) => inv.debtDays >= DEBT_MIN_DAYS && inv.remaining >= DEBT_MIN_REMAINING,
      );
      if (!invoices.length) return null;
      const totalOwed = invoices.reduce((a, i) => a + i.total, 0);
      const totalRemaining = invoices.reduce((a, i) => a + i.remaining, 0);
      const totalPaid = Math.max(totalOwed - totalRemaining, 0);
      const maxDebtDays = invoices.reduce((a, i) => Math.max(a, i.debtDays), 0);
      const hasPending = invoices.some((i) => i.status.toLowerCase() === 'pending');
      const hasPartial = invoices.some((i) => {
        const st = i.status.toLowerCase();
        return st === 'partially_paid' || st === 'partial';
      });
      const worstStatus = hasPartial ? 'partially_paid' : hasPending ? 'pending' : d.worstStatus;
      return {
        ...d,
        invoices,
        invoiceCount: invoices.length,
        totalOwed,
        totalPaid,
        totalRemaining,
        maxDebtDays,
        hasPending,
        hasPartial,
        isHardDebtor: maxDebtDays >= HARD_DEBT_DAYS,
        worstStatus,
      };
    })
    .filter((d): d is DebtorCard => d != null);

  if (status === 'pending') list = list.filter((d) => d.hasPending && !d.hasPartial);
  else if (status === 'partial') list = list.filter((d) => d.hasPartial);
  else if (status === 'hard') list = list.filter((d) => d.isHardDebtor);

  const q = search.trim().toLowerCase();
  if (q) {
    list = list.filter(
      (d) =>
        d.carrierId.toLowerCase().includes(q) ||
        d.dealName.toLowerCase().includes(q) ||
        d.companyName.toLowerCase().includes(q) ||
        d.stage.toLowerCase().includes(q),
    );
  }
  return [...list].sort((a, b) => b.totalRemaining - a.totalRemaining);
}

export function debtorsSummary(list: DebtorCard[]): DebtorsSummary {
  let totalRemaining = 0;
  let pendingCount = 0;
  let partialCount = 0;
  let hardCount = 0;
  let largestDebt = 0;
  for (const d of list) {
    totalRemaining += d.totalRemaining;
    if (d.hasPending && !d.hasPartial) pendingCount += 1;
    if (d.hasPartial) partialCount += 1;
    if (d.isHardDebtor) hardCount += 1;
    if (d.totalRemaining > largestDebt) largestDebt = d.totalRemaining;
  }
  return {
    totalRemaining,
    pendingCount,
    partialCount,
    hardCount,
    largestDebt,
    debtorCount: list.length,
  };
}

/** Home “Money Owed” KPIs — same Billing-aligned filter as the Debtors dashboard. */
export async function loadDebtorsHomeSummary(opts: { force?: boolean } = {}): Promise<DebtorsSummary> {
  // summaryOnly → backend skips the wasted Deals-enrichment COQL; the summary only needs invoice totals.
  const raw = await loadDebtorsRaw({ ...opts, summaryOnly: true });
  return debtorsSummary(filterDebtors(raw.debtors, '', 'all'));
}
