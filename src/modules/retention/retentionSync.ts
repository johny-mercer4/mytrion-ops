/**
 * Retention case auto-generation — the sync run that replaces the manual daily
 * "source file refresh + sort the Retention List" (SOP steps 1–4):
 *
 *   1. Scan the DWH for frequency-breach candidates (active, Card-Swiped, non-debtor,
 *      not Closed Lost / OoB — see dwhRetention exclusions — whose days-inactive exceed
 *      their high/medium/low cadence threshold).
 *   2. Breached carrier WITHOUT an open case → create one (phase_1_agent / p1_in_progress).
 *   3. Breached carrier WITH an open case → refresh its DWH metrics in place.
 *   4. Open case whose carrier has ANY transaction after the case opened → close as
 *      p1_returned. phase_3_citi is final — never auto-closed.
 */
import {
  RETENTION_PHASE,
  RETENTION_STATUS,
  type RetentionCase,
} from '../../db/schema/index.js';
import {
  daysSince,
  fetchCarrierLastTransactions,
  scanRetentionCandidates,
  type RetentionCandidate,
} from '../../integrations/dwhRetention.js';
import { logger } from '../../lib/logger.js';
import { retentionCaseRepo, type RetentionMetricsInput } from '../../repos/retentionCaseRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { notifyCaseCreated } from './notify.js';

export interface RetentionSyncOptions {
  lookbackDays?: number | undefined;
  limit?: number | undefined;
  now?: Date | undefined;
}

export interface RetentionSyncSummary {
  scanned: number;
  breached: number;
  created: number;
  refreshed: number;
  closedReturned: number;
}

function candidateMetrics(c: RetentionCandidate): RetentionMetricsInput {
  return {
    transactionFrequency: c.frequencyClass,
    thresholdDays: c.thresholdDays,
    lastTransactionAt: c.lastTransactionAt,
    daysInactive: c.daysInactive,
    txCount90d: c.txCount90d,
    gallons90d: c.gallons90d,
    activeCards: c.activeCards,
  };
}

/** Any fuel after case creation closes the episode (board constant). */
function hasReturned(row: RetentionCase, lastTx: Date | undefined, _now: Date): boolean {
  if (!lastTx) return false;
  return lastTx.getTime() > row.createdAt.getTime();
}

export async function syncRetentionCases(
  ctx: TenantContext,
  opts: RetentionSyncOptions = {},
): Promise<RetentionSyncSummary> {
  const now = opts.now ?? new Date();
  const candidates = await scanRetentionCandidates({
    ...(opts.lookbackDays !== undefined ? { lookbackDays: opts.lookbackDays } : {}),
    ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
    now,
  });
  const breached = candidates.filter((c) => c.breached);
  const openRows = await retentionCaseRepo.listOpen(ctx);
  const openByCarrier = new Map(openRows.map((row) => [row.carrierId, row]));

  const summary: RetentionSyncSummary = {
    scanned: candidates.length,
    breached: breached.length,
    created: 0,
    refreshed: 0,
    closedReturned: 0,
  };

  const breachedIds = new Set<string>();
  for (const candidate of breached) {
    breachedIds.add(candidate.carrierId);
    const existing = openByCarrier.get(candidate.carrierId);
    if (existing) {
      await retentionCaseRepo.update(ctx, String(existing.id), {
        metrics: candidateMetrics(candidate),
        lastSyncedAt: now,
      });
      summary.refreshed += 1;
    } else {
      const created = await retentionCaseRepo.create(ctx, {
        carrierId: candidate.carrierId,
        companyName: candidate.companyName ?? undefined,
        applicationId: candidate.applicationId ?? undefined,
        agentName: candidate.agentName ?? undefined,
        assignedAgentZohoUserId: candidate.agentZohoUserId ?? undefined,
        phaseCode: RETENTION_PHASE.agent,
        statusCode: RETENTION_STATUS.p1InProgress,
        source: 'auto',
        metrics: candidateMetrics(candidate),
      });
      summary.created += 1;
      await notifyCaseCreated(ctx, {
        caseId: created.id,
        carrierId: created.carrierId,
        companyName: created.companyName,
        assignedAgentZohoUserId: created.assignedAgentZohoUserId,
        daysInactive: created.daysInactive,
        thresholdDays: created.thresholdDays,
      });
    }
  }

  const returnCheck = openRows.filter((row) => row.phaseCode !== RETENTION_PHASE.citi);
  if (returnCheck.length > 0) {
    const lastTxByCarrier = await fetchCarrierLastTransactions(
      returnCheck.map((row) => row.carrierId),
    );
    for (const row of returnCheck) {
      const lastTx = lastTxByCarrier.get(row.carrierId);
      if (!hasReturned(row, lastTx, now)) continue;
      await retentionCaseRepo.update(ctx, String(row.id), {
        statusCode: RETENTION_STATUS.p1Returned,
        agentOutcome: 'returned',
        eventType: 'outcome_recorded',
        eventNotes: 'Auto-closed: new transaction after case opened',
        metrics: {
          lastTransactionAt: lastTx ?? null,
          daysInactive: lastTx ? daysSince(lastTx, now) : 0,
        },
        lastSyncedAt: now,
      });
      summary.closedReturned += 1;
    }
  }

  logger.info({ ...summary }, 'retention case sync completed');
  return summary;
}
