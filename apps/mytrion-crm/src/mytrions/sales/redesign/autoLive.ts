/**
 * Automations tab — static action catalog + live-data loaders / formatters. Catalog mirrors the
 * self-service widget's SS_AUTOMATION_BLOCKS (ids/codes/titles). Loaders map touchpoints onto the
 * shapes AutoTab renders. Run dispatch lives in autoRunners.ts.
 */
import { callTouchpoint } from '@/api/touchpoints';
import type { MoneyCodePreview, WexApplicationResult } from '@/api/touchpointTypes';
import { loadDeals as loadCrmDeals } from './dataCenterLive';
import type { IconName } from './icons';

// ---------- types ----------

export interface Automation {
  id: string; title: string; codes: readonly string[]; dept: string; icon: IconName; desc: string;
  /**
   * Icon accent — a `.ss-root` CSS var so it tracks light/dark themes
   * (e.g. `var(--ok)`, `var(--violet)`). Unique per action for scanability.
   */
  color: string;
  top?: boolean; kind?: string; verb?: string; limits?: boolean; soon?: boolean;
}

/** Fallback when an action has no `color` (shouldn't happen for catalog entries). */
export function autoIconColor(a: Pick<Automation, 'color' | 'dept'>): string {
  if (a.color) return a.color;
  if (a.dept === 'C') return 'var(--orange)';
  if (a.dept === 'Q') return 'var(--accent)';
  if (a.dept === 'V') return 'var(--ok)';
  if (a.dept === 'M') return 'var(--violet)';
  return 'var(--accent)';
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
export interface TrackingEntry {
  id: string;
  trackingNumber: string;
  startDate: string;
  cardsOrdered: string;
}
export interface WexTaskEntry {
  id: string;
  subject: string;
  description: string;
  createdDate: string;
}
export interface PaymentsSummary {
  invoiceCount: string;
  totalBilled: string;
  totalPaid: string;
  openBalance: string;
  paymentCount: string;
  paymentsTotal: string;
}
export interface CmpInvoiceRow {
  id: string;
  invoiceNumber: string;
  status: string;
  total: string;
  paid: string;
  remaining: string;
}
export type DonePayload =
  | { kind: 'invoices' }
  | { kind: 'transactions' }
  | { kind: 'message'; message: string }
  | { kind: 'table'; title: string; columns: string[]; rows: string[][] }
  | { kind: 'link'; label: string; url: string }
  | { kind: 'tracking'; carrierId: string; fedexTracking: string; entries: TrackingEntry[] }
  | { kind: 'wex-tasks'; appId: string; summary: string; tasks: WexTaskEntry[] }
  // Two backends fetched in PARALLEL and merged (widget parity — DWH payment-info + live CMP
  // invoices). Either half may be missing (allSettled) without failing the whole action.
  | { kind: 'payments'; carrierId: string; summary: PaymentsSummary | null; cmpInvoices: CmpInvoiceRow[]; cmpError?: string | undefined };

/** parcelsapp status page — same target as zoho-octane `trackingUrl()`. */
export function trackingStatusUrl(trackingNumber: string): string {
  const n = trackingNumber.trim();
  if (!n || n === '—') return '';
  return `https://parcelsapp.com/en/tracking/${encodeURIComponent(n)}`;
}

export interface Addr { address: string; city: string; state: string; zip: string; }
export interface UnitDriverForm { unitNumber: string; driverName: string; driverId: string; }
export interface MoneyCodeForm { amount: string; reason: string; unitNumber: string; }

// ---------- static config (self-service catalog) ----------
// Semantic icon names → ready-made lucide glyphs via <Icon> (see ./icons). Mirrors the
// zoho-octane automations-catalog action set.

const ICO = {
  clipboardCheck: 'clipboardCheck',
  package: 'package',
  card: 'card',
  invoice: 'invoice',
  doc: 'doc',
  chart: 'chart',
  edit: 'edit',
  refresh: 'refresh',
  money: 'money',
  checkCircle: 'checkCircle',
  ban: 'ban',
  arrows: 'arrows',
  cash: 'cash',
  lock: 'lock',
  key: 'key',
  gear: 'gear',
  link: 'link',
  closeDoc: 'closeDoc',
} satisfies Record<string, IconName>;

export const AUTO_LIST: readonly Automation[] = [
  { id: 'invoices', title: 'Request Invoices', codes: ['C-20', 'Q-1'], dept: 'Q', icon: ICO.invoice, color: 'var(--accent)', desc: 'Fetch carrier invoices by date range and download PDF / Excel from WorkDrive.', top: true, kind: 'invoices' },
  // C-15 is a CS code — lives under Customer Service (not Billing).
  { id: 'transactions', title: 'Transactions Report', codes: ['C-15'], dept: 'C', icon: ICO.chart, color: 'var(--cyan)', desc: 'Pull a full fuel-transaction report for any carrier across a custom date window.', top: true, kind: 'transactions' },
  { id: 'payments', title: 'Check Payment Information', codes: ['C-18', 'Q-2'], dept: 'Q', icon: ICO.card, color: 'var(--ok)', desc: 'View invoices and payments for a carrier over the last 90 days.', kind: 'simple', verb: 'Check Payments' },
  { id: 'billing-form', title: 'Billing Forms', codes: ['Q-9'], dept: 'Q', icon: ICO.doc, color: 'var(--violet)', desc: 'View submitted billing forms and verification notes for a deal.', kind: 'simple', verb: 'Fetch Billing Form' },
  { id: 'balance', title: 'Balance Check', codes: ['C-8', 'Q-8'], dept: 'Q', icon: ICO.money, color: 'var(--orange)', desc: 'Check the current available balance and credit line for a carrier account.', kind: 'simple', verb: 'Check Balance' },
  { id: 'account-status', title: 'Account Status Check', codes: ['Q-7', 'C-28'], dept: 'Q', icon: ICO.clipboardCheck, color: 'var(--warn)', desc: 'Combined check across EFS balance, outstanding debt, and card counts.', kind: 'simple', verb: 'Check Status' },
  { id: 'tracking', title: 'Tracking Number Request', codes: ['C-22'], dept: 'C', icon: ICO.package, color: 'var(--accent-2)', desc: 'Check card-order tracking numbers and shipment status for a carrier.', kind: 'simple', verb: 'Get Tracking' },
  { id: 'card-last-used', title: 'Card Last Used Check', codes: ['C-24'], dept: 'C', icon: ICO.card, color: 'var(--accent)', desc: 'See when each card on the account was last used.', kind: 'simple', verb: 'Check Last Used' },
  { id: 'card-activation', title: 'Card Activation', codes: ['C-1'], dept: 'C', icon: ICO.checkCircle, color: 'var(--ok)', desc: 'Activate an EFS card and optionally attach driver name, unit and driver ID.', kind: 'card', verb: 'Activate Card' },
  { id: 'card-deactivation', title: 'Card Deactivation', codes: ['C-3'], dept: 'C', icon: ICO.ban, color: 'var(--danger)', desc: 'Deactivate an EFS card immediately.', kind: 'card', verb: 'Deactivate Card' },
  { id: 'limits-change', title: 'Increase / Decrease Limits', codes: ['C-4', 'C-5'], dept: 'C', icon: ICO.arrows, color: 'var(--orange)', desc: 'Increase or decrease a product limit (ULSD, DEF, RFR, DSL) on any card.', kind: 'card', verb: 'Update Limit', limits: true },
  { id: 'unit-driver', title: 'Unit / Driver Change', codes: ['C-26'], dept: 'C', icon: ICO.edit, color: 'var(--violet)', desc: 'Update the driver name, unit number and driver ID prompts on a card.', kind: 'card', verb: 'Submit Change' },
  { id: 'fraud-hold-release', title: 'Fraud Hold / Release', codes: ['C-10'], dept: 'C', icon: ICO.lock, color: 'var(--warn)', desc: 'Clear a fraud hold on a card once the swipe pattern is confirmed legitimate.', kind: 'card', verb: 'Release Hold' },
  { id: 'override-card', title: 'Override the Card', codes: ['C-16'], dept: 'C', icon: ICO.gear, color: 'var(--cyan)', desc: 'Grant a fraud-held card a ~30 minute active window without lifting the hold.', kind: 'card', verb: 'Override Card' },
  { id: 'card-replacement', title: 'Card Replacement', codes: ['C-6'], dept: 'C', icon: ICO.card, color: 'var(--accent-2)', desc: 'Ship replacement cards to a confirmed address via the Zapier email request.', kind: 'ticket', verb: 'Request Replacement' },
  { id: 'reactivation', title: 'Account Reactivation', codes: ['C-7'], dept: 'C', icon: ICO.refresh, color: 'var(--ok)', desc: 'Request reactivation for a suspended / inactive account via Zapier email.', kind: 'ticket', verb: 'Request Reactivation' },
  { id: 'money-code', title: 'Money Code', codes: ['C-17'], dept: 'C', icon: ICO.cash, color: 'var(--orange)', desc: 'Preview eligibility then draw an emergency EFS money code for a stranded driver.', kind: 'money', verb: 'Draw Money Code' },
  { id: 'boca-boe-link', title: 'BOCA Link Request', codes: ['C-27'], dept: 'C', icon: ICO.link, color: 'var(--violet)', desc: 'Send a BOCA onboarding task in WEX via browser automation.', kind: 'form', verb: 'Send BOCA' },
  { id: 'close-app', title: 'Close Application', codes: ['C-14'], dept: 'C', icon: ICO.closeDoc, color: 'var(--danger)', desc: 'Close a WEX application via browser automation when it is no longer moving forward.', kind: 'form', verb: 'Close Application' },
  { id: 'wex-tasks', title: 'Application Update — WEX Tasks', codes: ['C-2', 'C-19'], dept: 'C', icon: ICO.clipboardCheck, color: 'var(--accent)', desc: 'View latest application updates and WEX task responses for a deal.', kind: 'wex-tasks', verb: 'Get WEX Tasks' },
  { id: 'wex-apps', title: 'WEX Applications', codes: ['C-29'], dept: 'C', icon: ICO.invoice, color: 'var(--cyan)', desc: 'Search WEX applications by applicant fields (name, company, MC, DOT, email, phone, or app ID).', kind: 'search' },
  { id: 'efs-login', title: 'EFS Login', codes: ['C-12'], dept: 'C', icon: ICO.key, color: 'var(--warn)', desc: 'Open the WEX EFS eManager credentials guide (PDF).', kind: 'link', verb: 'Open Guide' },
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
