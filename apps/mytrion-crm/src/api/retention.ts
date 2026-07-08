/**
 * Retention cases (/v1/retention) — the single retention_cases entity behind the
 * Retention Mytrion. Cases are AUTO-GENERATED nightly from the DWH frequency-breach
 * scan (and on demand via runRetentionSync); this client covers CRUD + the sync trigger.
 * Phase ladder: sales → retention → open_pool → citi (final).
 */
import { request } from './transport';

export type RetentionPhase = 'sales' | 'retention' | 'open_pool' | 'citi';
export type RetentionStage =
  | 'inactive_no_reason'
  | 'inactive_reason_noted'
  | 'out_of_reach'
  | 'pending'
  | 'assigned_to_agent';
export type RetentionOutcome =
  | 'returned'
  | 'saved'
  | 'refused_offer'
  | 'out_of_business'
  | 'no_response'
  | 'lost';
export type FrequencyClass = 'high' | 'medium' | 'low';
export type PoolAssignment = 'available' | 'requested' | 'assigned' | 'rejected';

export interface RetentionCase {
  id: string;
  carrierId: string;
  companyName: string | null;
  applicationId: string | null;
  agentName: string | null;
  agentZohoUserId: string | null;
  phase: RetentionPhase;
  phaseChangedAt: string;
  stage: RetentionStage;
  status: 'open' | 'closed';
  outcome: RetentionOutcome | null;
  closedAt: string | null;
  inactivityReason: string | null;
  reasonNote: string | null;
  outOfReachAttempts: number;
  frequencyClass: FrequencyClass | null;
  thresholdDays: number | null;
  lastTransactionAt: string | null;
  daysInactive: number | null;
  txCount90d: number | null;
  gallons90d: number | null;
  activeCards: number | null;
  poolAssignment: PoolAssignment | null;
  poolTakenBy: string | null;
  source: 'auto' | 'manual';
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RetentionSyncSummary {
  scanned: number;
  breached: number;
  created: number;
  refreshed: number;
  closedReturned: number;
}

export async function listRetentionCases(
  opts: {
    limit?: number;
    offset?: number;
    phase?: RetentionPhase;
    status?: 'open' | 'closed';
    stage?: RetentionStage;
    carrierId?: string;
  } = {},
): Promise<{ cases: RetentionCase[]; total: number }> {
  return (await request('GET', '/retention/cases', {
    query: {
      limit: opts.limit ?? 100,
      offset: opts.offset ?? 0,
      phase: opts.phase,
      status: opts.status,
      stage: opts.stage,
      carrier_id: opts.carrierId,
    },
  })) as { cases: RetentionCase[]; total: number };
}

export async function getRetentionCase(id: string): Promise<{ case: RetentionCase }> {
  return (await request('GET', `/retention/cases/${encodeURIComponent(id)}`)) as {
    case: RetentionCase;
  };
}

export async function createRetentionCase(input: {
  carrierId: string;
  companyName?: string;
  applicationId?: string;
  agentName?: string;
  agentZohoUserId?: string;
  phase?: RetentionPhase;
  stage?: RetentionStage;
  inactivityReason?: string;
  reasonNote?: string;
}): Promise<{ case: RetentionCase }> {
  return (await request('POST', '/retention/cases', {
    body: {
      carrier_id: input.carrierId,
      ...(input.companyName ? { company_name: input.companyName } : {}),
      ...(input.applicationId ? { application_id: input.applicationId } : {}),
      ...(input.agentName ? { agent_name: input.agentName } : {}),
      ...(input.agentZohoUserId ? { agent_zoho_user_id: input.agentZohoUserId } : {}),
      ...(input.phase ? { phase: input.phase } : {}),
      ...(input.stage ? { stage: input.stage } : {}),
      ...(input.inactivityReason ? { inactivity_reason: input.inactivityReason } : {}),
      ...(input.reasonNote ? { reason_note: input.reasonNote } : {}),
    },
  })) as { case: RetentionCase };
}

export async function updateRetentionCase(
  id: string,
  patch: {
    phase?: RetentionPhase;
    stage?: RetentionStage;
    status?: 'open' | 'closed';
    outcome?: RetentionOutcome | null;
    inactivityReason?: string | null;
    reasonNote?: string | null;
    outOfReachAttempts?: number;
    poolAssignment?: PoolAssignment | null;
    poolTakenBy?: string | null;
    agentName?: string | null;
    agentZohoUserId?: string | null;
  },
): Promise<{ case: RetentionCase }> {
  return (await request('POST', `/retention/cases/${encodeURIComponent(id)}`, {
    body: {
      ...(patch.phase !== undefined ? { phase: patch.phase } : {}),
      ...(patch.stage !== undefined ? { stage: patch.stage } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.outcome !== undefined ? { outcome: patch.outcome } : {}),
      ...(patch.inactivityReason !== undefined
        ? { inactivity_reason: patch.inactivityReason }
        : {}),
      ...(patch.reasonNote !== undefined ? { reason_note: patch.reasonNote } : {}),
      ...(patch.outOfReachAttempts !== undefined
        ? { out_of_reach_attempts: patch.outOfReachAttempts }
        : {}),
      ...(patch.poolAssignment !== undefined ? { pool_assignment: patch.poolAssignment } : {}),
      ...(patch.poolTakenBy !== undefined ? { pool_taken_by: patch.poolTakenBy } : {}),
      ...(patch.agentName !== undefined ? { agent_name: patch.agentName } : {}),
      ...(patch.agentZohoUserId !== undefined
        ? { agent_zoho_user_id: patch.agentZohoUserId }
        : {}),
    },
  })) as { case: RetentionCase };
}

export async function deleteRetentionCase(id: string): Promise<void> {
  await request('POST', `/retention/cases/${encodeURIComponent(id)}/delete`, { body: {} });
}

/** Run auto-generation now (admin) — same sync the nightly cron runs. */
export async function runRetentionSync(
  opts: { lookbackDays?: number; limit?: number } = {},
): Promise<{ summary: RetentionSyncSummary }> {
  return (await request('POST', '/retention/sync', {
    body: {
      ...(opts.lookbackDays !== undefined ? { lookback_days: opts.lookbackDays } : {}),
      ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
    },
  })) as { summary: RetentionSyncSummary };
}
