// Seed data + formatting/logic helpers for the Verification Mytrion, ported from
// the Verification mockup's spec (7 New Applications + 5 Client Requests + 8 inbox
// notifications + Configuration thresholds/rules/tiers). Static fixtures — real
// Zoho/servercrm wiring comes later. Mirrors billing/data.ts conventions.

export type AppKind = 'new' | 'req';
export type PassTone = 'pass' | 'watch' | 'stop';

export interface FmcsaCheck {
  authority: 'Active' | 'Inactive';
  insurance: 'Active' | 'Expired';
  fleet: number;
  granted: number;
}

export interface FinancialSnapshot {
  incomeType: string;
  weeklyIncome: number;
  adb: number;
  overdrafts: number;
  nsf: number;
}

export interface CashFlowInputs {
  income: number;
  expenses: number;
  fuel: number;
}

export interface NewApplication {
  kind: 'new';
  id: string;
  company: string;
  carrierId: string;
  mc: string;
  dot: string;
  type: 'Interstate' | 'Intrastate';
  track: 'Company' | 'Sole Operator';
  cards: number;
  agent: string;
  step: 1 | 2 | 3 | 4;
  status: string;
  received: string;
  fmcsa: FmcsaCheck;
  highway: 'Low' | 'Medium' | 'High';
  credit: 'Low Risk' | 'Thin File' | 'Collections';
  fin: FinancialSnapshot;
  isoft: { late: number; collections: number };
  calc: CashFlowInputs;
  docs: string[];
}

export interface EligibilitySnapshot {
  paidInvoices: number;
  insurance: 'Active' | 'Inactive';
  latePayments: number;
}

export interface ClientRequest {
  kind: 'req';
  id: string;
  company: string;
  carrierId: string;
  agent: string;
  reqType: 'Limit Increase' | 'Reactivation' | 'Card Request' | 'Billing Cycle Change';
  currentLimit: number;
  tenure: string;
  status: string;
  received: string;
  elig: EligibilitySnapshot;
  calc: CashFlowInputs;
  detail: string;
}

export type Application = NewApplication | ClientRequest;

export const NEW_APPLICATIONS: NewApplication[] = [
  {
    kind: 'new', id: 'a1', company: 'Kingsway Freight LLC', carrierId: '204671', mc: 'MC-1188402', dot: 'DOT-3910244',
    type: 'Interstate', track: 'Company', cards: 8, agent: 'Ava Sinclair', step: 2, status: 'In Review', received: '08:12',
    fmcsa: { authority: 'Active', insurance: 'Active', fleet: 9, granted: 2021 },
    highway: 'Low', credit: 'Low Risk',
    fin: { incomeType: 'ACH · Factoring', weeklyIncome: 12400, adb: 8600, overdrafts: 0, nsf: 0 },
    isoft: { late: 0, collections: 0 },
    calc: { income: 12400, expenses: 4100, fuel: 3600 },
    docs: [],
  },
  {
    kind: 'new', id: 'a2', company: 'Rojas Owner-Op', carrierId: '331902', mc: 'MC-0992210', dot: 'DOT-2871330',
    type: 'Interstate', track: 'Sole Operator', cards: 2, agent: 'Diego Marín', step: 2, status: 'Pending Docs', received: '08:40',
    fmcsa: { authority: 'Inactive', insurance: 'Active', fleet: 2, granted: 2023 },
    highway: 'Medium', credit: 'Thin File',
    fin: { incomeType: 'Zelle · Broker', weeklyIncome: 3100, adb: 640, overdrafts: 2, nsf: 0 },
    isoft: { late: 1, collections: 0 },
    calc: { income: 3100, expenses: 1400, fuel: 900 },
    docs: ['Signed Lease Agreement', 'Carrier Confirmation'],
  },
  {
    kind: 'new', id: 'a3', company: 'Meridian Hauling Inc', carrierId: '418255', mc: 'MC-1450771', dot: 'DOT-4120988',
    type: 'Interstate', track: 'Company', cards: 14, agent: 'Ava Sinclair', step: 3, status: 'In Review', received: 'Yesterday',
    fmcsa: { authority: 'Active', insurance: 'Active', fleet: 16, granted: 2019 },
    highway: 'Low', credit: 'Low Risk',
    fin: { incomeType: 'Wire · Direct Shipper', weeklyIncome: 21800, adb: 15200, overdrafts: 0, nsf: 0 },
    isoft: { late: 0, collections: 0 },
    calc: { income: 21800, expenses: 7400, fuel: 5600 },
    docs: [],
  },
  {
    kind: 'new', id: 'a4', company: 'Pauls Transport', carrierId: '509110', mc: 'MC-—', dot: 'DOT-5510022',
    type: 'Intrastate', track: 'Sole Operator', cards: 1, agent: 'Priya Rao', step: 1, status: 'In Review', received: '09:05',
    fmcsa: { authority: 'Active', insurance: 'Expired', fleet: 1, granted: 2024 },
    highway: 'Medium', credit: 'Thin File',
    fin: { incomeType: 'Pending', weeklyIncome: 0, adb: 0, overdrafts: 0, nsf: 0 },
    isoft: { late: 0, collections: 0 },
    calc: { income: 0, expenses: 0, fuel: 0 },
    docs: ['Active insurance (FMCSA)'],
  },
  {
    kind: 'new', id: 'a5', company: 'Volk Logistics Group', carrierId: '662301', mc: 'MC-1680551', dot: 'DOT-6120400',
    type: 'Interstate', track: 'Company', cards: 26, agent: 'Diego Marín', step: 1, status: 'WEX Routing', received: '09:20',
    fmcsa: { authority: 'Active', insurance: 'Active', fleet: 31, granted: 2018 },
    highway: 'Low', credit: 'Low Risk',
    fin: { incomeType: 'Wire · Factoring', weeklyIncome: 38000, adb: 24000, overdrafts: 0, nsf: 0 },
    isoft: { late: 0, collections: 0 },
    calc: { income: 38000, expenses: 14000, fuel: 9000 },
    docs: [],
  },
  {
    kind: 'new', id: 'a6', company: 'Bright Line Carriers', carrierId: '773820', mc: 'MC-1720933', dot: 'DOT-6620711',
    type: 'Interstate', track: 'Company', cards: 6, agent: 'Priya Rao', step: 4, status: 'Ready for Decision', received: 'Yesterday',
    fmcsa: { authority: 'Active', insurance: 'Active', fleet: 7, granted: 2020 },
    highway: 'Low', credit: 'Low Risk',
    fin: { incomeType: 'ACH · Factoring', weeklyIncome: 9800, adb: 6100, overdrafts: 1, nsf: 0 },
    isoft: { late: 0, collections: 0 },
    calc: { income: 9800, expenses: 3200, fuel: 2900 },
    docs: [],
  },
  {
    kind: 'new', id: 'a7', company: 'Delgado Freight', carrierId: '804417', mc: 'MC-1802244', dot: 'DOT-6810355',
    type: 'Interstate', track: 'Sole Operator', cards: 3, agent: 'Ava Sinclair', step: 2, status: 'Prepay Only', received: '2d ago',
    fmcsa: { authority: 'Active', insurance: 'Active', fleet: 3, granted: 2023 },
    highway: 'High', credit: 'Collections',
    fin: { incomeType: 'Cash · Mixed', weeklyIncome: 2400, adb: 380, overdrafts: 5, nsf: 2 },
    isoft: { late: 3, collections: 1800 },
    calc: { income: 2400, expenses: 1500, fuel: 700 },
    docs: [],
  },
];

export const CLIENT_REQUESTS: ClientRequest[] = [
  {
    kind: 'req', id: 'q1', company: 'Cross Country Cargo', carrierId: '118902', agent: 'Ava Sinclair',
    reqType: 'Limit Increase', currentLimit: 8000, tenure: 'Client · 14 mo', status: 'Eligible', received: '1h ago',
    elig: { paidInvoices: 22, insurance: 'Active', latePayments: 3 },
    calc: { income: 15200, expenses: 5100, fuel: 4200 },
    detail: 'Requests increase to support two new lanes.',
  },
  {
    kind: 'req', id: 'q2', company: 'Halden Transport', carrierId: '227431', agent: 'Priya Rao',
    reqType: 'Reactivation', currentLimit: 5500, tenure: 'Client · 8 mo', status: 'Type A', received: '3h ago',
    elig: { paidInvoices: 11, insurance: 'Active', latePayments: 2 },
    calc: { income: 0, expenses: 0, fuel: 0 },
    detail: 'Inactive 47 days — previously active, trusted (Type A).',
  },
  {
    kind: 'req', id: 'q3', company: 'Summit Owner-Op', carrierId: '339015', agent: 'Diego Marín',
    reqType: 'Limit Increase', currentLimit: 6000, tenure: 'Client · 2 mo', status: 'On Hold', received: '5h ago',
    elig: { paidInvoices: 3, insurance: 'Active', latePayments: 1 },
    calc: { income: 7200, expenses: 2600, fuel: 2100 },
    detail: 'Under 5 paid invoices — ineligible until minimum met.',
  },
  {
    kind: 'req', id: 'q4', company: 'Ridgeway Logistics', carrierId: '440228', agent: 'Ava Sinclair',
    reqType: 'Billing Cycle Change', currentLimit: 12000, tenure: 'Client · 11 mo', status: 'Review', received: 'Yesterday',
    elig: { paidInvoices: 14, insurance: 'Active', latePayments: 1 },
    calc: { income: 0, expenses: 0, fuel: 0 },
    detail: '2-week → 1-week. Needs 10 clean invoices + 50% deposit.',
  },
  {
    kind: 'req', id: 'q5', company: 'Falcon Freight Co', carrierId: '551190', agent: 'Priya Rao',
    reqType: 'Card Request', currentLimit: 9000, tenure: 'Client · 6 mo', status: 'Review', received: 'Yesterday',
    elig: { paidInvoices: 16, insurance: 'Active', latePayments: 0 },
    calc: { income: 0, expenses: 0, fuel: 0 },
    detail: '2 new drivers — verify fleet growth via FMCSA/Highway.',
  },
];

// ---- inbox ----

export type NotificationType =
  | 'new-app'
  | 'docs'
  | 'insurance'
  | 'wex'
  | 'limit'
  | 'blacklist'
  | 'decision'
  | 'reactivation';

export interface VerificationNotification {
  id: string;
  type: NotificationType;
  title: string;
  detail: string;
  time: string;
  group: 'today' | 'earlier';
  alert: boolean;
  read: boolean;
}

export const NOTIFICATIONS: VerificationNotification[] = [
  { id: 'n1', type: 'new-app', title: 'New application received', detail: 'Kingsway Freight LLC — 8 cards · Interstate · agent Ava Sinclair', time: '9m ago', group: 'today', alert: false, read: false },
  { id: 'n2', type: 'docs', title: 'Documents received', detail: 'Rojas Owner-Op uploaded a signed Lease Agreement', time: '32m ago', group: 'today', alert: false, read: false },
  { id: 'n3', type: 'insurance', title: 'Insurance issue detected', detail: 'Pauls Transport — FMCSA insurance expired · 7-day window open', time: '1h ago', group: 'today', alert: true, read: false },
  { id: 'n4', type: 'wex', title: 'WEX routing required', detail: 'Volk Logistics Group requested 26 cards (21+) — send WEX app', time: '2h ago', group: 'today', alert: false, read: false },
  { id: 'n5', type: 'limit', title: 'Limit increase request', detail: 'Cross Country Cargo requested an increase from $8,000', time: '3h ago', group: 'today', alert: false, read: false },
  { id: 'n6', type: 'blacklist', title: 'Blacklist match flagged', detail: 'Delgado Freight — shared phone with a terminated account', time: 'Yesterday', group: 'earlier', alert: true, read: false },
  { id: 'n7', type: 'decision', title: 'Decision approved by Lead', detail: 'Bright Line Carriers — LOC $9,500 · Moderate tier approved', time: 'Yesterday', group: 'earlier', alert: false, read: true },
  { id: 'n8', type: 'reactivation', title: 'Reactivation due', detail: 'Halden Transport inactive 47 days — Type A review', time: '2d ago', group: 'earlier', alert: false, read: true },
];

// ---- Configuration seed ----

export interface VendorToggle {
  id: string;
  name: string;
  desc: string;
  on: boolean;
}

export const VENDOR_TOGGLES: VendorToggle[] = [
  { id: 'fmcsa', name: 'FMCSA', desc: 'Carrier authority & insurance', on: true },
  { id: 'highway', name: 'Highway', desc: 'Risk scoring & cross-reference', on: true },
  { id: 'creditsafe', name: 'CreditSafe', desc: 'Business credit profile', on: true },
  { id: 'plaid', name: 'Plaid', desc: 'Bank connection & cash flow', on: true },
  { id: 'stripe', name: 'Stripe', desc: 'Alternative financial data', on: false },
  { id: 'isoftpull', name: 'iSoftPull', desc: 'Soft personal credit pull', on: true },
  { id: 'wex', name: 'WEX / EFS', desc: 'Fuel-card issuance (21+ cards)', on: true },
];

export interface ThresholdRow {
  label: string;
  value: string;
  hint: string;
}

export const FINANCIAL_HARD_STOPS: ThresholdRow[] = [
  { label: 'Min avg weekly income', value: '$3,000', hint: 'Below → hard stop · Prepay only' },
  { label: 'Min average daily balance', value: '$500', hint: 'Below → account cannot support LOC' },
  { label: 'Max overdrafts (review period)', value: '3', hint: '4 or more → auto-flag · escalate' },
  { label: 'Max ACH / NSF returns', value: '1', hint: '2 or more → escalate immediately' },
  { label: 'Sole-operator collections cap', value: '$1,000', hint: 'Over → Prepay / Deposit 1:1' },
  { label: 'Company collections cap', value: '$3,000', hint: 'Over → no standard LOC' },
];

export const LIMIT_POLICY_RULES: ThresholdRow[] = [
  { label: 'Single limit-increase cap', value: '$5,000', hint: '' },
  { label: 'Min paid invoices for increase', value: '5', hint: '' },
  { label: 'Max late payments', value: '10', hint: '' },
  { label: 'Fleet-expansion rate', value: '$2,500 / truck', hint: '' },
  { label: 'Inactivity threshold', value: '45 days', hint: '' },
  { label: 'WEX routing threshold', value: '21+ cards', hint: '' },
];

export interface TierDef {
  id: 'weak' | 'moderate' | 'strong';
  label: string;
  desc: string;
  color: string;
}

export const TIERS: TierDef[] = [
  { id: 'weak', label: 'Weak', desc: 'Tighter monitoring · frequent review', color: '#F87171' },
  { id: 'moderate', label: 'Moderate', desc: 'Standard monitoring cadence', color: '#FBBF24' },
  { id: 'strong', label: 'Strong', desc: 'Light monitoring · faster increases', color: '#34D399' },
];

// ---- hard-stop thresholds (mirrors Configuration numbers, used by the modal) ----

export const HARD_STOPS = {
  minWeeklyIncome: 3000,
  minAvgDailyBalance: 500,
  maxOverdrafts: 3,
  maxAchNsf: 1,
};

export const POLICY = {
  minPaidInvoices: 5,
  maxLatePayments: 10,
  limitIncreaseCap: 5000,
  wexCardThreshold: 21,
};

// ---- shared cash-flow formula ----

export function baseLOC(income: number, expenses: number, fuel: number): number {
  return Math.max(0, income - expenses + fuel);
}

// ---- formatting ----

export function fmtCurrency(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

export function passTone(pass: boolean, watch = false): PassTone {
  if (pass) return 'pass';
  if (watch) return 'watch';
  return 'stop';
}

export function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

// ---- lookups ----

export function newAppById(id: string): NewApplication | undefined {
  return NEW_APPLICATIONS.find((a) => a.id === id);
}

export function clientRequestById(id: string): ClientRequest | undefined {
  return CLIENT_REQUESTS.find((r) => r.id === id);
}
