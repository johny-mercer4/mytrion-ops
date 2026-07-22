/**
 * Stage countdown helpers for the Sales Retention board.
 * Source of truth: currentDeadlineAt / currentDeadlineType (+ vacationCountdownEnd).
 * BD types count remaining Mon–Fri (UTC), matching server addBusinessDays.
 */
import type { RetentionCaseRow } from '@/api/touchpointTypes';

export type StageTimerTone = 'ok' | 'warn' | 'danger' | 'muted';

export interface StageTimer {
  /** What happens when the clock hits zero. */
  event: string;
  /** Short remaining label, e.g. "1 BD left" / "3d left" / "Due today". */
  remain: string;
  /** 0–1 progress toward the deadline (estimated from SLA span). */
  progress: number;
  tone: StageTimerTone;
  overdue: boolean;
  /** Out of Reach attempt progress, when relevant. */
  attempts?: { used: number; max: number };
}

const DAY_MS = 86_400_000;

function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Remaining business days until `until` (inclusive end day). Negative = past. */
export function businessDaysRemaining(until: Date, from: Date = new Date()): number {
  const start = utcDay(from);
  const end = utcDay(until);
  if (end.getTime() < start.getTime()) {
    let n = 0;
    const cur = new Date(end.getTime());
    while (cur < start) {
      cur.setUTCDate(cur.getUTCDate() + 1);
      const dow = cur.getUTCDay();
      if (dow !== 0 && dow !== 6) n += 1;
    }
    return -n;
  }
  if (end.getTime() === start.getTime()) return 0;
  let n = 0;
  const cur = new Date(start.getTime());
  while (cur < end) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    const dow = cur.getUTCDay();
    if (dow !== 0 && dow !== 6) n += 1;
  }
  return n;
}

function calendarDaysRemaining(until: Date, from: Date = new Date()): number {
  return Math.ceil((until.getTime() - from.getTime()) / DAY_MS);
}

function isBdType(type: string): boolean {
  return /^\d+BD_/.test(type);
}

function isCalendarType(type: string | null | undefined): boolean {
  // 14D_vacation / 7D_citi_hold — not *BD_* (which also contains "D_").
  return Boolean(type && /^\d+D_/.test(type));
}

function slaSpanDays(type: string | null | undefined): number {
  switch (type) {
    case '2BD_agent_action':
      return 2;
    case '1BD_comms_attempt':
    case '1BD_claim_approve':
      return 1;
    case '5BD_comms_attempt':
    case '5BD_post_contact':
      return 5;
    case '3BD_pool_claim':
    case '3BD_new_owner':
      return 3;
    case '2BD_vacation_followup':
      return 2;
    case '10BD_retention':
      return 10;
    case '14D_vacation':
      return 14;
    case '7D_citi_hold':
      return 7;
    default: {
      const m = type?.match(/^(\d+)(BD|D)_/);
      return m ? Number(m[1]) : 2;
    }
  }
}

function remainLabel(
  type: string | null | undefined,
  until: Date,
  now: Date,
): { remain: string; overdue: boolean; remainUnits: number; calendar: boolean } {
  const useBd = Boolean(type && isBdType(type) && !isCalendarType(type));
  if (useBd) {
    const bd = businessDaysRemaining(until, now);
    if (bd < 0) return { remain: `${Math.abs(bd)} BD overdue`, overdue: true, remainUnits: bd, calendar: false };
    if (bd === 0) return { remain: 'Due today', overdue: false, remainUnits: 0, calendar: false };
    return { remain: `${bd} BD left`, overdue: false, remainUnits: bd, calendar: false };
  }
  const days = calendarDaysRemaining(until, now);
  if (days < 0) {
    return { remain: `${Math.abs(days)}d overdue`, overdue: true, remainUnits: days, calendar: true };
  }
  if (days === 0) {
    const hrs = Math.max(0, Math.ceil((until.getTime() - now.getTime()) / 3_600_000));
    if (hrs <= 0) return { remain: 'Due now', overdue: true, remainUnits: 0, calendar: true };
    return { remain: `${hrs}h left`, overdue: false, remainUnits: 0, calendar: true };
  }
  return { remain: `${days}d left`, overdue: false, remainUnits: days, calendar: true };
}

function progressOf(
  type: string | null | undefined,
  until: Date,
  now: Date,
  remainUnits: number,
  overdue: boolean,
): number {
  if (overdue) return 1;
  const span = slaSpanDays(type);
  if (span <= 0) return 0;
  const used = Math.max(0, span - Math.max(0, remainUnits));
  // Prefer ms fraction when we have calendar span for smoother vacation bars.
  if (type === '14D_vacation' || type === '7D_citi_hold') {
    const start = until.getTime() - span * DAY_MS;
    const frac = (now.getTime() - start) / (span * DAY_MS);
    return Math.min(1, Math.max(0, frac));
  }
  return Math.min(1, Math.max(0, used / span));
}

function toneOf(overdue: boolean, progress: number): StageTimerTone {
  if (overdue) return 'danger';
  if (progress >= 0.75) return 'warn';
  return 'ok';
}

/** Open Pool / Retention / CITI — former owner sees a locked card, cannot act. */
export function isSalesLocked(c: RetentionCaseRow): boolean {
  return (
    c.agentOutcome === 'dissatisfied' ||
    c.statusCode === 'p1_dissatisfied' ||
    c.statusCode === 'p1_open_pool' ||
    c.statusCode === 'p1_pool_claim_pending' ||
    c.phaseCode === 'phase_2_retention' ||
    c.phaseCode === 'phase_3_citi'
  );
}

/** Former-owner Open Pool card (warn styling vs Retention danger). */
export function isSalesPooled(c: RetentionCaseRow): boolean {
  return c.statusCode === 'p1_open_pool' || c.statusCode === 'p1_pool_claim_pending';
}

/**
 * Live stage timer for the next deadline event. Returns null when no clock applies
 * (closed/returned, Dissatisfied handoff, awaiting Ops with cleared deadline, etc.).
 */
export function stageTimer(c: RetentionCaseRow, now: Date = new Date()): StageTimer | null {
  // Terminal / closed — never show an active SLA (stale 2BD_agent_action used to leak
  // "Due today · → Retention" on Returned cards after fuel auto-close).
  if (!c.isOpen || c.statusCode === 'p1_returned') return null;
  if (isSalesLocked(c)) return null;

  // Awaiting Ops — human gate, no countdown.
  if (c.statusCode === 'p1_awaiting_ops') {
    return {
      event: 'Awaiting Ops confirm',
      remain: 'No auto timer',
      progress: 0,
      tone: 'muted',
      overdue: false,
    };
  }

  if (!c.currentDeadlineAt && !c.vacationCountdownEnd) return null;

  const untilRaw =
    c.currentDeadlineType === '14D_vacation' && c.vacationCountdownEnd
      ? c.vacationCountdownEnd
      : c.currentDeadlineAt;
  if (!untilRaw) return null;
  const until = new Date(untilRaw);
  if (Number.isNaN(until.getTime())) return null;

  const type = c.currentDeadlineType;
  const status = c.statusCode;
  const { remain, overdue, remainUnits } = remainLabel(type, until, now);
  const progress = progressOf(type, until, now, remainUnits, overdue);

  let event = 'Next deadline';
  let attempts: StageTimer['attempts'];

  if (
    type === '2BD_agent_action' ||
    status === 'p1_new' ||
    status === 'p1_in_progress' ||
    status === 'p1_pool_assigned'
  ) {
    event = 'Call or move · else → Retention';
  } else if (
    type === '1BD_comms_attempt' ||
    type === '5BD_comms_attempt' ||
    status === 'p1_out_of_reach'
  ) {
    const used = c.outOfReachAttempts ?? 0;
    attempts = { used, max: 5 };
    event =
      used >= 5
        ? '5th attempt done · → Open Pool'
        : `Attempt ${used + 1}/5 · else → Pool at 5`;
  } else if (type === '5BD_post_contact' || status === 'p1_reached') {
    event = 'Watch for fuel · else → Open Pool';
  } else if (type === '14D_vacation' || status === 'p1_vacation') {
    event = 'Vacation ends · then follow-up';
  } else if (type === '2BD_vacation_followup' || status === 'p1_vacation_followup') {
    event = 'Vacation follow-up call';
  } else if (type === '1BD_claim_approve') {
    event = 'Claim approval · else auto-approve';
  } else if (type === '3BD_pool_claim') {
    event = 'Open Pool claim window';
  } else if (type === '3BD_new_owner') {
    event = 'New owner fuel watch · else → Pool';
  } else if (type === '10BD_retention') {
    event = 'Retention watch';
  }

  return {
    event,
    remain,
    progress,
    tone: toneOf(overdue, progress),
    overdue,
    ...(attempts ? { attempts } : {}),
  };
}

/** Compact caption used in list / meta (keeps prior callers working). */
export function stageTimerCaption(c: RetentionCaseRow, now: Date = new Date()): string {
  if (isSalesLocked(c)) return '→ Retention';
  const t = stageTimer(c, now);
  if (!t) return '—';
  if (t.tone === 'muted') return t.remain;
  return `${t.remain} · ${t.event}`;
}
