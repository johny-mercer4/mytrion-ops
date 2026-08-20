/**
 * Collection desk policy — the thresholds the worklist and the placement queue judge a case
 * against, and the pure classifier that turns a case plus its desk history into ONE reason it
 * needs attention today.
 *
 * ⚠ EVERY NUMBER IN `DESK_POLICY` IS A PLACEHOLDER THE BUSINESS HAS NOT CONFIRMED.
 * The only real threshold in this pipeline is `remaining >= 0.01`, the floor at which
 * `servercrm/jobs/collectionCaseFinder.js` opens a case — verified against the source on
 * 2026-08-20. (An earlier version of this comment claimed a $100 floor and that the finder
 * deletes cases below it. Both are false: the finder never deletes, it zeroes the money fields
 * and leaves the row.) The values below came out of the redesign as plausible defaults so the
 * screens had something to render; they are gathered in one object, named, and exported so
 * changing them is a one-line edit and a grep finds every consumer — not scattered as literals
 * through five components the way the mockups had them.
 *
 * Pure by design: no db import, no I/O. `tests/unit/collection-desk-policy.test.ts` exercises the
 * whole lane matrix without Postgres.
 */

export const DESK_POLICY = {
  /** A case is eligible for Array once it is this old AND this large. Both, not either. */
  agencyMinDaysPastDue: 180,
  agencyMinRemaining: 5_000,
  /** How close to the agency threshold a case has to be before the desk is warned. */
  agencyWarnWindowDays: 14,
  /** Days after a promise falls due before the desk treats it as broken. */
  promiseGraceDays: 5,
  /** No contact logged in this many days and the case surfaces as silent. */
  silentAfterDays: 30,
  /** An intake case nobody has contacted within this many days is overdue for a first call. */
  intakeUncontactedDays: 2,
  /** Aging-meter band edges, in days past due. Four bands, three edges. */
  agingBands: [30, 90, 180] as const,
} as const;

/**
 * Why a case is on Today. ONE per case — a case that is both silent and near the agency
 * threshold shows the more urgent of the two, because a row offering two reasons offers no
 * decision. Order of `WORKLIST_LANES` IS the precedence order.
 */
export const WORKLIST_LANES = [
  'plan_broken',
  'promise_due',
  'agency_threshold',
  'agency_returned',
  'payment_posted',
  'new_intake',
  'silent',
] as const;
export type WorklistLane = (typeof WORKLIST_LANES)[number];

export interface WorklistSignals {
  /** Days past due from the finder's own column. */
  daysPastDue: number;
  /** Remaining debt as a number. Parsed at the repo edge; numerics arrive as strings. */
  remaining: number;
  stage: string;
  /** Whole days since the newest logged contact; null when nothing has ever been logged. */
  daysSinceContact: number | null;
  /** Whole days since the case row was created. */
  daysSinceOpened: number;
  /** The open promise, if any. `daysLate` is negative while it is still in the future. */
  promise: { amount: number; daysLate: number } | null;
  /** The active plan, if any. */
  plan: { missed: number; paid: number; total: number } | null;
  /** Array closed the tradeline and sent it back. */
  agencyReturned: boolean;
  /** Remaining hit zero but the case is still open — somebody has to sign it off. */
  settled: boolean;
}

/**
 * Which lane a case belongs in, or null when it wants nothing today.
 *
 * Read top to bottom: the first matching clause wins, and that ordering is the whole policy.
 * A broken plan outranks a due promise because the plan already had its grace period.
 */
export function laneFor(s: WorklistSignals): WorklistLane | null {
  if (s.plan && s.plan.missed > 0) return 'plan_broken';
  if (s.promise && s.promise.daysLate >= 0) return 'promise_due';
  if (s.agencyReturned) return 'agency_returned';
  if (s.settled) return 'payment_posted';
  if (isAgencyDue(s) || isAgencyNear(s)) return 'agency_threshold';
  if (s.daysSinceContact === null && s.daysSinceOpened >= DESK_POLICY.intakeUncontactedDays) {
    return 'new_intake';
  }
  if (s.daysSinceContact !== null && s.daysSinceContact >= DESK_POLICY.silentAfterDays) {
    return 'silent';
  }
  return null;
}

/**
 * Stages where "send this to an agency" is not advice worth giving: it is already there, it is
 * past the agency and with lawyers or a court, or it is finished. Legal and court stages matter
 * here — a case in civil court that is 200 days past due would otherwise be nagged every morning
 * to do something it did six months ago.
 */
const AGENCY_ADVICE_POINTLESS = new Set([
  'with_agency',
  'skip_tracing',
  'legal_action',
  'small_claims',
  'civil_court',
  'closed_successfully',
  'case_lost',
]);

/** Past both agency gates right now. */
export function isAgencyDue(s: Pick<WorklistSignals, 'daysPastDue' | 'remaining' | 'stage'>): boolean {
  if (AGENCY_ADVICE_POINTLESS.has(s.stage)) return false;
  return s.daysPastDue >= DESK_POLICY.agencyMinDaysPastDue && s.remaining >= DESK_POLICY.agencyMinRemaining;
}

/** Big enough already, and inside the warning window before the day threshold. */
function isAgencyNear(s: Pick<WorklistSignals, 'daysPastDue' | 'remaining' | 'stage'>): boolean {
  if (AGENCY_ADVICE_POINTLESS.has(s.stage)) return false;
  if (s.remaining < DESK_POLICY.agencyMinRemaining) return false;
  const toGo = DESK_POLICY.agencyMinDaysPastDue - s.daysPastDue;
  return toGo > 0 && toGo <= DESK_POLICY.agencyWarnWindowDays;
}

/**
 * Risk score, used only to ORDER the worklist. Money at stake, weighted by how far past due it
 * is and by the lane's own urgency, so a $32k plan break outranks a $900 silent case without
 * anyone maintaining a hand-sorted list.
 */
export function riskScore(lane: WorklistLane, s: WorklistSignals): number {
  const lanes: Record<WorklistLane, number> = {
    plan_broken: 1.6,
    promise_due: 1.5,
    agency_returned: 1.4,
    agency_threshold: 1.3,
    new_intake: 1.1,
    silent: 1.0,
    payment_posted: 0.9,
  };
  const age = 1 + Math.min(s.daysPastDue, 730) / 365;
  return Math.round(Math.max(s.remaining, 1) * age * lanes[lane]);
}

/** 0–3: which aging band a day count falls in. Feeds the four-segment meter. */
export function agingBand(daysPastDue: number): 0 | 1 | 2 | 3 {
  const [b1, b2, b3] = DESK_POLICY.agingBands;
  if (daysPastDue >= b3) return 3;
  if (daysPastDue >= b2) return 2;
  if (daysPastDue >= b1) return 1;
  return 0;
}

/** Whole days between two instants, floored. Negative when `then` is in the future. */
export function daysBetween(then: Date, now: Date): number {
  return Math.floor((now.getTime() - then.getTime()) / 86_400_000);
}
