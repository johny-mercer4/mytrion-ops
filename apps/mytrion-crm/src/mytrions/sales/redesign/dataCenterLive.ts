/**
 * Sales Data Center — live-data adapters. Maps the raw Zoho CRM COQL rows (from /v1/data-center)
 * onto the view-model shapes the Data Center sub-tabs render (Leads / Deals / Rejections), the same
 * way live.ts maps Desk tickets. NO mock data — every row is a real CRM record.
 *
 * Pipeline "stages" here are BUCKETS over the org's real picklists (Lead `Status`, Deal `Stage`),
 * so the kanban/list stays a clean 5-column pipeline instead of exposing ~25 raw picklist values.
 */
import { listDeals, listLeads, listRejections, type CrmRow } from '@/api/dataCenter';
import { getImpersonation } from '@/api/impersonation';
import { money, numFmt, relTime } from './live';

// ---- shared helpers ----

const n = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0) || 0);
const str = (v: unknown): string => (v == null ? '' : String(v)).trim();
/** A Zoho lookup/owner field is `{name,id}` (or null); take its display name. */
const lookupName = (v: unknown): string =>
  v && typeof v === 'object' ? str((v as { name?: unknown }).name) : str(v);
const initialsOf = (name: string): string =>
  name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';

/** 'YYYY-MM-DD' (or ISO) → "Jul 22"; empty string when unset/invalid. */
function fmtDate(v: unknown): string {
  const raw = str(v);
  if (!raw) return '';
  const d = new Date(raw.length <= 10 ? `${raw}T00:00:00` : raw);
  return Number.isNaN(d.getTime()) ? raw : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function withinDays(v: unknown, days: number): boolean {
  const raw = str(v);
  if (!raw) return false;
  const d = new Date(raw.length <= 10 ? `${raw}T00:00:00` : raw).getTime();
  if (Number.isNaN(d)) return false;
  const now = Date.now();
  return d >= now && d <= now + days * 86_400_000;
}
// ---- shared pipeline metadata (REAL Zoho picklists) ----
//
// Kanban columns are the actual Zoho picklist values (Lead `Status` / Deal `Stage`), NOT invented
// buckets — the values present in the data are rendered as columns, ordered by these canonical
// picklist orders (verified live against /settings/fields). Unknown/blank values sort to the end.

export const LEAD_STATUS_ORDER: string[] = [
  'New Lead', 'Unaccounted', 'First Call', 'Second Call', 'Third Call', 'Follow-up',
  'Email Follow-Up', 'Interested', 'Application Filled', 'Not Interested', 'Unqualified',
];
export const DEAL_STAGE_ORDER: string[] = [
  'Qualification', 'Interested', 'Lead', 'Needs Analysis', 'Application Sent', 'Value Proposition',
  'Application Filled', 'Vendor Validation', 'Id. Decision Makers', 'CS Validation', 'Proposal/Price Quote',
  'Negotiation/Review', 'EFS Processing', 'Cards Sent', 'Cards Activated', 'Closed Lost to Competition',
  'Card Funded', 'Billing Form Sent', 'Billing Form Filled', 'Closed Won', 'Closed Lost', 'Due Dilligence',
  'Card Swiped', 'Application Processing', 'Application Approved', 'Cards Delivered',
];

const STAGE_PALETTE = ['var(--accent)', 'var(--cyan)', 'var(--violet)', 'var(--warn)', 'var(--ok)', 'var(--orange)', 'var(--danger)', 'var(--accent-2)'];

/** Stable color for a stage/status value by its canonical picklist index (unknown → last slot). */
export function stageColor(order: string[], value: string): string {
  const i = order.indexOf(value);
  return STAGE_PALETTE[(i < 0 ? order.length : i) % STAGE_PALETTE.length] as string;
}

export interface StageColumn {
  key: string;
  label: string;
  col: string;
}

/** Kanban columns = the distinct stage values PRESENT in the data, in canonical picklist order. */
export function columnsFor(order: string[], present: string[]): StageColumn[] {
  const seen = new Set(present.filter(Boolean));
  const known = order.filter((s) => seen.has(s));
  const extra = [...seen].filter((s) => !order.includes(s)); // custom/unknown values → end
  return [...known, ...extra].map((v) => ({ key: v, label: v, col: stageColor(order, v) }));
}

export const TEMP_COL: Record<'hot' | 'warm' | 'cold', string> = {
  hot: 'var(--danger)',
  warm: 'var(--orange)',
  cold: 'var(--accent)',
};

// ---- Leads ----

export interface LeadVM {
  id: string;
  company: string;
  contact: string;
  initials: string;
  title: string;
  phone: string;
  email: string;
  value: number;
  valueFmt: string;
  trucks: number;
  source: string;
  /** The real Zoho Lead `Status` value — the kanban column key. */
  status: string;
  temp: 'hot' | 'warm' | 'cold';
  last: string;
  note: string;
}

/** Card "temperature" dot derived from the real Lead Status (no separate Zoho field for it). */
function leadTemp(status: string): 'hot' | 'warm' | 'cold' {
  if (status === 'Interested' || status === 'Application Filled') return 'hot';
  if (['First Call', 'Second Call', 'Third Call', 'Follow-up', 'Email Follow-Up'].includes(status)) return 'warm';
  return 'cold';
}

function mapLead(r: CrmRow): LeadVM {
  const company = str(r.Company) || str(r.Full_Name) || '(unnamed lead)';
  const status = str(r.Status) || 'Unaccounted';
  const value = n(r.Annual_Revenue);
  return {
    id: str(r.id),
    company,
    contact: str(r.Full_Name) || '—',
    initials: initialsOf(company),
    title: str(r.Designation) || '—',
    phone: str(r.Phone) || '—',
    email: str(r.Email) || '—',
    value,
    valueFmt: value > 0 ? money(value) : '—',
    trucks: n(r.Trucks),
    source: str(r.Lead_Source) || 'Unknown',
    status,
    temp: leadTemp(status),
    last: relTime(str(r.Last_Activity_Time) || str(r.Modified_Time)) || '—',
    note: str(r.Description) || 'No notes on this lead yet.',
  };
}

export async function loadLeads(): Promise<LeadVM[]> {
  const actAsId = getImpersonation()?.zohoUserId;
  const rows = await listLeads(actAsId);
  return rows.map(mapLead);
}

// ---- Deals ----

export interface DealVM {
  id: string;
  company: string;
  name: string;
  initials: string;
  value: number;
  valueFmt: string;
  cards: number;
  /** The real Zoho Deal `Stage` value — the kanban column key. */
  stage: string;
  prob: number;
  close: string;
  contact: string;
  phone: string;
  email: string;
  app: string;
  carrier: string;
  carrierId: string;
  note: string;
  thisWeek: boolean;
}

function mapDeal(r: CrmRow): DealVM {
  const company = lookupName(r.Account_Name) || str(r.Deal_Name) || '(unnamed deal)';
  const contact = lookupName(r.Contact_Name) || `${str(r.First_name)} ${str(r.Last_Name)}`.trim();
  const value = n(r.Amount) || n(r.Credit_Line_Approved);
  return {
    id: str(r.id),
    company,
    name: str(r.Deal_Name) || company,
    initials: initialsOf(company),
    value,
    valueFmt: value > 0 ? money(value) : '—',
    cards: n(r.Cards_Requested),
    stage: str(r.Stage) || 'Qualification',
    prob: n(r.Probability),
    close: fmtDate(r.Closing_Date) || '—',
    contact: contact || '—',
    phone: str(r.Phone) || str(r.Cell) || '—',
    email: str(r.Email),
    app: str(r.Application_ID) || '—',
    carrier: r.Carrier_ID ? `CR-${str(r.Carrier_ID)}` : '—',
    carrierId: str(r.Carrier_ID),
    note: str(r.Description) || 'No notes on this deal yet.',
    thisWeek: withinDays(r.Closing_Date, 7),
  };
}

export async function loadDeals(): Promise<DealVM[]> {
  const actAsId = getImpersonation()?.zohoUserId;
  const rows = await listDeals(actAsId);
  return rows.map(mapDeal);
}

// ---- Rejection reports (from Zoho DESK — auto-created "Rejection Report" tickets) ----
//
// These are real Desk tickets whose subject is "Rejection Report: <Company> - Error <code>". No
// synthetic categories, no computed totals — just the real report rows the Desk automation created.

export interface RejectionVM {
  id: string;
  number: string;
  company: string;
  initials: string;
  reason: string;
  date: string;
  status: string;
}

interface RejContact {
  lastName?: string | null;
  account?: { accountName?: string | null } | null;
}

function mapRejection(t: CrmRow): RejectionVM {
  const subject = str(t.subject);
  // "Rejection Report: <Company> - Error <code>" → split company / reason off the subject.
  const m = subject.match(/^rejection report:\s*(.+?)\s*-\s*(.+)$/i);
  const contact = (t.contact ?? {}) as RejContact;
  const company =
    str(contact.account?.accountName) || (m ? m[1] : '') || str(contact.lastName) || subject || '(unknown)';
  const reason = (m ? m[2] : subject.replace(/^rejection report:\s*/i, '')) || 'Rejected';
  const created = str(t.createdTime);
  return {
    id: str(t.id),
    number: str(t.ticketNumber || t.number),
    company,
    initials: initialsOf(company),
    reason,
    date: fmtDate(created) || relTime(created) || '—',
    status: str(t.status) || 'Open',
  };
}

export async function loadRejections(): Promise<RejectionVM[]> {
  const rows = await listRejections();
  return rows.map(mapRejection);
}

export { numFmt };
