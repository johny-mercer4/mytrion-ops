import type { VerificationStageStatus } from '../../db/schema/verification_cases.js';

/** Decision Desk order — not the BPMN/custom adapter order (antifraud/crosscheck are swapped). */
export const DECISION_DESK_STAGES = [
  { id: 'stop_factor_pre', label: 'Pre stop factors', order: 1 },
  { id: 'blacklist', label: 'Blacklist', order: 2 },
  { id: 'fmcsa', label: 'FMCSA', order: 3 },
  { id: 'plaid_bs', label: 'Plaid / bank statement', order: 4 },
  { id: 'highway', label: 'Highway', order: 5 },
  { id: 'creditsafe', label: 'CreditSafe', order: 6 },
  { id: 'isoftpull', label: 'iSoftPull', order: 7 },
  { id: 'antifraud', label: 'Antifraud', order: 8 },
  { id: 'crosscheck', label: 'Cross-check', order: 9 },
  { id: 'stop_factor_after', label: 'Post stop factors', order: 10 },
] as const;

export type DecisionDeskStageId = (typeof DECISION_DESK_STAGES)[number]['id'];

export const DECISION_DESK_STAGE_IDS: readonly DecisionDeskStageId[] = DECISION_DESK_STAGES.map(
  (s) => s.id,
);

const FLOW_ALIASES: Record<string, DecisionDeskStageId> = {
  stop_factor_pre: 'stop_factor_pre',
  'stop-factor-pre': 'stop_factor_pre',
  blacklist: 'blacklist',
  fmcsa: 'fmcsa',
  plaid_bs: 'plaid_bs',
  plaid: 'plaid_bs',
  highway: 'highway',
  creditsafe: 'creditsafe',
  isoftpull: 'isoftpull',
  antifraud: 'antifraud',
  crosscheck: 'crosscheck',
  stop_factor_after: 'stop_factor_after',
  'stop-factor-after': 'stop_factor_after',
};

export function normalizeDeskStageId(raw: string | null | undefined): DecisionDeskStageId | null {
  if (!raw) return null;
  return FLOW_ALIASES[raw.trim()] ?? null;
}

export function normalizeDeskStageStatus(raw: string | null | undefined): VerificationStageStatus {
  const s = (raw ?? '').trim().toLowerCase();
  if (s === 'ready') return 'ready';
  if (s === 'running') return 'running';
  if (s === 'ran') return 'ran';
  if (s === 'approved' || s === 'done' || s === 'ok' || s === 'completed' || s === 'pass') {
    return 'approved';
  }
  if (s === 'skipped') return 'skipped';
  if (s === 'failed' || s === 'error' || s === 'unavailable') return 'failed';
  return 'pending';
}
