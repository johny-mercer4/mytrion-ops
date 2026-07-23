/**
 * Retention Phase 1 data adapters for Sales Mytrion — touchpoints over retention_cases.
 * Identity is server-injected; admin "view as" flows through transport x-act-as headers.
 */
import { callTouchpoint } from '@/api/touchpoints';
import type {
  RetentionCaseDetailResult,
  RetentionCaseEventRow,
  RetentionCaseRow,
  RetentionCasesListResult,
  RetentionChannel,
  RetentionDissatisfactionReason,
  RetentionLookupsResult,
  RetentionPhase1Outcome,
} from '@/api/touchpointTypes';
import { stageTimerCaption } from './retentionTimers';

export type {
  RetentionCaseRow,
  RetentionCaseDetailResult,
  RetentionCaseEventRow,
  RetentionChannel,
  RetentionDissatisfactionReason,
  RetentionPhase1Outcome,
};

/** Agent board: open Phase 1 + recent Dissatisfied / Closed (no phase filter). */
export async function loadMyRetentionCases(): Promise<RetentionCasesListResult> {
  return callTouchpoint('retention.my_cases', { limit: 200 });
}

export async function loadRetentionCase(caseId: string): Promise<RetentionCaseDetailResult> {
  return callTouchpoint('retention.case_get', { caseId });
}

/** Lazy DWH phone — do not block case open on the warehouse. */
export async function loadRetentionCaseContact(
  caseId: string,
): Promise<string | null> {
  const res = await callTouchpoint('retention.case_contact', { caseId });
  return res.contactPhone ?? null;
}

export async function recordRetentionOutcome(
  caseId: string,
  outcome: RetentionPhase1Outcome,
  opts: {
    dissatisfactionReason?: RetentionDissatisfactionReason;
    reasonNote?: string;
  } = {},
): Promise<RetentionCaseRow> {
  const res = await callTouchpoint('retention.record_outcome', {
    caseId,
    outcome,
    ...(opts.dissatisfactionReason
      ? { dissatisfaction_reason: opts.dissatisfactionReason }
      : {}),
    ...(opts.reasonNote ? { reason_note: opts.reasonNote } : {}),
  });
  return res.case;
}

export async function logRetentionAttempt(
  caseId: string,
  channel: RetentionChannel,
  notes?: string,
  evidenceUrl?: string,
): Promise<RetentionCaseRow> {
  const res = await callTouchpoint('retention.log_attempt', {
    caseId,
    channel,
    ...(notes ? { notes } : {}),
    ...(evidenceUrl ? { evidence_url: evidenceUrl } : {}),
  });
  return res.case;
}

/** Compress an image file to a JPEG data URL for attempt evidence (max ~1280px). */
export async function fileToEvidenceDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Screenshot must be an image (PNG, JPG, WEBP)');
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new Error('Screenshot is too large (max 8MB before compress)');
  }
  const bitmap = await createImageBitmap(file);
  const maxEdge = 1280;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process screenshot');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
  if (dataUrl.length > 1_800_000) {
    throw new Error('Screenshot is still too large after compress — try a smaller crop');
  }
  return dataUrl;
}

export async function loadOpenPoolCases(): Promise<RetentionCasesListResult> {
  return callTouchpoint('retention.pool_list', { limit: 200 });
}

export async function claimOpenPoolCase(
  caseId: string,
  reason: string,
): Promise<{ case: RetentionCaseRow; pendingApproval: boolean }> {
  return callTouchpoint('retention.pool_claim', { caseId, reason });
}

export async function loadOpenPoolQuota(): Promise<{
  used: number;
  max: number;
  remaining: number;
}> {
  return callTouchpoint('retention.pool_quota', {});
}

export async function loadRetentionLookups(): Promise<RetentionLookupsResult> {
  return callTouchpoint('retention.lookups', {});
}

/**
 * Sales Phase 1 Kanban stages — mirrors `retention_statuses.board_column` (migration 0033):
 *   New → call → pick stage → Reached / OoR / Vacation / Dissatisfied → Closed
 */
export type RetentionKanbanCol =
  | 'new'
  | 'reached'
  | 'out_of_reach'
  | 'vacation'
  | 'dissatisfied'
  | 'closed';

export const KANBAN_COLS: Array<{
  id: RetentionKanbanCol;
  label: string;
  hint: string;
  /** CSS color token for column rail / accent. */
  color: string;
}> = [
  { id: 'new', label: 'New', hint: 'Call within 2 BD → Retention', color: 'var(--accent)' },
  { id: 'reached', label: 'Reached', hint: 'Fuel watch · 5 BD → Pool', color: 'var(--ok)' },
  { id: 'out_of_reach', label: 'Out of Reach', hint: '5×1 BD attempts → Pool', color: 'var(--warn)' },
  { id: 'vacation', label: 'Vacation', hint: '14-day countdown', color: 'var(--violet)' },
  { id: 'dissatisfied', label: 'Dissatisfied', hint: 'Escalated · Retention', color: 'var(--danger)' },
  { id: 'closed', label: 'Closed', hint: 'Returned · Pool / Retention handoff', color: 'var(--ok)' },
];

/** status_code → board_column (same seed as retention_statuses). */
const STATUS_BOARD: Record<string, RetentionKanbanCol> = {
  p1_new: 'new',
  p1_in_progress: 'new',
  p1_pool_assigned: 'new',
  p1_reached: 'reached',
  p1_out_of_reach: 'out_of_reach',
  p1_vacation: 'vacation',
  p1_vacation_followup: 'vacation',
  p1_awaiting_ops: 'vacation',
  p1_dissatisfied: 'dissatisfied',
  p1_no_action_2bd: 'closed',
  p1_open_pool: 'closed',
  p1_pool_claim_pending: 'closed',
  p1_returned: 'closed',
  p1_handoff_retention: 'closed',
  p3_hold: 'closed',
  p3_closed: 'closed',
};

export function kanbanColOf(c: RetentionCaseRow): RetentionKanbanCol {
  // Dissatisfied handoff lands in Phase 2 — keep it on the Dissatisfied column.
  if (c.agentOutcome === 'dissatisfied' || c.statusCode === 'p1_dissatisfied') {
    return 'dissatisfied';
  }
  const mapped = STATUS_BOARD[c.statusCode];
  if (mapped) return mapped;
  if (!c.isOpen || c.phaseCode !== 'phase_1_agent') return 'closed';
  return 'new';
}

export function statusLabel(code: string): string {
  const map: Record<string, string> = {
    p1_new: 'New',
    p1_in_progress: 'New',
    p1_out_of_reach: 'Out of Reach',
    p1_vacation: 'Vacation',
    p1_vacation_followup: 'Vacation follow-up',
    p1_awaiting_ops: 'Awaiting Ops',
    p1_reached: 'Reached · watching',
    p1_dissatisfied: 'Dissatisfied',
    p1_no_action_2bd: 'Closed · no action',
    p1_open_pool: 'Closed · Open Pool',
    p1_pool_claim_pending: 'Claim pending',
    p1_pool_assigned: 'New · from pool',
    p1_returned: 'Closed · returned',
    p1_handoff_retention: 'Closed · Retention',
    p2_new: 'In Retention',
    p3_hold: 'CITI hold',
  };
  return map[code] ?? code;
}

export function freqLabel(f: RetentionCaseRow['transactionFrequency']): string {
  if (f === 'high') return 'High';
  if (f === 'medium') return 'Medium';
  if (f === 'low') return 'Low';
  return '—';
}

/** Breach severity for sort: days past threshold (higher = more urgent). */
export function breachSeverity(c: RetentionCaseRow): number {
  const days = c.daysInactive ?? 0;
  const thr = c.thresholdDays ?? 7;
  return Math.max(0, days - thr);
}

/**
 * Cadence = how often this client usually fuels (from 90-day history → high/med/low
 * thresholds of 2 / 5 / 7 days). Breach = days since last fuel past that threshold.
 */
export function quietCaption(c: RetentionCaseRow): string {
  const days = c.daysInactive ?? 0;
  const thr = c.thresholdDays ?? 0;
  if (!thr) return `${days}d since last fuel`;
  return `${days}d since last fuel · expected every ${thr}d`;
}

export function cadenceExplain(f: RetentionCaseRow['transactionFrequency']): string {
  if (f === 'high') return 'Cadence: usually fuels every ~2 days';
  if (f === 'medium') return 'Cadence: usually fuels every ~5 days';
  if (f === 'low') return 'Cadence: usually fuels every ~7 days';
  return 'Cadence: usual fueling rhythm from the last 90 days';
}

export function isOverdue(c: RetentionCaseRow): boolean {
  if (!c.isOpen || !c.currentDeadlineAt) return false;
  return new Date(c.currentDeadlineAt).getTime() < Date.now();
}

export interface RetentionBoardStats {
  total: number;
  openActive: number;
  overdue: number;
  gallonsAtRisk: number;
  byCol: Record<RetentionKanbanCol, { count: number; gallons: number }>;
  highFreq: number;
  attemptsTotal: number;
}

export function retentionBoardStats(cases: RetentionCaseRow[]): RetentionBoardStats {
  const byCol = Object.fromEntries(
    KANBAN_COLS.map((c) => [c.id, { count: 0, gallons: 0 }]),
  ) as RetentionBoardStats['byCol'];
  let openActive = 0;
  let overdue = 0;
  let gallonsAtRisk = 0;
  let highFreq = 0;
  let attemptsTotal = 0;
  for (const row of cases) {
    const col = kanbanColOf(row);
    const g = row.gallons90d ?? 0;
    byCol[col].count += 1;
    byCol[col].gallons += g;
    attemptsTotal += row.outOfReachAttempts ?? 0;
    if (row.transactionFrequency === 'high') highFreq += 1;
    if (isOverdue(row)) overdue += 1;
    if (col !== 'closed' && col !== 'dissatisfied' && row.isOpen) {
      openActive += 1;
      gallonsAtRisk += g;
    }
  }
  return {
    total: cases.length,
    openActive,
    overdue,
    gallonsAtRisk,
    byCol,
    highFreq,
    attemptsTotal,
  };
}

/** Compact deadline line — stage-aware BD / calendar countdown. */
export function deadlineCaption(c: RetentionCaseRow): string {
  return stageTimerCaption(c);
}

/** Local timeline row so the modal paints results before a refetch. */
export function localRetentionEvent(
  caseId: string,
  partial: {
    fromStatus: string | null;
    toStatus: string;
    eventType: string;
    channel?: RetentionChannel | null;
    notes?: string | null;
    evidenceUrl?: string | null;
  },
): RetentionCaseEventRow {
  return {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    caseId,
    fromStatus: partial.fromStatus,
    toStatus: partial.toStatus,
    eventType: partial.eventType,
    actorZohoUserId: null,
    channel: partial.channel ?? null,
    notes: partial.notes ?? null,
    evidenceUrl: partial.evidenceUrl ?? null,
    occurredAt: new Date().toISOString(),
  };
}

export const CHANNEL_OPTIONS: Array<{ id: RetentionChannel; label: string }> = [
  { id: 'telegram', label: 'Telegram' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'sms', label: 'SMS' },
  { id: 'ringcentral', label: 'RingCentral' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'email', label: 'Email' },
];

export function channelLabel(channel: string | null | undefined): string {
  if (!channel) return 'Channel';
  return CHANNEL_OPTIONS.find((c) => c.id === channel)?.label ?? channel;
}

/** US display: +1 (773) 909-6150 — falls back to raw when not 10/11 digits. */
export function formatUsPhone(raw: string | null | undefined): string {
  if (!raw?.trim()) return '';
  const digits = raw.replace(/\D/g, '');
  const ten =
    digits.length === 11 && digits.startsWith('1')
      ? digits.slice(1)
      : digits.length === 10
        ? digits
        : null;
  if (!ten) return raw.trim();
  return `+1 (${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

/** Dissatisfaction reasons with short explanations for the status wizard. */
export const REASON_OPTIONS: Array<{
  id: RetentionDissatisfactionReason;
  label: string;
  hint: string;
}> = [
  {
    id: 'low_discounts',
    label: 'Low discounts',
    hint: 'Client believes competitors offer better per-gallon rates',
  },
  {
    id: 'payment_cycle',
    label: 'Payment cycle not suitable',
    hint: 'Dislikes 2-billing-per-week model or cash-flow timing',
  },
  {
    id: 'cs_service',
    label: 'Unhappy with CS / service',
    hint: 'Support quality, response time, or account handling',
  },
  {
    id: 'trust_issues',
    label: 'Trust issues',
    hint: 'Negative past experience — lost confidence',
  },
  {
    id: 'switched_other',
    label: 'Switched / other',
    hint: 'Moved to a competitor or other — brief note required',
  },
];

export function sortCasesPriority(cases: RetentionCaseRow[]): RetentionCaseRow[] {
  return cases.slice().sort((a, b) => {
    const sev = breachSeverity(b) - breachSeverity(a);
    if (sev !== 0) return sev;
    return (b.gallons90d ?? 0) - (a.gallons90d ?? 0);
  });
}
