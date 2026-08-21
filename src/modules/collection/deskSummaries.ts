/**
 * The one-line heading on a timeline entry.
 *
 * Written server-side, unlike the worklist's copy, and the difference is deliberate: a timeline
 * entry is a RECORD of what happened, stored once and read for years. If the wording lived in the
 * client, changing a label would silently rewrite history for every entry ever written. The
 * worklist's sentences describe live state and are recomputed on every read, so they belong with
 * the rest of the workspace's copy.
 */
import type {
  CollectionClosedReason,
  CollectionStage,
} from '../../db/schema/collection.js';
import type {
  CollectionContactChannel,
  CollectionContactOutcome,
  CollectionPlanFrequency,
} from '../../db/schema/collection_desk.js';

export const CHANNEL_LABEL: Record<CollectionContactChannel, string> = {
  call: 'Call',
  email: 'Email',
  sms: 'SMS',
  letter: 'Letter',
};

export const OUTCOME_LABEL: Record<CollectionContactOutcome, string> = {
  reached: 'reached the debtor',
  no_answer: 'no answer',
  voicemail: 'voicemail',
  wrong_number: 'wrong number',
  refused: 'refused to pay',
};

const STAGE_LABEL: Record<CollectionStage, string> = {
  intake: 'Intake',
  nc_attempt_1: 'No contact — attempt 1',
  nc_attempt_2: 'No contact — attempt 2',
  nc_attempt_3: 'No contact — attempt 3',
  usps_letter: 'USPS letter',
  connected: 'Connected',
  payment_plan: 'Payment plan',
  reconnect_attempt: 'Reconnect attempt',
  failed_promise: 'Failed promise',
  with_agency: 'With agency',
  skip_tracing: 'Skip tracing',
  legal_action: 'Legal action',
  small_claims: 'Small claims',
  civil_court: 'Civil court',
  closed_successfully: 'Recovered',
  case_lost: 'Case lost',
};

const CLOSED_REASON_LABEL: Record<CollectionClosedReason, string> = {
  paid_in_full: 'Paid in full',
  below_threshold: 'Below threshold',
  left_cmp: 'Left CMP',
  manual: 'Closed manually',
  case_lost: 'Case lost',
};

const FREQUENCY_LABEL: Record<CollectionPlanFrequency, string> = {
  weekly: 'weekly',
  fortnightly: 'fortnightly',
  monthly: 'monthly',
};

export function contactSummary(
  channel: CollectionContactChannel,
  outcome: CollectionContactOutcome,
): string {
  return `${CHANNEL_LABEL[channel]} — ${OUTCOME_LABEL[outcome]}`;
}

export function stageSummary(from: CollectionStage, to: CollectionStage): string {
  return `Stage ${STAGE_LABEL[from]} → ${STAGE_LABEL[to]}`;
}

export function planSummary(
  amount: string,
  count: number,
  frequency: CollectionPlanFrequency,
): string {
  return `Payment plan — $${amount} ${FREQUENCY_LABEL[frequency]} × ${count}`;
}

export function closeSummary(reason: CollectionClosedReason): string {
  return `Case closed — ${CLOSED_REASON_LABEL[reason]}`;
}
