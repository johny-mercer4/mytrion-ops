import type {
  VerificationFirstRunStatus,
  VerificationFirstRunStep,
} from '../../db/schema/verification_cases.js';
import { FIRST_RUN_STAGE_IDS } from '../../integrations/creditPlatformInboxWrites.js';

export const FIRST_RUN_STEP_ORDER: readonly VerificationFirstRunStep[] = [
  'patch',
  ...FIRST_RUN_STAGE_IDS,
];

export interface FirstRunPersisted {
  status: VerificationFirstRunStatus;
  step: VerificationFirstRunStep | null;
  inboxId: number | null;
  error: string | null;
}

export type InboxProbe = 'applied' | 'error' | 'pending' | 'missing' | null;

export type FirstRunAction =
  | { type: 'noop'; reason: 'completed' | 'in_flight_pending' | 'error' }
  | { type: 'enqueue'; step: VerificationFirstRunStep }
  | { type: 'record_error'; error: string }
  | { type: 'complete' };

export function nextFirstRunStep(step: VerificationFirstRunStep): VerificationFirstRunStep | null {
  const index = FIRST_RUN_STEP_ORDER.indexOf(step);
  if (index < 0) return null;
  return FIRST_RUN_STEP_ORDER[index + 1] ?? null;
}

export function decideFirstRunAction(input: {
  state: FirstRunPersisted;
  inboxStatus: InboxProbe;
  inboxError?: string | null;
  retry?: boolean;
}): FirstRunAction {
  const { state, inboxStatus, retry } = input;
  if (state.status === 'completed') return { type: 'noop', reason: 'completed' };
  if (state.status === 'error' && !retry) return { type: 'noop', reason: 'error' };

  if (state.status === 'idle' || (state.status === 'error' && retry)) {
    return { type: 'enqueue', step: state.step ?? 'patch' };
  }

  if (state.status === 'in_flight') {
    if (inboxStatus === 'pending') return { type: 'noop', reason: 'in_flight_pending' };
    if (inboxStatus === 'error') {
      return { type: 'record_error', error: input.inboxError?.trim() || 'inbox row error' };
    }
    if (inboxStatus === 'applied') {
      const current = state.step ?? 'patch';
      const next = nextFirstRunStep(current);
      return next ? { type: 'enqueue', step: next } : { type: 'complete' };
    }
    return { type: 'enqueue', step: state.step ?? 'patch' };
  }

  return { type: 'enqueue', step: state.step ?? 'patch' };
}
