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
function isThisMonth(v: unknown): boolean {
  const raw = str(v);
  if (!raw) return false;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

// ---- shared pipeline metadata (ordered columns, colors) ----

export interface StageMeta<K extends string> {
  key: K;
  label: string;
  col: string;
}

export const LEAD_STAGES: StageMeta<LeadStage>[] = [
  { key: 'new', label: 'New', col: 'var(--accent)' },
  { key: 'contacted', label: 'Contacted', col: 'var(--cyan)' },
  { key: 'interested', label: 'Interested', col: 'var(--violet)' },
  { key: 'filled', label: 'Application Filled', col: 'var(--warn)' },
  { key: 'closed', label: 'Closed', col: 'var(--muted)' },
];
export const DEAL_STAGES: StageMeta<DealStage>[] = [
  { key: 'discovery', label: 'Discovery', col: 'var(--accent)' },
  { key: 'application', label: 'Application', col: 'var(--cyan)' },
  { key: 'underwriting', label: 'Underwriting', col: 'var(--violet)' },
  { key: 'processing', label: 'Processing', col: 'var(--warn)' },
  { key: 'activated', label: 'Activated', col: 'var(--ok)' },
];
export const LEAD_STAGE_META: Record<LeadStage, StageMeta<LeadStage>> = Object.fromEntries(
  LEAD_STAGES.map((s) => [s.key, s]),
) as Record<LeadStage, StageMeta<LeadStage>>;
export const DEAL_STAGE_META: Record<DealStage, StageMeta<DealStage>> = Object.fromEntries(
  DEAL_STAGES.map((s) => [s.key, s]),
) as Record<DealStage, StageMeta<DealStage>>;
export const TEMP_COL: Record<'hot' | 'warm' | 'cold', string> = {
  hot: 'var(--danger)',
  warm: 'var(--orange)',
  cold: 'var(--accent)',
};
/** Rejection reason-category → bar color (reference reasonPal). */
export const REASON_COL: Record<string, string> = {
  Credit: 'var(--danger)',
  'Follow-up': 'var(--warn)',
  Verification: 'var(--accent)',
  Fraud: 'var(--violet)',
  Duplicate: 'var(--cyan)',
  Competition: 'var(--orange)',
  Withdrawn: 'var(--muted)',
  Other: 'var(--text2)',
};

// ---- Leads ----

export type LeadStage = 'new' | 'contacted' | 'interested' | 'filled' | 'closed';

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
  status: string;
  stage: LeadStage;
  temp: 'hot' | 'warm' | 'cold';
  last: string;
  note: string;
}

// Real Lead `Status` picklist → pipeline bucket.
const LEAD_STATUS_STAGE: Record<string, LeadStage> = {
  Interested: 'interested',
  'First Call': 'contacted',
  'Second Call': 'contacted',
  'Third Call': 'contacted',
  'Follow-up': 'contacted',
  'Email Follow-Up': 'contacted',
  'Application Filled': 'filled',
  'Not Interested': 'closed',
  Unqualified: 'closed',
};
const LEAD_TEMP: Record<LeadStage, 'hot' | 'warm' | 'cold'> = {
  interested: 'hot',
  filled: 'hot',
  contacted: 'warm',
  new: 'cold',
  closed: 'cold',
};

function mapLead(r: CrmRow): LeadVM {
  const company = str(r.Company) || str(r.Full_Name) || '(unnamed lead)';
  const status = str(r.Status);
  const stage = LEAD_STATUS_STAGE[status] ?? 'new';
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
    status: status || 'New',
    stage,
    temp: LEAD_TEMP[stage],
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

export type DealStage = 'discovery' | 'application' | 'underwriting' | 'processing' | 'activated';

export interface DealVM {
  id: string;
  company: string;
  name: string;
  initials: string;
  value: number;
  valueFmt: string;
  cards: number;
  stage: DealStage;
  rawStage: string;
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

// Real Deal `Stage` picklist → pipeline bucket. Lost/won-lost states are handled separately
// (rejections); anything unmapped falls back to 'discovery' so no deal silently disappears.
const DEAL_STAGE_BUCKET: Record<string, DealStage> = {
  Qualification: 'discovery',
  Interested: 'discovery',
  Lead: 'discovery',
  'Needs Analysis': 'discovery',
  'Value Proposition': 'discovery',
  'Id. Decision Makers': 'discovery',
  'Due Dilligence': 'discovery',
  'Application Sent': 'application',
  'Application Filled': 'application',
  'Application Processing': 'application',
  'Vendor Validation': 'application',
  'CS Validation': 'application',
  'Proposal/Price Quote': 'application',
  'Application Approved': 'underwriting',
  'Negotiation/Review': 'underwriting',
  'Billing Form Sent': 'underwriting',
  'Billing Form Filled': 'underwriting',
  'EFS Processing': 'processing',
  'Card Funded': 'processing',
  'Cards Sent': 'processing',
  'Cards Delivered': 'processing',
  'Cards Activated': 'activated',
  'Card Swiped': 'activated',
  'Closed Won': 'activated',
};
// Deals in these stages are shown in the Rejections report, not the active pipeline.
const DEAL_EXCLUDE = new Set(['Closed Lost', 'Closed Lost to Competition']);

function mapDeal(r: CrmRow): DealVM {
  const company = lookupName(r.Account_Name) || str(r.Deal_Name) || '(unnamed deal)';
  const contact = lookupName(r.Contact_Name) || `${str(r.First_name)} ${str(r.Last_Name)}`.trim();
  const value = n(r.Amount) || n(r.Credit_Line_Approved);
  const rawStage = str(r.Stage);
  return {
    id: str(r.id),
    company,
    name: str(r.Deal_Name) || company,
    initials: initialsOf(company),
    value,
    valueFmt: value > 0 ? money(value) : '—',
    cards: n(r.Cards_Requested),
    stage: DEAL_STAGE_BUCKET[rawStage] ?? 'discovery',
    rawStage: rawStage || '—',
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
  return rows.filter((r) => !DEAL_EXCLUDE.has(str(r.Stage))).map(mapDeal);
}

// ---- Rejections ----

export interface RejectionVM {
  id: string;
  company: string;
  initials: string;
  appId: string;
  reason: string;
  reasonCat: string;
  date: string;
  severity: 'hard' | 'soft';
  canRetry: boolean;
  month: boolean;
}

// Real `Reason_For_Loss__s` picklist → the report's reason category.
const REASON_CAT: Record<string, string> = {
  'Low Credit Score': 'Credit',
  'Hard Decline': 'Credit',
  Price: 'Credit',
  'Low Discounts': 'Credit',
  'Missed Follow Ups': 'Follow-up',
  'Lack of response': 'Follow-up',
  'Unqualified Customer': 'Verification',
  'Wrong Target': 'Verification',
  'Expectation Mismatch': 'Verification',
  'Duplicate Deal': 'Duplicate',
  'Not Interested': 'Withdrawn',
  'Account Closed': 'Withdrawn',
  'Future Interest': 'Withdrawn',
  Competition: 'Competition',
  'WEX Closed': 'Credit',
};
const HARD_CATS = new Set(['Credit', 'Fraud']);

function mapRejection(r: CrmRow): RejectionVM {
  const company = lookupName(r.Account_Name) || str(r.Deal_Name) || '(unnamed)';
  const appStatus = str(r.Application_Status);
  const lossReason = str(r.Reason_For_Loss__s);
  let reasonCat = REASON_CAT[lossReason] ?? 'Other';
  if (appStatus === 'Closed/Fraud') reasonCat = 'Fraud';
  const severity: 'hard' | 'soft' =
    HARD_CATS.has(reasonCat) || appStatus === 'Closed/Fraud' || appStatus === 'Disqualified' ? 'hard' : 'soft';
  const reason =
    str(r.Reject_reason) || lossReason || str(r.Credit_Decision) || appStatus || 'Application rejected';
  return {
    id: str(r.id),
    company,
    initials: initialsOf(company),
    appId: str(r.Application_ID) || '—',
    reason,
    reasonCat,
    date: fmtDate(r.Modified_Time) || relTime(str(r.Modified_Time)) || '—',
    severity,
    canRetry: severity === 'soft',
    month: isThisMonth(r.Modified_Time),
  };
}

export async function loadRejections(): Promise<RejectionVM[]> {
  const actAsId = getImpersonation()?.zohoUserId;
  const rows = await listRejections(actAsId);
  return rows.map(mapRejection);
}

export { numFmt };
