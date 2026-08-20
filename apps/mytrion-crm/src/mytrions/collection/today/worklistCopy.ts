/**
 * The worklist's vocabulary — lane names, tones, and the ONE sentence each row states.
 *
 * The sentence is composed HERE and not on the server, unlike a timeline entry's summary. The
 * difference is what each describes: a timeline entry is a record written once and read for
 * years, so its wording is stored; a worklist row describes live state and is recomputed on
 * every read, so its wording belongs with the rest of the workspace's copy and can be reworded
 * without a migration.
 *
 * Pure — no React, no fetch. `worklistCopy.test.ts` covers every lane.
 */
import type { BadgeIntent, IconName } from '@/ds';
import type { DeskPolicy, WorklistItem, WorklistLane } from '@/api/collectionDesk';
import { money } from '../collectionFormat';

export interface LaneMeta {
  id: WorklistLane;
  label: string;
  /** Wayfinding hue for the row's left rail, from the shared --tone-* scale. */
  tone: string;
  intent: BadgeIntent;
}

/** Order here is the order of the lane tabs. It mirrors the server's precedence chain. */
export const LANES: readonly LaneMeta[] = [
  { id: 'plan_broken', label: 'Plan broken', tone: 'var(--tone-rose)', intent: 'danger' },
  { id: 'promise_due', label: 'Promise due', tone: 'var(--tone-sky)', intent: 'info' },
  { id: 'agency_returned', label: 'Returned by Array', tone: 'var(--tone-violet)', intent: 'danger' },
  { id: 'agency_threshold', label: 'Agency threshold', tone: 'var(--tone-orange)', intent: 'warning' },
  { id: 'payment_posted', label: 'Payment posted', tone: 'var(--tone-emerald)', intent: 'success' },
  { id: 'new_intake', label: 'New intake', tone: 'var(--tone-amber)', intent: 'neutral' },
  { id: 'silent', label: 'Silent', tone: 'var(--tone-slate)', intent: 'neutral' },
];

const LANE_BY_ID = new Map(LANES.map((l) => [l.id, l]));

export function laneMeta(lane: WorklistLane): LaneMeta {
  return LANE_BY_ID.get(lane) ?? LANES[LANES.length - 1]!;
}

/** The one action offered on the row. A row needing two actions is two rows. */
export interface LaneAction {
  label: string;
  icon: IconName;
}

const ACTIONS: Record<WorklistLane, LaneAction> = {
  plan_broken: { label: 'Call', icon: 'call' },
  promise_due: { label: 'Call', icon: 'call' },
  agency_returned: { label: 'Review', icon: 'arrow_forward' },
  agency_threshold: { label: 'File', icon: 'send' },
  payment_posted: { label: 'Close', icon: 'check_circle' },
  new_intake: { label: 'Open', icon: 'arrow_forward' },
  silent: { label: 'Call', icon: 'call' },
};

export function laneAction(lane: WorklistLane): LaneAction {
  return ACTIONS[lane];
}

const OUTCOME_WORD: Record<string, string> = {
  reached: 'reached the debtor',
  no_answer: 'no answer',
  voicemail: 'voicemail',
  wrong_number: 'wrong number',
  refused: 'refused to pay',
};

const plural = (n: number, one: string, many = `${one}s`): string => (n === 1 ? one : many);

function usd(n: number): string {
  return `$${n.toLocaleString('en-US')}`;
}

/**
 * Why this row is here, in one sentence, ending in what happens if nobody acts.
 *
 * Never more than one sentence of consequence: a row that explains itself at length is a row
 * nobody reads at eight in the morning with forty of them on screen.
 */
export function laneSentence(item: WorklistItem, policy: DeskPolicy): string {
  switch (item.lane) {
    case 'plan_broken': {
      const missed = item.plan?.missed ?? 1;
      const total = item.plan?.total ?? 0;
      return `${missed} ${plural(missed, 'instalment')} missed on a ${total}-instalment plan. Reach them before the plan is written off.`;
    }
    case 'promise_due': {
      const amount = money(item.promise?.amount);
      const late = item.promise?.daysLate ?? 0;
      if (late > 0) {
        return `Promised ${amount} and it is ${late} ${plural(late, 'day')} late — nothing has posted.`;
      }
      return `Promised ${amount} today. Confirm before close of business.`;
    }
    case 'agency_returned':
      return 'Array closed the tradeline and handed it back. Skip tracing, small claims, or write off.';
    case 'agency_threshold': {
      const floor = usd(policy.agencyMinRemaining);
      if (item.daysToAgency <= 0) {
        return `Past ${policy.agencyMinDaysPastDue} days and above the ${floor} floor. File with Array, or record why not.`;
      }
      return `Crosses ${policy.agencyMinDaysPastDue} days in ${item.daysToAgency} ${plural(item.daysToAgency, 'day')} and sits above the ${floor} floor.`;
    }
    case 'payment_posted':
      return 'The balance has reached zero. Confirm the posting and close the case, or reopen the plan.';
    case 'new_intake': {
      const invoices = item.case.issueInvoiceCount;
      return `Handed off from Billing and never contacted. ${invoices} unpaid ${plural(invoices, 'invoice')}, oldest ${item.case.daysPastDue} days.`;
    }
    case 'silent': {
      const days = item.daysSinceContact ?? 0;
      const outcome = item.lastContact?.outcome;
      const tail = outcome ? ` Last attempt: ${OUTCOME_WORD[outcome] ?? outcome}.` : '';
      return `No contact in ${days} ${plural(days, 'day')}.${tail}`;
    }
    default:
      return '';
  }
}

/** Company name for a case, falling back the same way the rest of the module does. */
export function itemName(item: WorklistItem): string {
  return (
    item.case.debtorCompanyName?.trim() ||
    item.case.displayName?.trim() ||
    item.case.debtorFullName?.trim() ||
    `Carrier ${item.case.carrierId}`
  );
}
