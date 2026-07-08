/**
 * Retention case auto-generation — the sync run that replaces the manual daily
 * "source file refresh + sort the Retention List" (SOP steps 1–4):
 *
 *   1. Scan the DWH for frequency-breach candidates (active, non-debtor carriers whose
 *      days-inactive exceed their high/medium/low cadence threshold).
 *   2. Breached carrier WITHOUT an open case → create one (phase 'sales': the deal owner
 *      gets the first window before Retention takes over, per the future workflow).
 *   3. Breached carrier WITH an open case → refresh its DWH metrics in place.
 *   4. Open case whose carrier transacted again after the case opened and is back inside
 *      its threshold → close it as 'returned' (flowchart branch 1). 'citi' is final — those
 *      cases are never auto-closed.
 *
 * Callable from the admin route (manual trigger) and the nightly cron worker. The caller's
 * TenantContext scopes every repo call; the run itself never widens authority.
 */
import type { RetentionCase } from '../../db/schema/index.js';
import {
  daysSince,
  fetchCarrierLastTransactions,
  scanRetentionCandidates,
  type RetentionCandidate,
} from '../../integrations/dwhRetention.js';
import { logger } from '../../lib/logger.js';
import { retentionCaseRepo, type RetentionMetricsInput } from '../../repos/retentionCaseRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';

export interface RetentionSyncOptions {
  /** How long-dead an account may be and still enter the scan (default 45 days). */
  lookbackDays?: number | undefined;
  /** Max candidates pulled from the DWH per run (default 500, volume-first). */
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
    frequencyClass: c.frequencyClass,
    thresholdDays: c.thresholdDays,
    lastTransactionAt: c.lastTransactionAt,
    daysInactive: c.daysInactive,
    txCount90d: c.txCount90d,
    gallons90d: c.gallons90d,
    activeCards: c.activeCards,
  };
}

/** "Returned" check: a transaction newer than the case AND back inside the threshold. */
function hasReturned(row: RetentionCase, lastTx: Date | undefined, now: Date): boolean {
  if (!lastTx) return false;
  const threshold = row.thresholdDays ?? 7;
  return lastTx.getTime() > row.createdAt.getTime() && daysSince(lastTx, now) <= threshold;
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
      await retentionCaseRepo.update(ctx, existing.id, {
        metrics: candidateMetrics(candidate),
        lastSyncedAt: now,
      });
      summary.refreshed += 1;
    } else {
      await retentionCaseRepo.create(ctx, {
        carrierId: candidate.carrierId,
        companyName: candidate.companyName ?? undefined,
        applicationId: candidate.applicationId ?? undefined,
        agentName: candidate.agentName ?? undefined,
        agentZohoUserId: candidate.agentZohoUserId ?? undefined,
        phase: 'sales',
        stage: 'inactive_no_reason',
        source: 'auto',
        metrics: candidateMetrics(candidate),
      });
      summary.created += 1;
    }
  }

  // Returned pass: open, non-final cases whose carrier no longer breaches.
  const returnCheck = openRows.filter(
    (row) => row.phase !== 'citi' && !breachedIds.has(row.carrierId),
  );
  if (returnCheck.length > 0) {
    const lastTxByCarrier = await fetchCarrierLastTransactions(
      returnCheck.map((row) => row.carrierId),
    );
    for (const row of returnCheck) {
      const lastTx = lastTxByCarrier.get(row.carrierId);
      if (!hasReturned(row, lastTx, now)) continue;
      await retentionCaseRepo.update(ctx, row.id, {
        status: 'closed',
        outcome: 'returned',
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
