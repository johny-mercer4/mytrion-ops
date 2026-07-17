/**
 * Debtors dashboard — mytriondbdebtorsinfo via dashboard.debtors.
 * Client rules match self-service: hide ≤1 day debt, hard = 15+ days, recompute card totals.
 */
import { callTouchpoint } from '@/api/touchpoints';
import { n } from './dashFormat';

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
}

export interface DebtorsSummary {
  totalRemaining: number;
  pendingCount: number;
  partialCount: number;
  hardCount: number;
  largestDebt: number;
}

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

export async function loadDebtorsRaw(): Promise<DebtorsRaw> {
  const res = await callTouchpoint('dashboard.debtors', {});
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
      hasPending: false,
      hasPartial: false,
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

/** Widget rule: only invoices with debt_days >= 2; recompute card totals from that set. */
export function filterDebtors(debtors: DebtorCard[], search: string): DebtorCard[] {
  const MIN = 2;
  let list = debtors
    .map((d) => {
      const invoices = d.invoices.filter((inv) => inv.debtDays >= MIN);
      if (!invoices.length) return null;
      const totalOwed = invoices.reduce((a, i) => a + i.total, 0);
      const totalRemaining = invoices.reduce((a, i) => a + i.remaining, 0);
      const totalPaid = Math.max(totalOwed - totalRemaining, 0);
      const maxDebtDays = invoices.reduce((a, i) => Math.max(a, i.debtDays), 0);
      const hasPending = invoices.some((i) => i.status.toLowerCase() === 'pending');
      const hasPartial = invoices.some((i) => i.status.toLowerCase() === 'partially_paid');
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
        isHardDebtor: maxDebtDays >= 15,
      };
    })
    .filter((d): d is DebtorCard => d != null);

  const q = search.trim().toLowerCase();
  if (q) {
    list = list.filter(
      (d) =>
        d.carrierId.toLowerCase().includes(q) ||
        d.dealName.toLowerCase().includes(q) ||
        d.companyName.toLowerCase().includes(q),
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
    if (d.hasPending) pendingCount += 1;
    if (d.hasPartial) partialCount += 1;
    if (d.isHardDebtor) hardCount += 1;
    if (d.totalRemaining > largestDebt) largestDebt = d.totalRemaining;
  }
  return { totalRemaining, pendingCount, partialCount, hardCount, largestDebt };
}
