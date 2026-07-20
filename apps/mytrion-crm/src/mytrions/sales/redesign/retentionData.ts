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

export type {
  RetentionCaseRow,
  RetentionCaseDetailResult,
  RetentionCaseEventRow,
  RetentionChannel,
  RetentionDissatisfactionReason,
  RetentionPhase1Outcome,
};

export async function loadMyRetentionCases(): Promise<RetentionCasesListResult> {
  return callTouchpoint('retention.my_cases', { phase_code: 'phase_1_agent', limit: 200 });
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
): Promise<RetentionCaseRow> {
  const res = await callTouchpoint('retention.log_attempt', {
    caseId,
    channel,
    ...(notes ? { notes } : {}),
  });
  return res.case;
}

export async function loadOpenPoolCases(): Promise<RetentionCasesListResult> {
  return callTouchpoint('retention.pool_list', { limit: 200 });
}

export async function claimOpenPoolCase(
  caseId: string,
): Promise<{ case: RetentionCaseRow; pendingApproval: boolean }> {
  return callTouchpoint('retention.pool_claim', { caseId });
}

export async function loadPendingPoolClaims(): Promise<RetentionCasesListResult> {
  return callTouchpoint('retention.pool_claims_pending', { limit: 100 });
}

export async function approvePoolClaim(caseId: string): Promise<RetentionCaseRow> {
  const res = await callTouchpoint('retention.pool_claim_approve', { caseId });
  return res.case;
}

export async function declinePoolClaim(caseId: string): Promise<RetentionCaseRow> {
  const res = await callTouchpoint('retention.pool_claim_decline', { caseId });
  return res.case;
}

export async function loadRetentionLookups(): Promise<RetentionLookupsResult> {
  return callTouchpoint('retention.lookups', {});
}

/** Kanban column id from status_code. */
export type RetentionKanbanCol =
  | 'new'
  | 'working'
  | 'out_of_reach'
  | 'vacation'
  | 'dissatisfied'
  | 'exited';

export const KANBAN_COLS: Array<{ id: RetentionKanbanCol; label: string }> = [
  { id: 'new', label: 'New' },
  { id: 'working', label: 'Working' },
  { id: 'out_of_reach', label: 'Out of Reach' },
  { id: 'vacation', label: 'Vacation' },
  { id: 'dissatisfied', label: 'Dissatisfied' },
  { id: 'exited', label: 'Exited' },
];

export function kanbanColOf(c: RetentionCaseRow): RetentionKanbanCol {
  if (
    !c.isOpen ||
    c.statusCode === 'p1_returned' ||
    c.statusCode === 'p1_open_pool' ||
    c.statusCode === 'p1_handoff_retention' ||
    c.phaseCode !== 'phase_1_agent'
  ) {
    return 'exited';
  }
  switch (c.statusCode) {
    case 'p1_new':
    case 'p1_pool_assigned':
      return 'new';
    case 'p1_in_progress':
    case 'p1_no_action_2bd':
    case 'p1_reached':
      return 'working';
    case 'p1_out_of_reach':
      return 'out_of_reach';
    case 'p1_vacation':
    case 'p1_vacation_followup':
    case 'p1_awaiting_ops':
      return 'vacation';
    case 'p1_dissatisfied':
      return 'dissatisfied';
    default:
      return 'working';
  }
}

export function statusLabel(code: string): string {
  const map: Record<string, string> = {
    p1_new: 'New',
    p1_in_progress: 'Working',
    p1_out_of_reach: 'Out of Reach',
    p1_vacation: 'Vacation',
    p1_vacation_followup: 'Vacation follow-up',
    p1_awaiting_ops: 'Awaiting Ops',
    p1_reached: 'Reached · watching',
    p1_dissatisfied: 'Dissatisfied',
    p1_no_action_2bd: 'No action (2BD)',
    p1_open_pool: 'Open Pool',
    p1_pool_claim_pending: 'Claim pending',
    p1_pool_assigned: 'Pool assigned',
    p1_returned: 'Returned',
    p1_handoff_retention: 'To Retention',
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

export function deadlineCaption(c: RetentionCaseRow): string {
  if (!c.currentDeadlineAt) return '—';
  const d = new Date(c.currentDeadlineAt);
  if (Number.isNaN(d.getTime())) return '—';
  const ms = d.getTime() - Date.now();
  const days = Math.ceil(ms / 86_400_000);
  const prefix =
    c.currentDeadlineType === '1BD_comms_attempt'
      ? '1 BD attempt · '
      : c.currentDeadlineType === '2BD_agent_action'
        ? '2 BD act · '
        : c.currentDeadlineType === '5BD_post_contact'
          ? '5 BD watch · '
          : c.currentDeadlineType === '1BD_claim_approve'
            ? '1 BD approve · '
          : c.currentDeadlineType === '3BD_pool_claim'
            ? '3 BD claim · '
            : c.currentDeadlineType === '3BD_new_owner'
              ? '3 BD owner · '
              : c.currentDeadlineType === '10BD_retention'
                ? '10 BD Retention · '
                : c.currentDeadlineType === '2BD_vacation_followup'
                  ? '2 BD follow-up · '
                  : c.currentDeadlineType === '14D_vacation'
                    ? 'Vacation · '
                    : c.currentDeadlineType === '7D_citi_hold'
                      ? 'CITI · '
                      : '';
  if (days < 0) return `${prefix}${Math.abs(days)}d overdue`;
  if (days === 0) return `${prefix}Due today`;
  return `${prefix}${days}d left`;
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
    occurredAt: new Date().toISOString(),
  };
}

export const CHANNEL_OPTIONS: Array<{ id: RetentionChannel; label: string }> = [
  { id: 'telegram', label: 'TG' },
  { id: 'whatsapp', label: 'WA' },
  { id: 'sms', label: 'SMS' },
  { id: 'ringcentral', label: 'RC' },
  { id: 'instagram', label: 'IG' },
  { id: 'facebook', label: 'FB' },
  { id: 'email', label: 'EM' },
];

export const REASON_OPTIONS: Array<{ id: RetentionDissatisfactionReason; label: string }> = [
  { id: 'low_discounts', label: 'Low discounts' },
  { id: 'payment_cycle', label: 'Payment cycle' },
  { id: 'cs_service', label: 'CS / service' },
  { id: 'trust_issues', label: 'Trust issues' },
  { id: 'switched_other', label: 'Switched / other' },
];

export function sortCasesPriority(cases: RetentionCaseRow[]): RetentionCaseRow[] {
  return cases.slice().sort((a, b) => {
    const sev = breachSeverity(b) - breachSeverity(a);
    if (sev !== 0) return sev;
    return (b.gallons90d ?? 0) - (a.gallons90d ?? 0);
  });
}
