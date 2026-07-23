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
/** Epoch ms of a 'YYYY-MM-DD'/ISO date, or 0 when unset/invalid (for sorting). */
function tsOf(v: unknown): number {
  const raw = str(v);
  if (!raw) return 0;
  const d = new Date(raw.length <= 10 ? `${raw}T00:00:00` : raw).getTime();
  return Number.isNaN(d) ? 0 : d;
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
/**
 * Pipeline order for Lead Status. New Lead leads the board (yellow); No Status is always last.
 * Other picklist values sit in between; unknown statuses land just before No Status.
 */
export const LEAD_STATUS_ORDER: string[] = [
  'New Lead', 'First Call', 'Second Call', 'Third Call', 'Follow-up', 'Email Follow-Up',
  'Interested', 'Application Filled', 'Not Interested', 'Unqualified', 'Unaccounted', 'No Status',
];

// Reference color NAME → this theme's CSS var.
const COLOR_VAR: Record<string, string> = {
  blue: 'var(--accent)', indigo: 'var(--accent-2)', purple: 'var(--violet)', orange: 'var(--orange)',
  yellow: 'var(--warn)', green: 'var(--ok)', red: 'var(--danger)', gray: 'var(--muted)',
};
const LEAD_STATUS_COLORNAME: Record<string, string> = {
  'New Lead': 'yellow', 'First Call': 'blue', 'Second Call': 'indigo', 'Third Call': 'purple',
  Interested: 'green', 'Application Filled': 'orange', 'Not Interested': 'red', 'Follow-up': 'orange',
  Unqualified: 'gray', 'Email Follow-Up': 'blue', Unaccounted: 'gray', 'No Status': 'gray',
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

/** Lead columns = statuses PRESENT in the data; known order, extras before No Status, No Status last. */
export function leadColumns(present: string[]): StageColumn[] {
  const seen = new Set(present.filter(Boolean));
  const known = LEAD_STATUS_ORDER.filter((s) => s !== 'No Status' && seen.has(s));
  const extra = [...seen].filter((s) => !LEAD_STATUS_ORDER.includes(s));
  const ordered = [...known, ...extra, ...(seen.has('No Status') ? (['No Status'] as const) : [])];
  return ordered.map((v) => ({ key: v, label: v, col: leadStatusColor(v) }));
}
/** Deal columns = the fixed 10-stage blueprint, always shown in order (matches the reference). */
export function dealColumns(): StageColumn[] {
  return DEAL_STAGE_ORDER.map((v) => ({ key: v, label: v, col: dealStageColor(v) }));
}

/** utm_source / source badge color — Leads redesign `sourceColor` (CSS vars). */
export function leadSourceColor(source: string): string {
  const s = source.toLowerCase();
  if (s.includes('facebook') || s.includes('meta') || s.includes('instagram') || /\bfb\b/.test(s)) {
    return 'var(--accent)';
  }
  if (s.includes('website') || s.includes('organic') || s.includes('google') || s.includes('web')) {
    return 'var(--ok)';
  }
  if (s.includes('referral') || s.includes('employee') || s.includes('partner')) return 'var(--violet)';
  if (s.includes('cold')) return 'var(--orange)';
  if (s.includes('trade') || s.includes('seminar') || s.includes('chat') || s.includes('event')) {
    return 'var(--accent-2)';
  }
  if (s.includes('carrier411') || s.includes('carrier_411')) return 'var(--accent-2)';
  return 'var(--muted)';
}

/** @deprecated alias — same palette as leadSourceColor (utm_source is the display source). */
export function utmColor(source: string): string {
  return leadSourceColor(source);
}

/** Absolute datetime for lead modal date rows ("Jul 18, 2026 · 12:41 PM"). */
function fmtDateTime(v: unknown): string {
  const raw = str(v);
  if (!raw) return '—';
  const d = new Date(raw.length <= 10 ? `${raw}T00:00:00` : raw);
  if (Number.isNaN(d.getTime())) return raw;
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

// ---- Leads ----

/** Raw editable Lead values, keyed by exact Zoho API name — feeds the modal's inline-edit inputs and
 *  is sent straight back to PATCH /data-center/leads/:id. Unlike the display fields these carry NO
 *  sentinels ('—', "No notes…") so an input never round-trips a placeholder into the CRM. */
export interface LeadEdit {
  MC: string;
  DOT: string;
  Referral_Source: string;
  Cell: string;
  Phone: string;
  Email: string;
  Description: string;
}

export interface LeadVM {
  id: string;
  /** Person's Full_Name — kanban/list primary label + modal hero. */
  contact: string;
  company: string;
  initials: string;
  phone: string;
  cell: string;
  email: string;
  /** Display source = Zoho `utm_source` (kanban badge, list Source col, modal Source tile). */
  source: string;
  /** The real Zoho Lead `Status` value — the kanban column key. */
  status: string;
  converted: boolean;
  /** Relative created time for list/card footers. */
  created: string;
  createdAt: string;
  fbRegisteredAt: string;
  webRegisteredAt: string;
  lastActivityAt: string;
  modifiedAt: string;
  mc: string;
  dot: string;
  referral: string;
  trucks: number;
  note: string;
  /** Raw values for the inline editor (see {@link LeadEdit}). */
  edit: LeadEdit;
}

function mapLead(r: CrmRow): LeadVM {
  const contact = str(r.Full_Name) || '—';
  const company = str(r.Company) || '(unnamed company)';
  const rawStatus = str(r.Status);
  const status = !rawStatus || rawStatus === '-None-' ? 'No Status' : rawStatus;
  const referral = str(r.Referral_Source) || lookupName(r.Referred_By) || '—';
  const dotRaw = r.DOT;
  return {
    id: str(r.id),
    contact,
    company,
    initials: initialsOf(contact === '—' ? company : contact),
    phone: str(r.Phone),
    cell: str(r.Cell),
    email: str(r.Email) || '—',
    source: str(r.utm_source),
    status,
    converted: r.Converted__s === true,
    created: relTime(str(r.Created_Time) || str(r.Modified_Time)) || '',
    createdAt: fmtDateTime(r.Created_Time),
    fbRegisteredAt: fmtDateTime(r.Registration_Time),
    webRegisteredAt: fmtDateTime(r.Web_Registration_Date),
    lastActivityAt: fmtDateTime(r.Last_Activity_Time),
    modifiedAt: fmtDateTime(r.Modified_Time),
    mc: str(r.MC) || '—',
    dot: dotRaw == null || str(dotRaw) === '' ? '—' : str(dotRaw),
    referral,
    trucks: n(r.Trucks),
    note: str(r.Description) || 'No notes on this lead yet.',
    edit: {
      MC: str(r.MC),
      DOT: dotRaw == null ? '' : str(dotRaw),
      Referral_Source: str(r.Referral_Source),
      Cell: str(r.Cell),
      Phone: str(r.Phone),
      Email: str(r.Email),
      Description: str(r.Description),
    },
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
  /** Epoch ms of Application_Date (0 when unset) — sort key for the create-ticket "recent deals". */
  appTs: number;
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
  /** Raw editable Deal values (Zoho API names) for the inline editor → PATCH /data-center/deals/:id. */
  edit: DealEdit;
}

/** Raw editable Deal values, keyed by exact Zoho API name (see {@link LeadEdit}). */
export interface DealEdit {
  Email: string;
  Phone: string;
  Cell: string;
  Secondary_Email: string;
  Description: string;
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
    appTs: tsOf(r.Application_Date),
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
    edit: {
      Email: str(r.Email),
      // Raw Phone only — the display `phone` falls back to Cell, which must not be written into Phone.
      Phone: str(r.Phone),
      Cell: str(r.Cell),
      Secondary_Email: str(r.Secondary_Email),
      Description: str(r.Description),
    },
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
