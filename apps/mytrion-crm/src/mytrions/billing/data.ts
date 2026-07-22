// View-model types + formatting/color helpers for the Billing Mytrion. The panels load live
// data via api/billing.ts and map the raw Zoho/servercrm payloads onto these shapes (the static
// fixtures were removed in the Phase-1 live-wiring migration; only pure helpers remain here).

export type PayType = 'Line of Credit' | 'Prepay' | 'Deposit' | '';
export type Verify = 'Verified' | 'Pending' | 'Failed' | '';

export interface Deal {
  id: string;
  name: string;
  carrierId: string;
  stage: string;
  appDate: string; // ISO
  payType: PayType;
  cycle: string;
  verify: Verify;
  avgDays: number | null;
}

export interface Invoice {
  num: string;
  created: string;
  age: number;
  total: number;
  remaining: number;
}

export interface Debtor {
  carrierId: string;
  company: string;
  cycle: string;
  worstStatus: 'pending' | 'partially_paid';
  age: number;
  isHard: boolean;
  invoiceCount: number;
  totalOwed: number;
  totalRemaining: number;
  invoices: Invoice[];
}

export type TxSource = 'zelle' | 'chase' | 'mx' | 'stripe' | 'ach' | 'wire' | 'check' | 'card';

export interface Transaction {
  recordId: string;
  source: TxSource;
  sender: string;
  memo: string | null;
  txn: string;
  amount: number;
  postingDate: string; // ISO yyyy-mm-dd
  time: string;
  carrierId: string | null;
  isInvoiceMapped: boolean;
  status?: string;
}

// ---- formatting ----

export function fmtCurrency(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtCompact(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

/** Day label relative to actual today (live data): Today / Yesterday / weekday, Mon d. */
export function dateLabel(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso.length <= 10 ? iso + 'T12:00:00' : iso);
  if (Number.isNaN(d.getTime())) return iso;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const diff = Math.round((today.getTime() - d.getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

export function dateFull(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso.length <= 10 ? iso + 'T12:00:00' : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

// ---- color/label meta (widget StatusBadge tone + display label) ----

/** Semantic colour keys shared by the design's chip() palette. */
export type StageSem = 'muted' | 'warning' | 'accent' | 'purple' | 'success' | 'danger';

/** Deal stage progression (verbatim design order) — drives both the chip colour
 *  and the % fill of the stage progress bar. */
const STAGE_ORDER = [
  'Application Sent',
  'Application Filled',
  'CS Validation',
  'EFS Processing',
  'Vendor Validation',
  'Cards Sent',
  'Cards Activated',
  'Billing Form Sent',
  'Billing Form Filled',
  'Card Funded',
  'Card Swiped',
  'Closed Lost',
];

/** Design _stageMeta: index bands → sem colour; pct = (idx+1)/11. */
export function stageMeta(stage: string): { sem: StageSem; pct: number } {
  if (stage === 'Closed Lost') return { sem: 'danger', pct: 100 };
  const idx = STAGE_ORDER.indexOf(stage);
  let sem: StageSem;
  if (idx <= 1) sem = 'muted';
  else if (idx <= 4) sem = 'warning';
  else if (idx <= 6) sem = 'accent';
  else if (idx <= 8) sem = 'purple';
  else sem = 'success';
  const pct = idx >= 0 ? Math.round(((idx + 1) / 11) * 100) : 8;
  return { sem, pct };
}

/** Clean a raw Zoho billing_cycle enum (e.g. "WEEKLY_MON_SUN", "SEMI_WEEKLY") to a display label. */
export function fmtCycle(raw: string): string {
  const s = (raw || '').trim();
  if (!s) return '';
  const u = s.toUpperCase();
  if (u.startsWith('SEMI_WEEKLY') || u === 'SEMIWEEKLY') return 'Semi-Weekly';
  if (u.startsWith('BI_WEEKLY') || u === 'BIWEEKLY' || u === 'BI-WEEKLY') return 'Bi-Weekly';
  if (u.startsWith('BI_MONTHLY') || u === 'BIMONTHLY') return 'Bi-Monthly';
  if (u.startsWith('WEEKLY')) return 'Weekly';
  if (u.startsWith('MONTHLY')) return 'Monthly';
  if (u.startsWith('DAILY')) return 'Daily';
  // Fallback: underscores → spaces, Title Case.
  return s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function payMeta(t: PayType): { tone: 'good' | 'warn' | 'info' | 'neutral'; label: string } {
  if (t === 'Line of Credit') return { tone: 'info', label: 'Line of Credit' };
  if (t === 'Prepay') return { tone: 'good', label: 'Prepay' };
  if (t === 'Deposit') return { tone: 'warn', label: 'Deposit' };
  return { tone: 'neutral', label: 'No Type' };
}

const SRC_LABEL: Record<TxSource, string> = {
  zelle: 'Zelle',
  chase: 'Chase',
  mx: 'MX',
  stripe: 'Stripe',
  ach: 'ACH',
  wire: 'Wire',
  check: 'Check',
  card: 'Card',
};

export function srcLabel(src: TxSource): string {
  return SRC_LABEL[src] ?? src;
}

export function srcLong(src: TxSource): string {
  return (
    { zelle: 'Zelle', chase: 'Chase', mx: 'MX Merchant', stripe: 'Stripe', ach: 'ACH', wire: 'Wire', check: 'Check', card: 'Card' } as Record<TxSource, string>
  )[src] ?? src;
}

/** Normalize a raw source string (any casing / Zoho type) to our TxSource union. */
export function toTxSource(raw: unknown): TxSource {
  const s = String(raw ?? '').toLowerCase();
  if (s.includes('zelle')) return 'zelle';
  if (s.includes('chase')) return 'chase';
  if (s.includes('mx') || s.includes('merchant')) return 'mx';
  if (s.includes('stripe')) return 'stripe';
  if (s.includes('ach')) return 'ach';
  if (s.includes('wire')) return 'wire';
  if (s.includes('check')) return 'check';
  if (s.includes('card')) return 'card';
  return 'zelle';
}

/** Our TxSource → the Deluge `type` the write touchpoints expect (BM_TX_SOURCES `type`). */
export function txTypeFor(src: TxSource): 'Zelle' | 'Chase' | 'Mx_Merchant' | 'Stripe' | 'ACH' | 'Wire' | 'Check' | 'Card' {
  return {
    zelle: 'Zelle',
    chase: 'Chase',
    mx: 'Mx_Merchant',
    stripe: 'Stripe',
    ach: 'ACH',
    wire: 'Wire',
    check: 'Check',
    card: 'Card',
  }[src] as 'Zelle';
}
