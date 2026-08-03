/**
 * Standing report catalog — the contract shared by the API, the CRM cards and the .xlsx writer.
 *
 * Column `type` is what lets the export be a real spreadsheet instead of a grid of strings: the
 * writer maps money/number/percent to Excel number formats and date to a real date cell, so totals
 * and sorting work in Excel. Keep types honest — a money column typed `text` silently produces a
 * sheet nobody can SUM.
 */

export const REPORT_IDS = [
  'fuel-volume',
  'receivables',
  'pipeline',
  'agent-perf',
  'billing-recon',
  'client-health',
] as const;

export type ReportId = (typeof REPORT_IDS)[number];

export function isReportId(value: string): value is ReportId {
  return (REPORT_IDS as readonly string[]).includes(value);
}

export type ReportColumnType = 'text' | 'number' | 'money' | 'percent' | 'date';

export interface ReportColumn {
  /** Key in each row object. */
  key: string;
  label: string;
  type: ReportColumnType;
  /** Excel column width in characters. */
  width?: number;
}

export interface ReportDef {
  id: ReportId;
  title: string;
  /** Worksheet name — Excel caps these at 31 chars and forbids []:*?/\ */
  sheet: string;
  description: string;
  /** The warehouse objects this actually reads (shown on the card). */
  source: string;
  /** False when the report is point-in-time and the date filter only narrows which rows qualify. */
  dateScoped: boolean;
  columns: ReportColumn[];
}

const money = (key: string, label: string, width = 15): ReportColumn => ({ key, label, type: 'money', width });
const num = (key: string, label: string, width = 12): ReportColumn => ({ key, label, type: 'number', width });
const text = (key: string, label: string, width = 26): ReportColumn => ({ key, label, type: 'text', width });

export const REPORTS: Record<ReportId, ReportDef> = {
  'fuel-volume': {
    id: 'fuel-volume',
    title: 'Fuel volume',
    sheet: 'Fuel volume',
    description: 'Gallons and spend by carrier, with cards and transactions for the period.',
    source: 'octane.mart_sales_dashboard_card_base',
    dateScoped: true,
    columns: [
      text('company_name', 'Company', 34),
      text('agent', 'Agent', 22),
      num('transactions', 'Transactions'),
      num('cards', 'Cards', 10),
      num('gallons', 'Gallons', 14),
      money('spend', 'Spend'),
      money('discount', 'Discount', 13),
      money('avg_price', 'Avg $/gal', 12),
    ],
  },
  receivables: {
    id: 'receivables',
    title: 'Receivables ageing',
    sheet: 'Receivables ageing',
    description: 'Open invoices per carrier bucketed by age, with the overdue split.',
    source: 'public.cmp_invoice',
    dateScoped: true,
    columns: [
      text('company_name', 'Company', 34),
      text('billing_cycle', 'Billing cycle', 18),
      num('invoices', 'Open invoices', 14),
      money('invoiced', 'Invoiced'),
      money('paid', 'Paid'),
      money('outstanding', 'Outstanding'),
      money('overdue', 'Overdue'),
      num('oldest_days', 'Oldest (days)', 14),
      text('bucket', 'Age bucket', 14),
    ],
  },
  pipeline: {
    id: 'pipeline',
    title: 'Pipeline conversion',
    sheet: 'Pipeline conversion',
    description: 'Per-agent deal funnel — app fills through cards sent and first swipe.',
    source: 'public.zoho_deals · zoho_users',
    dateScoped: true,
    columns: [
      text('agent', 'Agent', 24),
      num('deals', 'Deals'),
      num('app_filled', 'App filled', 13),
      num('cards_sent', 'Cards sent', 13),
      num('card_swiped', 'Card swiped', 13),
      { key: 'to_cards_pct', label: 'To cards %', type: 'percent', width: 13 },
      { key: 'to_swipe_pct', label: 'To swipe %', type: 'percent', width: 13 },
    ],
  },
  'agent-perf': {
    id: 'agent-perf',
    title: 'Agent performance',
    sheet: 'Agent performance',
    description: 'Per-agent book size, volume, revenue and debt exposure.',
    source: 'octane.mart_sales_dashboard_card_base · octane.dim_company',
    dateScoped: true,
    columns: [
      text('agent', 'Agent', 24),
      num('companies', 'Active companies', 17),
      num('cards', 'Cards', 10),
      num('new_cards', 'New cards', 12),
      num('gallons', 'Gallons', 14),
      money('revenue', 'Revenue'),
      num('book_size', 'Book size', 12),
      money('debt', 'Debt exposure', 16),
    ],
  },
  'billing-recon': {
    id: 'billing-recon',
    title: 'Billing reconciliation',
    sheet: 'Billing reconciliation',
    description: 'Invoiced vs collected per carrier and billing cycle, with the gap.',
    source: 'public.cmp_invoice · public.cmp_invoice_payment',
    dateScoped: true,
    columns: [
      text('company_name', 'Company', 34),
      text('billing_cycle', 'Billing cycle', 18),
      num('invoices', 'Invoices', 11),
      money('invoiced', 'Invoiced'),
      money('collected', 'Collected'),
      money('gap', 'Gap'),
      num('payments', 'Payments', 11),
      num('failed_payments', 'Failed', 10),
    ],
  },
  'client-health': {
    id: 'client-health',
    title: 'Client health',
    sheet: 'Client health',
    description: 'Per-carrier activity, tier, cards, debt and volume in one sheet.',
    source: 'octane.dim_company · mart_sales_dashboard_card_base',
    dateScoped: true,
    columns: [
      text('company_name', 'Company', 34),
      text('agent', 'Agent', 22),
      text('tier_name', 'Tier', 14),
      num('trucks', 'Trucks', 10),
      num('active_cards', 'Active cards', 13),
      num('gallons', 'Gallons (period)', 17),
      money('spend', 'Spend (period)', 16),
      money('debt', 'Debt', 14),
      num('debt_days', 'Debt days', 12),
      { key: 'last_transaction', label: 'Last swipe', type: 'date', width: 14 },
    ],
  },
};

export function listReports(): ReportDef[] {
  return REPORT_IDS.map((id) => REPORTS[id]);
}
