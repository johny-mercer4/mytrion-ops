/** Shared helpers for Retention case modal mutations (optimistic + timeline events). */
import type { RetentionCaseEventRow } from '@/api/touchpointTypes';
import {
  formatUsPhone,
  localRetentionEvent,
  type RetentionCaseRow,
  type RetentionChannel,
  type RetentionDissatisfactionReason,
  type RetentionPhase1Outcome,
} from './retentionData';
import type { PendingCallLog } from './RetentionWizardSteps';

export function pendingRcNote(call: PendingCallLog | null): string | undefined {
  if (!call) return undefined;
  const bits = [
    formatUsPhone(call.peer) || call.peer || undefined,
    call.sessionId ? `RC session ${call.sessionId}` : undefined,
    call.result ? `result ${call.result}` : undefined,
    call.durationMs != null ? `${Math.round(call.durationMs / 1000)}s` : undefined,
  ].filter(Boolean);
  return bits.length ? bits.join(' · ') : undefined;
}

export function isNewStatus(code: string): boolean {
  return code === 'p1_new' || code === 'p1_in_progress' || code === 'p1_pool_assigned';
}

export function bumpAttempts(row: RetentionCaseRow, by = 1): RetentionCaseRow {
  return { ...row, outOfReachAttempts: Math.min(5, row.outOfReachAttempts + by) };
}

export function optimisticOutOfReach(
  row: RetentionCaseRow,
  withAttempt: boolean,
): RetentionCaseRow {
  return {
    ...row,
    statusCode: 'p1_out_of_reach',
    agentOutcome: 'out_of_reach',
    outOfReachAttempts: withAttempt
      ? Math.min(5, row.outOfReachAttempts + 1)
      : row.outOfReachAttempts,
  };
}

/** Instant board patch before `retention.record_outcome` returns. */
export function optimisticOutcome(
  row: RetentionCaseRow,
  outcome: RetentionPhase1Outcome,
  opts?: {
    withAttempt?: boolean;
    dissatisfactionReason?: RetentionDissatisfactionReason;
    reasonNote?: string;
  },
): RetentionCaseRow {
  const note = opts?.reasonNote?.trim() || null;
  switch (outcome) {
    case 'out_of_reach':
      return optimisticOutOfReach(row, !!opts?.withAttempt);
    case 'reached':
      return { ...row, statusCode: 'p1_reached', agentOutcome: 'reached', reasonNote: note ?? row.reasonNote };
    case 'vacation':
      return { ...row, statusCode: 'p1_vacation', agentOutcome: 'vacation', reasonNote: note };
    case 'dissatisfied':
      return {
        ...row,
        statusCode: 'p1_dissatisfied',
        agentOutcome: 'dissatisfied',
        dissatisfactionReason: opts?.dissatisfactionReason ?? row.dissatisfactionReason,
        reasonNote: note,
      };
    default:
      return row;
  }
}

export function attemptEvent(
  caseId: string,
  fromStatus: string,
  updated: RetentionCaseRow,
  channel: RetentionChannel,
  notes: string | undefined,
  evidenceUrl?: string | null,
): RetentionCaseEventRow {
  return localRetentionEvent(caseId, {
    fromStatus,
    toStatus: updated.statusCode,
    eventType: 'comms_attempt',
    channel,
    notes: notes ?? `${channel} · ${updated.outOfReachAttempts}/5`,
    evidenceUrl: evidenceUrl ?? null,
  });
}
