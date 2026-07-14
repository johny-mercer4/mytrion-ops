/**
 * Automations tab — static action catalog + live-data loaders / formatters. Catalog mirrors the
 * self-service widget's SS_AUTOMATION_BLOCKS (ids/codes/titles). Loaders map touchpoints onto the
 * shapes AutoTab renders. Run dispatch lives in autoRunners.ts.
 */
import { callTouchpoint } from '@/api/touchpoints';
import type { MoneyCodePreview, WexApplicationResult } from '@/api/touchpointTypes';
import { loadDeals as loadCrmDeals } from './dataCenterLive';

// ---------- types ----------

export interface Automation {
  id: string; title: string; codes: readonly string[]; dept: string; icon: string; desc: string;
  top?: boolean; kind?: string; verb?: string; limits?: boolean; soon?: boolean;
}
export interface Deal {
  id: string;
  name: string;
  company: string;
  app: string;
  carrier: string;
  phone: string;
  /** Zoho CRM Deal id when known (Desk ticket creates need this). */
  dealId: string;
}
export interface Card { id: string; number: string; status: string; driver: string; unit: string; }
export interface WexResult { company: string; appId: string; contact: string; status: string; group: string; }
export interface InvRow { id: string; inv: string; date: string; amount: string; status: string; }
/** Lightweight on-screen txn list row (full report lives in TxnReportState). */
export interface TxnRow { date: string; card: string; driver: string; gallons: string; amount: string; }
export type DonePayload =
  | { kind: 'invoices' }
  | { kind: 'transactions' }
  | { kind: 'message'; message: string }
  | { kind: 'table'; title: string; columns: string[]; rows: string[][] }
  | { kind: 'link'; label: string; url: string };

export interface Addr { address: string; city: string; state: string; zip: string; }
export interface UnitDriverForm { unitNumber: string; driverName: string; driverId: string; }
export interface MoneyCodeForm { amount: string; reason: string; unitNumber: string; }

// ---------- static config (self-service catalog) ----------
// Icon paths match zoho-octane app/js/automations-catalog.js (Heroicons stroke set).

const ICO = {
  clipboardCheck: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  package: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
  card: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
  invoice: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8',
  doc: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  chart: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  edit: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
  refresh: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
  money: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  checkCircle: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  ban: 'M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636',
  arrows: 'M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l-4-4m4 4l4-4',
  cash: 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z',
  lock: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z',
  key: 'M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z',
  gear: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
  link: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1',
  closeDoc: 'M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
} as const;

export const AUTO_LIST: readonly Automation[] = [
  { id: 'invoices', title: 'Request Invoices', codes: ['C-20', 'Q-1'], dept: 'Q', icon: ICO.invoice, desc: 'Fetch carrier invoices by date range and download PDF / Excel from WorkDrive.', top: true, kind: 'invoices' },
  { id: 'transactions', title: 'Transactions Report', codes: ['C-15'], dept: 'Q', icon: ICO.chart, desc: 'Pull a full fuel-transaction report for any carrier across a custom date window.', top: true, kind: 'transactions' },
  { id: 'payments', title: 'Check Payment Information', codes: ['C-18', 'Q-2'], dept: 'Q', icon: ICO.card, desc: 'View invoices and payments for a carrier over the last 90 days.', kind: 'simple', verb: 'Check Payments' },
  { id: 'billing-form', title: 'Billing Forms', codes: ['Q-9'], dept: 'Q', icon: ICO.doc, desc: 'View submitted billing forms and verification notes for a deal.', kind: 'simple', verb: 'Fetch Billing Form' },
  { id: 'balance', title: 'Balance Check', codes: ['C-8', 'Q-8'], dept: 'Q', icon: ICO.money, desc: 'Check the current available balance and credit line for a carrier account.', kind: 'simple', verb: 'Check Balance' },
  { id: 'account-status', title: 'Account Status Check', codes: ['Q-7', 'C-28'], dept: 'Q', icon: ICO.clipboardCheck, desc: 'Combined check across EFS balance, outstanding debt, and card counts.', kind: 'simple', verb: 'Check Status' },
  { id: 'tracking', title: 'Tracking Number Request', codes: ['C-22'], dept: 'C', icon: ICO.package, desc: 'Check card-order tracking numbers and shipment status for a carrier.', kind: 'simple', verb: 'Get Tracking' },
  { id: 'card-last-used', title: 'Card Last Used Check', codes: ['C-24'], dept: 'C', icon: ICO.card, desc: 'See when each card on the account was last used.', kind: 'simple', verb: 'Check Last Used' },
  { id: 'card-activation', title: 'Card Activation', codes: ['C-1'], dept: 'C', icon: ICO.checkCircle, desc: 'Activate an EFS card and optionally attach driver name, unit and driver ID.', kind: 'card', verb: 'Activate Card' },
  { id: 'card-deactivation', title: 'Card Deactivation', codes: ['C-3'], dept: 'C', icon: ICO.ban, desc: 'Deactivate an EFS card immediately.', kind: 'card', verb: 'Deactivate Card' },
  { id: 'limits-change', title: 'Increase / Decrease Limits', codes: ['C-4', 'C-5'], dept: 'C', icon: ICO.arrows, desc: 'Increase or decrease a product limit (ULSD, DEF, RFR, DSL) on any card.', kind: 'card', verb: 'Update Limit', limits: true },
  { id: 'unit-driver', title: 'Unit / Driver Change', codes: ['C-26'], dept: 'C', icon: ICO.edit, desc: 'Update the driver name, unit number and driver ID prompts on a card.', kind: 'card', verb: 'Submit Change' },
  { id: 'fraud-hold-release', title: 'Fraud Hold / Release', codes: ['C-10'], dept: 'C', icon: ICO.lock, desc: 'Clear a fraud hold on a card once the swipe pattern is confirmed legitimate.', kind: 'card', verb: 'Release Hold' },
  { id: 'override-card', title: 'Override the Card', codes: ['C-16'], dept: 'C', icon: ICO.gear, desc: 'Grant a fraud-held card a ~30 minute active window without lifting the hold.', kind: 'card', verb: 'Override Card' },
  { id: 'card-replacement', title: 'Card Replacement', codes: ['C-6'], dept: 'C', icon: ICO.card, desc: 'Ship replacement cards to a confirmed address (routes a CS ticket).', kind: 'ticket', verb: 'Request Replacement' },
  { id: 'reactivation', title: 'Account Reactivation', codes: ['C-7'], dept: 'C', icon: ICO.refresh, desc: 'File a reactivation request for a suspended / inactive account.', kind: 'ticket', verb: 'Request Reactivation' },
  { id: 'money-code', title: 'Money Code', codes: ['C-17'], dept: 'C', icon: ICO.cash, desc: 'Preview eligibility then draw an emergency EFS money code for a stranded driver.', kind: 'money', verb: 'Draw Money Code' },
  { id: 'boca-boe-link', title: 'BOCA Link Request', codes: ['C-27'], dept: 'C', icon: ICO.link, desc: 'Request a BOCA onboarding link for a WEX application (routes a CS ticket).', kind: 'form', verb: 'Send BOCA' },
  { id: 'close-app', title: 'Close Application', codes: ['C-14'], dept: 'C', icon: ICO.closeDoc, desc: 'Close a WEX application that is no longer moving forward (routes a CS ticket).', kind: 'form', verb: 'Close Application' },
  { id: 'wex-tasks', title: 'Application Update — WEX Tasks', codes: ['C-2', 'C-19'], dept: 'C', icon: ICO.clipboardCheck, desc: 'View latest application updates and WEX task responses for a deal.', kind: 'wex-tasks', verb: 'Get WEX Tasks' },
  { id: 'wex-apps', title: 'WEX Applications', codes: ['C-29'], dept: 'C', icon: ICO.invoice, desc: 'Search WEX applications by application ID, last name, or MC.', kind: 'search' },
  { id: 'efs-login', title: 'EFS Login', codes: ['C-12'], dept: 'C', icon: ICO.key, desc: 'Open the WEX EFS eManager credentials guide (PDF).', kind: 'link', verb: 'Open Guide' },
];

/** EFS limit product codes (widget parity). */
export const LIMITTYPES = [
  { value: 'ULSD', label: 'ULSD — Diesel gallons' },
  { value: 'DEF', label: 'DEF — Diesel Exhaust Fluid' },
  { value: 'RFR', label: 'RFR — Reefer' },
  { value: 'DSL', label: 'DSL — Diesel' },
] as const;

export const MONEY_CODE_REASONS = [
  'Driver stranded — fuel needed',
  'Emergency cash advance',
  'Breakdown / roadside',
  'Other',
] as const;

export const EFS_LOGIN_URL = 'https://www.wexdrive.com/otr/pdf/EFS_eMgr-CredGuide.pdf';

/** Every catalog id that dispatches a real run (touchpoint, Desk ticket, or static link). */
export const RUNNABLE = new Set(AUTO_LIST.map((a) => a.id));

export const PHASE_MAP: Record<string, string[]> = {
  invoices: ['Fetching invoices…', 'Formatting results…'],
  transactions: ['Pulling transaction records…', 'Formatting results…'],
  card: ['Connecting to EFS…', 'Locating card record…', 'Applying update…', 'Confirming with EFS…'],
  form: ['Submitting request…', 'Routing to team…'],
  simple: ['Authenticating…', 'Querying account…', 'Formatting response…'],
  ticket: ['Validating request…', 'Creating ticket…', 'Routing to team…'],
  money: ['Checking eligibility…', 'Drawing money code…', 'Confirming with EFS…'],
  'wex-tasks': ['Loading application…', 'Fetching WEX tasks…'],
  link: ['Opening guide…'],
  search: ['Searching…'],
};

// ---------- formatters ----------

export const str = (v: unknown): string => (v == null ? '' : String(v));
export const gal = (v: unknown): string => { const nn = Number(v); return Number.isFinite(nn) ? nn.toFixed(1) : '—'; };
export const shortCard = (v: unknown): string => { const c = str(v); return c ? `••${c.slice(-4)}` : '—'; };
export const fmtDate = (v: unknown): string => {
  const raw = str(v); if (!raw) return '—';
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? raw.slice(0, 10) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};
export const titleStatus = (v: unknown): string => {
  const x = str(v).toLowerCase();
  if (!x) return '—';
  if (x.includes('paid')) return 'Paid';
  if (x.includes('overdue') || x.includes('past')) return 'Overdue';
  return x.charAt(0).toUpperCase() + x.slice(1);
};
const normCardStatus = (raw: string): string => {
  const x = raw.toLowerCase();
  if (/fraud|hold/.test(x)) return 'fraud';
  if (/inactive|deactiv|suspend|closed|cancel/.test(x)) return 'inactive';
  if (/active|ok|good/.test(x)) return 'active';
  return 'inactive';
};
/** Map invoice UI preset → sales_mytrion.fetch_invoices range (last_7|last_30|last_90|custom). */
export const mapInvRange = (label: string): string => {
  const x = label.toLowerCase();
  if (x.includes('7')) return 'last_7';
  if (x.includes('90')) return 'last_90';
  if (x.includes('custom')) return 'custom';
  if (label === 'last_7' || label === 'last_30' || label === 'last_90' || label === 'custom') return label;
  return 'last_30';
};

/** @deprecated Prefer TXN_RANGE_PRESETS + txnRangeParams from txnReport.ts */
export const daysWindow = (sel: string): { from: string; to: string } => {
  const days = sel === '7' || sel === 'last_7' ? 7 : sel === '90' || sel === 'last_90' ? 90 : 30;
  const iso = (d: Date): string => d.toISOString().slice(0, 10);
  const to = new Date();
  return { from: iso(new Date(to.getTime() - days * 86_400_000)), to: iso(to) };
};

export const mapInvStatus = (value: string): string | undefined => {
  if (value === 'paid' || value === 'PAID') return 'PAID';
  if (value === 'PENDING' || value === 'pending' || value === 'overdue') return 'PENDING';
  return undefined; // ALL
};

// ---------- live loaders ----------

function mapDeal(r: Record<string, unknown>, i: number, dealIdByCarrier: Map<string, string>): Deal {
  const carrier = str(r.carrier_id);
  return {
    id: carrier || `deal-${i}`,
    name: str(r.company_name) || '(unnamed)',
    company: str(r.deal_full_name) || str(r.contact_name) || str(r.company_name),
    app: str(r.application_id) || str(r.deal_application_id) || '—',
    carrier,
    phone: str(r.deal_phone) || str(r.contact_phone) || '—',
    dealId: str(r.deal_id) || str(r.zoho_deal_id) || dealIdByCarrier.get(carrier) || '',
  };
}

/** Agent roster (clients.by_agent) enriched with Zoho Deal ids from CRM when available. */
export async function loadDeals(): Promise<Deal[]> {
  const [roster, crm] = await Promise.all([
    callTouchpoint('clients.by_agent', {}),
    loadCrmDeals().catch(() => []),
  ]);
  const dealIdByCarrier = new Map<string, string>();
  for (const d of crm) {
    if (d.carrierId && d.id) dealIdByCarrier.set(d.carrierId, d.id);
  }
  const fromRoster = (roster.data ?? []).map((c, i) => mapDeal(c as Record<string, unknown>, i, dealIdByCarrier));
  // Pre-conversion apps (BOCA / close / wex-tasks) need Application_ID deals with no carrier yet.
  const rosterApps = new Set(fromRoster.map((d) => d.app).filter((a) => a && a !== '—'));
  const appOnly = crm
    .filter((d) => d.app && d.app !== '—' && !d.carrierId && !rosterApps.has(d.app))
    .map((d, i) => ({
      id: `app-${d.id || i}`,
      name: d.name || d.company,
      company: d.company,
      app: d.app,
      carrier: '',
      phone: d.phone,
      dealId: d.id,
    }));
  return [...fromRoster, ...appOnly];
}

function mapCard(r: Record<string, unknown>, i: number): Card {
  const number = str(r.card_number ?? r.cardNumber);
  return {
    id: number || `card-${i}`,
    number,
    status: normCardStatus(str(r.status)),
    driver: str(r.driver_name ?? r.driverName ?? r.driver),
    unit: str(r.unit_number ?? r.unitNumber ?? r.unit),
  };
}
export async function loadCards(carrierId: string): Promise<Card[]> {
  let data: Array<Record<string, unknown>> = [];
  try {
    const res = await callTouchpoint('dwh.cards', { carrierId });
    data = (res.data ?? []) as Array<Record<string, unknown>>;
  } catch {
    const res = await callTouchpoint('efs.cards', { carrierId });
    data = (res.data ?? []) as Array<Record<string, unknown>>;
  }
  return data.map((c, i) => mapCard(c, i));
}

export async function loadMoneyCodePreview(carrierId: string): Promise<MoneyCodePreview> {
  return callTouchpoint('dwh.money_code', { carrierId });
}

export function mapWex(res: WexApplicationResult, fallback: string): WexResult {
  const app = (res.application ?? {}) as Record<string, unknown>;
  const pick = (keys: string[]): string => {
    for (const k of keys) { const v = app[k]; if (v != null && v !== '') return String(v); }
    return '';
  };
  const appId = str(res.appId) || fallback;
  return {
    company: pick(['company', 'companyName', 'CompanyName', 'company_name', 'dba', 'businessName', 'legalName']) || `Application ${appId}`,
    appId,
    contact: pick(['contact', 'contactName', 'applicant', 'applicantName', 'ownerName', 'fullName', 'name']) || '—',
    status: str(res.status) || '—',
    group: str(res.statusGroup) || '—',
  };
}

export function mapWexSearchRow(r: Record<string, unknown>, i: number): WexResult {
  const appId = str(r.appId ?? r.app_id ?? r.applicationId ?? r.id) || `row-${i}`;
  return {
    company: str(r.company ?? r.companyName ?? r.company_name ?? r.businessName) || `Application ${appId}`,
    appId,
    contact: str(r.contact ?? r.contactName ?? r.applicantName ?? r.lastName ?? r.name) || '—',
    status: str(r.status) || '—',
    group: str(r.statusGroup ?? r.status_group ?? r.group) || '—',
  };
}
