// Seed data + formatting/color helpers for the Billing Mytrion, ported from
// the Billing Mytrion.dc.html mockup's DCLogic class (_seedDeals/_debtors/
// _transactions + _stageMeta/_payMeta/_srcMeta/_invColor). Static fixtures —
// real Zoho/servercrm wiring comes later (see build notes this replaced).

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

export const DEALS: Deal[] = [
  { id: 'zc_1', name: 'Ironhide Logistics LLC', carrierId: '104882', stage: 'Card Swiped', appDate: '2025-06-12', payType: 'Line of Credit', cycle: 'Weekly', verify: 'Verified', avgDays: 9 },
  { id: 'zc_2', name: 'Cedar Ridge Transport', carrierId: '205513', stage: 'Card Funded', appDate: '2025-06-09', payType: 'Prepay', cycle: '', verify: 'Verified', avgDays: 0 },
  { id: 'zc_3', name: 'Blue Vector Freight', carrierId: '118734', stage: 'Cards Activated', appDate: '2025-06-18', payType: 'Line of Credit', cycle: 'Bi-Weekly', verify: 'Pending', avgDays: 14 },
  { id: 'zc_4', name: 'Summit Line Haul', carrierId: '330219', stage: 'Billing Form Filled', appDate: '2025-06-21', payType: 'Deposit', cycle: 'Monthly', verify: 'Verified', avgDays: 6 },
  { id: 'zc_5', name: 'Vanguard Carriers LLC', carrierId: '291006', stage: 'Card Swiped', appDate: '2025-05-28', payType: 'Line of Credit', cycle: 'Weekly', verify: 'Verified', avgDays: 33 },
  { id: 'zc_6', name: 'Redwood Haulage Co', carrierId: '447120', stage: 'Card Funded', appDate: '2025-06-02', payType: 'Prepay', cycle: '', verify: 'Verified', avgDays: 0 },
  { id: 'zc_7', name: 'Nightfall Trucking', carrierId: '156620', stage: 'EFS Processing', appDate: '2025-06-24', payType: '', cycle: '', verify: '', avgDays: null },
  { id: 'zc_8', name: 'Granite Peak Freight', carrierId: '502244', stage: 'Cards Activated', appDate: '2025-06-15', payType: 'Line of Credit', cycle: 'Bi-Weekly', verify: 'Verified', avgDays: 12 },
  { id: 'zc_9', name: 'Coastal Dispatch Inc', carrierId: '388491', stage: 'Billing Form Sent', appDate: '2025-06-26', payType: 'Deposit', cycle: 'Monthly', verify: 'Pending', avgDays: 7 },
  { id: 'zc_10', name: 'Iron Oak Transport', carrierId: '271883', stage: 'Card Swiped', appDate: '2025-05-31', payType: 'Line of Credit', cycle: 'Weekly', verify: 'Verified', avgDays: 19 },
  { id: 'zc_11', name: 'Silverline Freightways', carrierId: '619047', stage: 'Card Funded', appDate: '2025-06-07', payType: 'Prepay', cycle: '', verify: 'Verified', avgDays: 0 },
  { id: 'zc_12', name: 'Apex Mile Carriers', carrierId: '133705', stage: 'Cards Activated', appDate: '2025-06-20', payType: 'Line of Credit', cycle: 'Bi-Weekly', verify: 'Verified', avgDays: 8 },
  { id: 'zc_13', name: 'Delta Ridge Logistics', carrierId: '460072', stage: 'Application Filled', appDate: '2025-06-27', payType: '', cycle: '', verify: '', avgDays: null },
  { id: 'zc_14', name: 'Northwind Haulers', carrierId: '577310', stage: 'Closed Lost', appDate: '2025-05-19', payType: 'Deposit', cycle: 'Monthly', verify: 'Failed', avgDays: null },
];

function makeDebtor(
  carrierId: string,
  company: string,
  cycle: string,
  status: Debtor['worstStatus'],
  age: number,
  invs: { c: string; a: number; t: number; r: number }[],
): Debtor {
  const invoices: Invoice[] = invs.map((iv, i) => ({
    num: String(90000 + parseInt(carrierId.slice(-3), 10) + i),
    created: iv.c,
    age: iv.a,
    total: iv.t,
    remaining: iv.r,
  }));
  return {
    carrierId,
    company,
    cycle,
    worstStatus: status,
    age,
    isHard: age >= 15,
    invoiceCount: invoices.length,
    totalOwed: invoices.reduce((s, iv) => s + iv.total, 0),
    totalRemaining: invoices.reduce((s, iv) => s + iv.remaining, 0),
    invoices,
  };
}

export const DEBTORS: Debtor[] = [
  makeDebtor('104882', 'Ironhide Logistics LLC', 'Weekly', 'pending', 22, [
    { c: 'Jun 05, 2025', a: 22, t: 8420, r: 8420 },
    { c: 'Jun 12, 2025', a: 15, t: 6180.5, r: 6180.5 },
  ]),
  makeDebtor('118734', 'Blue Vector Freight', 'Bi-Weekly', 'partially_paid', 9, [
    { c: 'Jun 19, 2025', a: 9, t: 11250, r: 4200 },
  ]),
  makeDebtor('291006', 'Vanguard Carriers LLC', 'Weekly', 'pending', 31, [
    { c: 'May 27, 2025', a: 31, t: 14900, r: 14900 },
    { c: 'Jun 03, 2025', a: 24, t: 9750, r: 9750 },
    { c: 'Jun 10, 2025', a: 17, t: 5300, r: 5300 },
  ]),
  makeDebtor('502244', 'Granite Peak Freight', 'Bi-Weekly', 'pending', 12, [
    { c: 'Jun 16, 2025', a: 12, t: 7640, r: 7640 },
  ]),
  makeDebtor('271883', 'Iron Oak Transport', 'Weekly', 'partially_paid', 18, [
    { c: 'Jun 10, 2025', a: 18, t: 10800, r: 5400 },
    { c: 'Jun 17, 2025', a: 11, t: 4260, r: 4260 },
  ]),
  makeDebtor('133705', 'Apex Mile Carriers', 'Bi-Weekly', 'partially_paid', 6, [
    { c: 'Jun 22, 2025', a: 6, t: 6950, r: 2100 },
  ]),
  makeDebtor('712204', 'Halcyon Freight Systems', 'Weekly', 'pending', 27, [
    { c: 'May 31, 2025', a: 27, t: 18300, r: 18300 },
    { c: 'Jun 07, 2025', a: 20, t: 6420, r: 6420 },
  ]),
  makeDebtor('688190', 'Copperline Transport', 'Monthly', 'pending', 14, [
    { c: 'Jun 14, 2025', a: 14, t: 9180, r: 9180 },
  ]),
  makeDebtor('745300', 'Boxcar Freight Co', 'Bi-Weekly', 'partially_paid', 8, [
    { c: 'Jun 20, 2025', a: 8, t: 5720, r: 1900 },
  ]),
  makeDebtor('733011', 'Meridian Haul Group', 'Weekly', 'pending', 41, [
    { c: 'May 17, 2025', a: 41, t: 22400, r: 22400 },
    { c: 'May 24, 2025', a: 34, t: 8900, r: 8900 },
  ]),
];

export const TRANSACTIONS: Transaction[] = [
  { recordId: 'tx01', source: 'zelle', sender: 'Ironhide Logistics LLC', memo: 'Weekly settlement', txn: 'ZL-88213', amount: 8420, postingDate: '2025-06-30', time: '2:14 PM', carrierId: '104882', isInvoiceMapped: true },
  { recordId: 'tx02', source: 'stripe', sender: 'Cedar Ridge Transport', memo: 'Prepay top-up', txn: 'pi_3Rk8', amount: 5000, postingDate: '2025-06-30', time: '1:02 PM', carrierId: '205513', isInvoiceMapped: false, status: 'Succeeded' },
  { recordId: 'tx03', source: 'chase', sender: 'BLUE VECTOR FRT LLC', memo: 'ACH credit', txn: 'CH-40192', amount: 4200, postingDate: '2025-06-30', time: '11:47 AM', carrierId: '118734', isInvoiceMapped: true },
  { recordId: 'tx04', source: 'mx', sender: 'Summit Line Haul', memo: 'Card settlement', txn: 'MX-77310', amount: 3120.75, postingDate: '2025-06-30', time: '10:23 AM', carrierId: '330219', isInvoiceMapped: false, status: 'Settled' },
  { recordId: 'tx05', source: 'ach', sender: 'APEX MILE CARRIERS', memo: 'Invoice #90838', txn: 'ACH-5521', amount: 2100, postingDate: '2025-06-30', time: '9:15 AM', carrierId: '133705', isInvoiceMapped: true },
  { recordId: 'tx06', source: 'zelle', sender: 'GRANITE PEAK FREIGHT', memo: 'Payment', txn: 'ZL-88190', amount: 7640, postingDate: '2025-06-29', time: '4:38 PM', carrierId: '502244', isInvoiceMapped: false },
  { recordId: 'tx07', source: 'wire', sender: 'Halcyon Freight Systems', memo: 'Wire transfer', txn: 'WR-2201', amount: 12000, postingDate: '2025-06-29', time: '3:12 PM', carrierId: '712204', isInvoiceMapped: false },
  { recordId: 'tx08', source: 'stripe', sender: 'Redwood Haulage Co', memo: 'Prepay reload', txn: 'pi_3Rj1', amount: 3500, postingDate: '2025-06-29', time: '1:55 PM', carrierId: '447120', isInvoiceMapped: false, status: 'Succeeded' },
  { recordId: 'tx09', source: 'check', sender: 'Northgate Freight Solutions', memo: 'Check deposit', txn: 'CHK-1188', amount: 4820.5, postingDate: '2025-06-29', time: '12:30 PM', carrierId: null, isInvoiceMapped: false },
  { recordId: 'tx10', source: 'mx', sender: 'IRON OAK TRANSPORT', memo: 'Card payment', txn: 'MX-77188', amount: 5400, postingDate: '2025-06-29', time: '11:04 AM', carrierId: '271883', isInvoiceMapped: true, status: 'Approved' },
  { recordId: 'tx11', source: 'card', sender: 'Coastal Dispatch Inc', memo: 'Deposit', txn: 'CD-9902', amount: 2500, postingDate: '2025-06-29', time: '9:40 AM', carrierId: '388491', isInvoiceMapped: false },
  { recordId: 'tx12', source: 'zelle', sender: 'Vanguard Carriers LLC', memo: 'Partial payment', txn: 'ZL-87720', amount: 9750, postingDate: '2025-06-27', time: '5:20 PM', carrierId: '291006', isInvoiceMapped: false },
  { recordId: 'tx13', source: 'chase', sender: 'SILVERLINE FRTWAYS', memo: 'ACH credit', txn: 'CH-39980', amount: 4000, postingDate: '2025-06-27', time: '2:48 PM', carrierId: '619047', isInvoiceMapped: false },
  { recordId: 'tx14', source: 'stripe', sender: 'K. Ramirez', memo: 'Card charge', txn: 'pi_3Rh7', amount: 380.42, postingDate: '2025-06-27', time: '1:15 PM', carrierId: null, isInvoiceMapped: false, status: 'Failed' },
  { recordId: 'tx15', source: 'ach', sender: 'MERIDIAN HAUL GROUP', memo: 'Invoice #90711', txn: 'ACH-5490', amount: 8900, postingDate: '2025-06-27', time: '11:52 AM', carrierId: '733011', isInvoiceMapped: true },
  { recordId: 'tx16', source: 'mx', sender: 'Copperline Transport', memo: 'Card settlement', txn: 'MX-77021', amount: 9180, postingDate: '2025-06-27', time: '10:19 AM', carrierId: '688190', isInvoiceMapped: false, status: 'Settled' },
  { recordId: 'tx17', source: 'wire', sender: 'Boxcar Freight Co', memo: 'Wire in', txn: 'WR-2180', amount: 1900, postingDate: '2025-06-27', time: '9:33 AM', carrierId: '745300', isInvoiceMapped: true },
  { recordId: 'tx18', source: 'zelle', sender: 'Unknown Sender', memo: null, txn: 'ZL-87611', amount: 640, postingDate: '2025-06-26', time: '4:02 PM', carrierId: null, isInvoiceMapped: false },
  { recordId: 'tx19', source: 'stripe', sender: 'Cedar Ridge Transport', memo: 'Prepay top-up', txn: 'pi_3Rg2', amount: 2500, postingDate: '2025-06-26', time: '2:37 PM', carrierId: '205513', isInvoiceMapped: false, status: 'Succeeded' },
  { recordId: 'tx20', source: 'chase', sender: 'SUMMIT LINE HAUL', memo: 'ACH credit', txn: 'CH-39810', amount: 3200, postingDate: '2025-06-26', time: '12:11 PM', carrierId: '330219', isInvoiceMapped: false },
];

// ---- formatting ----

export function fmtCurrency(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtCompact(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

// Fixed, not Date.now() — the seed dates above are anchored to this date so age/"Today"/"Yesterday"
// labels stay correct regardless of when the app actually runs.
const TODAY = new Date('2025-06-30T12:00:00');

export function dateLabel(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  const diff = Math.round((TODAY.getTime() - d.getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

export function dateFull(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

// ---- color/label meta (StatusBadge tone + display label) ----

export function stageMeta(stage: string): { tone: 'good' | 'bad' | 'info' | 'neutral' } {
  const good = ['Card Funded', 'Card Swiped', 'Cards Activated', 'Cards Sent'];
  const bad = ['Closed Lost'];
  const info = ['Billing Form Sent', 'Billing Form Filled', 'EFS Processing', 'Vendor Validation', 'CS Validation'];
  if (bad.includes(stage)) return { tone: 'bad' };
  if (good.includes(stage)) return { tone: 'good' };
  if (info.includes(stage)) return { tone: 'info' };
  return { tone: 'neutral' };
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
  return SRC_LABEL[src];
}

export function srcLong(src: TxSource): string {
  return { zelle: 'Zelle', chase: 'Chase', mx: 'MX Merchant', stripe: 'Stripe', ach: 'ACH', wire: 'Wire', check: 'Check', card: 'Card' }[src];
}

export function debtorFor(carrierId: string): Debtor | undefined {
  return DEBTORS.find((d) => d.carrierId === carrierId);
}

export function transactionsForCarrier(carrierId: string): Transaction[] {
  return TRANSACTIONS.filter((t) => t.carrierId === carrierId);
}

export function dealById(id: string): Deal | undefined {
  return DEALS.find((d) => d.id === id);
}
