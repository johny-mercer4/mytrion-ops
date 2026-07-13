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
// ---- shared pipeline metadata (matches the self-service reference records-panel exactly) ----
//
// Deal kanban = the FIXED 10-stage blueprint order (always shown, in this order). Lead kanban groups
// by the real Lead `Status`. Colors + order are ported verbatim from zoho-octane self-service
// records-panel (dealStageColor / leadStageColor / groupedDeals STAGE_ORDER).

export const DEAL_STAGE_ORDER: string[] = [
  'Application Filled', 'Application Processing', 'Application Approved', 'Cards Sent',
  'Cards Delivered', 'Billing Form Sent', 'Billing Form Filled', 'Card Funded',
  'Card Swiped', 'Closed Lost',
];
export const LEAD_STATUS_ORDER: string[] = [
  'First Call', 'Second Call', 'Third Call', 'Follow-up', 'Email Follow-Up',
  'Interested', 'Application Filled', 'Not Interested', 'Unqualified',
];

// Reference color NAME → this theme's CSS var.
const COLOR_VAR: Record<string, string> = {
  blue: 'var(--accent)', indigo: 'var(--accent-2)', purple: 'var(--violet)', orange: 'var(--orange)',
  yellow: 'var(--warn)', green: 'var(--ok)', red: 'var(--danger)', gray: 'var(--muted)',
};
const LEAD_STATUS_COLORNAME: Record<string, string> = {
  'First Call': 'blue', 'Second Call': 'indigo', 'Third Call': 'purple', Interested: 'green',
  'Application Filled': 'orange', 'Not Interested': 'red', 'Follow-up': 'yellow',
  Unqualified: 'gray', 'Email Follow-Up': 'blue',
};
const DEAL_STAGE_COLORNAME: Record<string, string> = {
  'Application Filled': 'blue', 'Application Processing': 'indigo', 'Application Approved': 'purple',
  'Cards Sent': 'orange', 'Cards Delivered': 'yellow', 'Billing Form Sent': 'blue',
  'Billing Form Filled': 'indigo', 'Card Funded': 'green', 'Card Swiped': 'green', 'Closed Lost': 'red',
};

export function leadStatusColor(status: string): string {
  return COLOR_VAR[LEAD_STATUS_COLORNAME[status] ?? 'gray'] as string;
}
export function dealStageColor(stage: string): string {
  return COLOR_VAR[DEAL_STAGE_COLORNAME[stage] ?? 'gray'] as string;
}

export interface StageColumn {
  key: string;
  label: string;
  col: string;
}

/** Lead columns = the statuses PRESENT in the data, ordered by LEAD_STATUS_ORDER (unknown → end). */
export function leadColumns(present: string[]): StageColumn[] {
  const seen = new Set(present.filter(Boolean));
  const known = LEAD_STATUS_ORDER.filter((s) => seen.has(s));
  const extra = [...seen].filter((s) => !LEAD_STATUS_ORDER.includes(s));
  return [...known, ...extra].map((v) => ({ key: v, label: v, col: leadStatusColor(v) }));
}
/** Deal columns = the fixed 10-stage blueprint, always shown in order (matches the reference). */
export function dealColumns(): StageColumn[] {
  return DEAL_STAGE_ORDER.map((v) => ({ key: v, label: v, col: dealStageColor(v) }));
}

/** utm_source → pill color (reference utmPillClass). */
export function utmColor(source: string): string {
  const s = source.toLowerCase();
  if (s.includes('meta') || s.includes('facebook') || s.includes('instagram')) return 'var(--accent)';
  if (s.includes('website') || s.includes('organic') || s.includes('google')) return 'var(--ok)';
  return 'var(--muted)';
}

// ---- Leads ----

export interface LeadVM {
  id: string;
  /** Card title = the person's full name (reference `fullName`). */
  contact: string;
  company: string;
  initials: string;
  title: string;
  phone: string;
  email: string;
  source: string;
  /** The real Zoho Lead `Status` value — the kanban column key + badge. */
  status: string;
  converted: boolean;
  utmSource: string;
  /** Relative created time (reference `relDate(created_time)`). */
  created: string;
  value: number;
  valueFmt: string;
  trucks: number;
  note: string;
}

function mapLead(r: CrmRow): LeadVM {
  const contact = str(r.Full_Name) || '—';
  const company = str(r.Company) || str(r.Full_Name) || '(unnamed lead)';
  const status = str(r.Status) || 'No Status';
  const value = n(r.Annual_Revenue);
  return {
    id: str(r.id),
    contact,
    company,
    initials: initialsOf(contact === '—' ? company : contact),
    title: str(r.Designation) || '—',
    phone: str(r.Phone),
    email: str(r.Email) || '—',
    source: str(r.Lead_Source),
    status,
    converted: r.Converted__s === true,
    utmSource: str(r.utm_source),
    created: relTime(str(r.Created_Time) || str(r.Modified_Time)) || '',
    value,
    valueFmt: value > 0 ? money(value) : '—',
    trucks: n(r.Trucks),
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
  /** The real Zoho Deal `Stage` value — the kanban column key. */
  stage: string;
  /** Card fields (reference): raw carrier id, application id, utm source, created rel, app date. */
  carrierId: string;
  app: string;
  utmSource: string;
  created: string;
  appDate: string;
  value: number;
  valueFmt: string;
  cards: number;
  prob: number;
  close: string;
  contact: string;
  phone: string;
  email: string;
  carrier: string;
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
    stage: str(r.Stage) || 'Application Filled',
    carrierId: str(r.Carrier_ID),
    app: str(r.Application_ID),
    utmSource: str(r.utm_source),
    created: relTime(str(r.Created_Time) || str(r.Modified_Time)) || '',
    appDate: fmtDate(r.Application_Date),
    value,
    valueFmt: value > 0 ? money(value) : '—',
    cards: n(r.Cards_Requested),
    prob: n(r.Probability),
    close: fmtDate(r.Closing_Date) || '—',
    contact: contact || '—',
    phone: str(r.Phone) || str(r.Cell) || '—',
    email: str(r.Email),
    carrier: r.Carrier_ID ? `CR-${str(r.Carrier_ID)}` : '—',
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
