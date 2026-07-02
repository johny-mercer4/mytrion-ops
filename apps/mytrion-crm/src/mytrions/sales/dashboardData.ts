// Dashboard-specific seed data (Sales / Invoices / Debtors sub-tabs), split out
// of data.ts to stay under the 600-line file cap. Same source spec as data.ts.

import type { ClientStatus } from './data';

// ---- Dashboard · Sales sub-tab ----

export interface CompanyCardRow {
  name: string;
  cards: number;
  status: ClientStatus;
}

export const CARDS_BY_COMPANY: CompanyCardRow[] = [
  { name: 'Great Way Logistics', cards: 38, status: 'active' },
  { name: 'Cardinal Logistics', cards: 29, status: 'active' },
  { name: 'Pacific Drayage', cards: 25, status: 'active' },
  { name: 'Summit Express', cards: 19, status: 'active' },
  { name: 'Sunrise Freight', cards: 16, status: 'inactive' },
  { name: 'Blue Ridge Carriers', cards: 10, status: 'inactive' },
  { name: 'Midwest Haulers', cards: 0, status: 'stuck' },
];

// 12-point synthetic series for the Card Activity line/area chart.
export const CARD_ACTIVITY_SERIES: number[] = [28, 34, 30, 42, 38, 55, 48, 62, 58, 71, 66, 80];

export interface TopCarrierRow {
  name: string;
  newCards: number;
  tx: number;
  gallons: string;
  total: string;
}

export const TOP_CARRIERS: TopCarrierRow[] = [
  { name: 'Great Way Logistics', newCards: 4, tx: 612, gallons: '14,820', total: '$48,210' },
  { name: 'Cardinal Logistics', newCards: 3, tx: 498, gallons: '11,240', total: '$36,540' },
  { name: 'Pacific Drayage Group', newCards: 5, tx: 441, gallons: '9,870', total: '$31,090' },
  { name: 'Summit Express Lines', newCards: 2, tx: 377, gallons: '8,430', total: '$27,360' },
  { name: 'Sunrise Freight LLC', newCards: 1, tx: 204, gallons: '6,210', total: '$19,880' },
];

// ---- Dashboard · Invoices sub-tab ----

export type InvoiceStatus = 'overdue' | 'pending' | 'paid';

export interface SalesInvoice {
  num: string;
  carrier: string;
  issued: string;
  due: string;
  amount: number;
  status: InvoiceStatus;
  days?: number;
}

export const SALES_INVOICES: SalesInvoice[] = [
  { num: 'Q-10428', carrier: 'Sunrise Freight LLC', issued: 'Jun 16', due: 'Jun 30', amount: 3210, status: 'overdue', days: 14 },
  { num: 'Q-10455', carrier: 'Blue Ridge Carriers', issued: 'Jun 18', due: 'Jul 2', amount: 1700, status: 'overdue', days: 9 },
  { num: 'Q-10470', carrier: 'Great Way Logistics', issued: 'Jun 22', due: 'Jul 6', amount: 2140, status: 'pending' },
  { num: 'Q-10491', carrier: 'Cardinal Logistics', issued: 'Jun 24', due: 'Jul 8', amount: 4860, status: 'pending' },
  { num: 'Q-10402', carrier: 'Pacific Drayage Group', issued: 'Jun 10', due: 'Jun 24', amount: 5210, status: 'paid' },
  { num: 'Q-10388', carrier: 'Summit Express Lines', issued: 'Jun 8', due: 'Jun 22', amount: 3940, status: 'paid' },
  { num: 'Q-10377', carrier: 'Great Way Logistics', issued: 'Jun 5', due: 'Jun 19', amount: 6120, status: 'paid' },
];

export function invoiceStatusTone(status: InvoiceStatus): 'bad' | 'warn' | 'good' {
  if (status === 'overdue') return 'bad';
  if (status === 'pending') return 'warn';
  return 'good';
}

// ---- Dashboard · Debtors sub-tab ----

export interface SalesDebtor {
  carrier: string;
  id: string;
  balance: number;
  days: number;
  hard: boolean;
  lastContact: string;
}

export const SALES_DEBTORS: SalesDebtor[] = [
  { carrier: 'Great Way Logistics Inc', id: '98765', balance: 2140, days: 38, hard: false, lastContact: '2d ago' },
  { carrier: 'Blue Ridge Carriers', id: '65517', balance: 1700, days: 72, hard: true, lastContact: '9d ago' },
  { carrier: 'Sunrise Freight LLC', id: '88431', balance: 980, days: 14, hard: false, lastContact: '1d ago' },
  { carrier: 'Atlas Owner Ops', id: '59930', balance: 620, days: 96, hard: true, lastContact: '21d ago' },
  { carrier: 'Redline Transport', id: '58221', balance: 410, days: 27, hard: false, lastContact: '4d ago' },
  { carrier: 'Cardinal Logistics', id: '66902', balance: 90, days: 6, hard: false, lastContact: 'Today' },
];

export interface AgingBucket {
  label: string;
  amount: number;
  className: string;
}

// Aging buckets (0-30 / 31-60 / 61-90 / 90+) computed from SALES_DEBTORS.
export function agingBuckets(): AgingBucket[] {
  const buckets = [
    { label: '0–30 days', min: 0, max: 30, amount: 0, className: 'bg-good' },
    { label: '31–60 days', min: 31, max: 60, amount: 0, className: 'bg-warn' },
    { label: '61–90 days', min: 61, max: 90, amount: 0, className: 'bg-primary' },
    { label: '90+ days', min: 91, max: Infinity, amount: 0, className: 'bg-bad' },
  ];
  SALES_DEBTORS.forEach((d) => {
    const b = buckets.find((bucket) => d.days >= bucket.min && d.days <= bucket.max);
    if (b) b.amount += d.balance;
  });
  return buckets.map(({ label, amount, className }) => ({ label, amount, className }));
}

export function debtorAgeTone(days: number): 'good' | 'warn' | 'info' | 'bad' {
  if (days <= 30) return 'good';
  if (days <= 60) return 'warn';
  if (days <= 90) return 'info';
  return 'bad';
}
