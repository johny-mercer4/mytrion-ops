/**
 * Automations tab — static action catalog + live-data loaders / formatters. The catalog is the
 * (real) menu of self-service actions; the loaders map real touchpoints (clients.by_agent,
 * dwh.cards / efs.cards, wex.application) onto the exact shapes AutoTab renders. No mock data.
 */
import { callTouchpoint } from '@/api/touchpoints';
import type { WexApplicationResult } from '@/api/touchpointTypes';

// ---------- types ----------

export interface Automation {
  id: string; title: string; codes: readonly string[]; dept: string; icon: string; desc: string;
  top?: boolean; kind?: string; verb?: string; limits?: boolean; soon?: boolean;
}
export interface Deal { id: string; name: string; company: string; app: string; carrier: string; phone: string; }
export interface Card { id: string; number: string; status: string; driver: string; unit: string; }
export interface WexResult { company: string; appId: string; contact: string; status: string; group: string; }
export interface InvRow { inv: string; date: string; amount: string; status: string; }
export interface TxnRow { date: string; card: string; driver: string; gallons: string; amount: string; }
export type DonePayload = { kind: 'invoices' | 'transactions' | 'message'; message?: string };

// ---------- static config (the menu of self-service actions) ----------

export const AUTO_LIST: readonly Automation[] = [
  { id: 'invoices', title: 'Request Invoices', codes: ['C-20', 'Q-1'], dept: 'Q', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', desc: 'Fetch carrier invoices by date range and download the exact files from WorkDrive.', top: true, kind: 'invoices' },
  { id: 'transactions', title: 'Transactions Report', codes: ['Q-4'], dept: 'Q', icon: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z', desc: 'Pull a full fuel-transaction report for any carrier across a custom date window.', top: true, kind: 'transactions' },
  { id: 'card-activation', title: 'Activate a Card', codes: ['C-3'], dept: 'C', icon: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3zM12 8v8M8 12h8', desc: 'Set an EFS card to Active and optionally attach driver name, unit and driver ID.', kind: 'card', verb: 'Activate Card' },
  { id: 'limits-change', title: 'Change Card Limits', codes: ['C-8'], dept: 'C', icon: 'M12 6v6l4 2m-4 10a10 10 0 110-20 10 10 0 010 20z', desc: 'Increase or decrease a per-transaction or daily limit on any active card.', kind: 'card', verb: 'Update Limit', limits: true },
  { id: 'fraud-hold-release', title: 'Release Fraud Hold', codes: ['C-11'], dept: 'C', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622z', desc: 'Clear a fraud hold on a card once the swipe pattern is confirmed legitimate.', kind: 'card', verb: 'Release Hold' },
  { id: 'override-card', title: 'Override a Card', codes: ['C-16'], dept: 'C', icon: 'M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z', desc: 'Grant a fraud-held card a ~30 minute active window without lifting the hold.', kind: 'card', verb: 'Override Card' },
  { id: 'card-replacement', title: 'Card Replacement', codes: ['C-6'], dept: 'C', icon: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z', desc: 'Ship replacement cards to a confirmed address with live address autocomplete.', kind: 'ticket', verb: 'Request Replacement' },
  { id: 'boca-boe-link', title: 'BOCA Link Request', codes: ['C-27'], dept: 'C', icon: 'M13.828 10.172a4 4 0 010 5.656l-4 4a4 4 0 01-5.656-5.656l1.5-1.5m9.656-9.656l-1.5 1.5m-4 4a4 4 0 015.656 0', desc: 'Generate a BOCA onboarding link for a WEX application and assign it to the owner.', kind: 'form', verb: 'Send BOCA' },
  { id: 'money-code', title: 'Issue Money Code', codes: ['C-9'], dept: 'C', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V7m0 10v1M21 12a9 9 0 11-18 0 9 9 0 0118 0z', desc: 'Generate an emergency EFS money code for a stranded driver.', kind: 'simple', verb: 'Issue Code' },
  { id: 'wex-apps', title: 'WEX Applications', codes: ['C-29'], dept: 'C', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', desc: 'Search WEX applications by application ID.', kind: 'search' },
  { id: 'balance', title: 'Account Balance Check', codes: ['Q-7'], dept: 'Q', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V7m0 10v1M21 12a9 9 0 11-18 0 9 9 0 0118 0z', desc: 'Check the current available balance and credit line for a carrier account.', kind: 'simple', verb: 'Check Balance' },
  { id: 'unit-driver', title: 'Edit Card Prompts', codes: ['C-4'], dept: 'C', icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828z', desc: 'Update the driver name, unit number and driver ID prompts on a card.', kind: 'card', verb: 'Submit Change' },
  { id: 'verification', title: 'DOT / MC Verification', codes: ['V-2'], dept: 'V', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622z', desc: 'Re-run FMCSA verification on a carrier before a card ships.', kind: 'simple', verb: 'Verify Carrier' },
  { id: 'close-app', title: 'Close Application', codes: ['C-14'], dept: 'C', icon: 'M6 18L18 6M6 6l12 12', desc: 'Close a WEX application that is no longer moving forward.', kind: 'form', verb: 'Close Application' },
  { id: 'reactivation', title: 'Card Reactivation', codes: ['C-7'], dept: 'C', icon: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15', desc: 'File a reactivation request for a deactivated card.', kind: 'ticket', verb: 'Request Reactivation' },
  { id: 'statement', title: 'Monthly Statement', codes: ['Q-9'], dept: 'Q', icon: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', desc: 'Download a carrier statement PDF for any billing cycle.', soon: true, kind: 'invoices' },
];
export const LIMITTYPES = ['Per-transaction $', 'Daily $', 'Daily gallons', 'Transactions / day'] as const;
/** Ids that dispatch a real self-service touchpoint on RUN. Everything else shows a note. */
export const RUNNABLE = new Set(['invoices', 'transactions', 'balance', 'money-code', 'verification', 'card-activation', 'limits-change', 'fraud-hold-release', 'override-card']);
export const PHASE_MAP: Record<string, string[]> = {
  invoices: ['Fetching invoices…', 'Formatting results…'],
  transactions: ['Pulling transaction records…', 'Formatting results…'],
  card: ['Connecting to EFS…', 'Locating card record…', 'Applying update…', 'Confirming with EFS…'],
  form: ['Submitting request…', 'Assigning to owner…'],
  simple: ['Authenticating…', 'Querying account…', 'Formatting response…'],
  ticket: ['Validating request…', 'Creating ticket…', 'Routing to team…'],
};

// ---------- formatters (shared by AutoTab's run dispatcher) ----------

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
export const mapInvRange = (label: string): string =>
  label === 'Last 90 days' ? 'last_90' : label === 'This year' ? 'this_year' : 'last_30';
export const daysWindow = (sel: string): { from: string; to: string } => {
  const days = sel === '7' ? 7 : sel === '90' ? 90 : 30;
  const iso = (d: Date): string => d.toISOString().slice(0, 10);
  const to = new Date();
  return { from: iso(new Date(to.getTime() - days * 86_400_000)), to: iso(to) };
};

// ---------- live loaders ----------

function mapDeal(r: Record<string, unknown>, i: number): Deal {
  const carrier = str(r.carrier_id);
  return {
    id: carrier || `deal-${i}`,
    name: str(r.company_name) || '(unnamed)',
    company: str(r.deal_full_name) || str(r.contact_name) || str(r.company_name),
    app: str(r.application_id) || str(r.deal_application_id) || '—',
    carrier,
    phone: str(r.deal_phone) || str(r.contact_phone) || '—',
  };
}
export async function loadDeals(): Promise<Deal[]> {
  const res = await callTouchpoint('clients.by_agent', {});
  return (res.data ?? []).map((c, i) => mapDeal(c as Record<string, unknown>, i));
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
