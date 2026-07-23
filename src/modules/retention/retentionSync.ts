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
 *      p1_returned (all phases, including CITI). Pending Open Pool claim requests deleted.
 *
 * Pilot: when `FF_RETENTION_PILOT_ONLY=1`, steps 2–3 only run for Sales agents listed in
 * `RETENTION_PILOT_AGENT_ZOHO_USER_IDS`. Step 4 (fuel → Returned) still applies to any open case.
 */
import { env } from '../../config/env.js';
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
  /** Test / ops override for FF_RETENTION_PILOT_ONLY. */
  pilotOnly?: boolean | undefined;
  /** Test / ops override for RETENTION_PILOT_AGENT_ZOHO_USER_IDS. */
  pilotAgentZohoUserIds?: string | undefined;
}

export interface RetentionSyncSummary {
  scanned: number;
  breached: number;
  created: number;
  refreshed: number;
  closedReturned: number;
  /** Breached candidates skipped by the pilot allow-list. */
  pilotSkipped: number;
}

/** Parse comma-separated Zoho user ids for the Retention pilot allow-list. */
export function parsePilotAgentZohoUserIds(raw: string): Set<string> {
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** Resolve pilot switch at call time (process.env wins so tests can stub). */
export function resolveRetentionPilotConfig(overrides?: {
  pilotOnly?: boolean;
  pilotAgentZohoUserIds?: string;
}): { pilotOnly: boolean; allowIds: Set<string> } {
  const rawFlag = process.env.FF_RETENTION_PILOT_ONLY;
  const pilotOnly =
    overrides?.pilotOnly ??
    (rawFlag !== undefined
      ? rawFlag === '1' || rawFlag.toLowerCase() === 'true'
      : env.FF_RETENTION_PILOT_ONLY);
  const rawIds =
    overrides?.pilotAgentZohoUserIds ??
    process.env.RETENTION_PILOT_AGENT_ZOHO_USER_IDS ??
    env.RETENTION_PILOT_AGENT_ZOHO_USER_IDS;
  return { pilotOnly, allowIds: parsePilotAgentZohoUserIds(rawIds) };
}

/**
 * Whether sync may create a case for this Sales owner.
 * Pilot off → always true. Pilot on → agent Zoho id must be in the allow-list.
 */
export function isRetentionPilotAgentAllowed(
  agentZohoUserId: string | null | undefined,
  opts: { pilotOnly: boolean; allowIds: Set<string> } = resolveRetentionPilotConfig(),
): boolean {
  if (!opts.pilotOnly) return true;
  const id = agentZohoUserId?.trim();
  if (!id || opts.allowIds.size === 0) return false;
  return opts.allowIds.has(id);
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
  const { pilotOnly, allowIds: pilotAllow } = resolveRetentionPilotConfig({
    ...(opts.pilotOnly !== undefined ? { pilotOnly: opts.pilotOnly } : {}),
    ...(opts.pilotAgentZohoUserIds !== undefined
      ? { pilotAgentZohoUserIds: opts.pilotAgentZohoUserIds }
      : {}),
  });
  if (pilotOnly) {
    logger.warn(
      {
        pilotAgentCount: pilotAllow.size,
        pilotAgentIds: [...pilotAllow],
      },
      'retention sync pilot-only: scan + creates limited to listed Sales agents',
    );
  }
  const candidates = await scanRetentionCandidates({
    ...(opts.lookbackDays !== undefined ? { lookbackDays: opts.lookbackDays } : {}),
    ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
    ...(pilotOnly && pilotAllow.size > 0 ? { agentZohoUserIds: [...pilotAllow] } : {}),
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
    pilotSkipped: 0,
  };

  const breachedIds = new Set<string>();
  for (const candidate of breached) {
    breachedIds.add(candidate.carrierId);
    const existing = openByCarrier.get(candidate.carrierId);
    // Refresh metrics for any already-open case (incl. pre-pilot leftovers).
    // New creates are pilot-gated.
    if (existing) {
      await retentionCaseRepo.update(ctx, String(existing.id), {
        metrics: candidateMetrics(candidate),
        ...(candidate.contactPhone ? { contactPhone: candidate.contactPhone } : {}),
        preferredLanguage: candidate.preferredLanguage,
        isSpanishDesk: candidate.isSpanishDesk,
        // Backfill deal id when sync previously created the case without it.
        ...(!existing.zohoDealId && candidate.zohoDealId
          ? { zohoDealId: candidate.zohoDealId }
          : {}),
        lastSyncedAt: now,
      });
      summary.refreshed += 1;
      continue;
    }
    if (
      !isRetentionPilotAgentAllowed(candidate.agentZohoUserId, {
        pilotOnly,
        allowIds: pilotAllow,
      })
    ) {
      summary.pilotSkipped += 1;
      continue;
    }
    const created = await retentionCaseRepo.create(ctx, {
      carrierId: candidate.carrierId,
      companyName: candidate.companyName ?? undefined,
      applicationId: candidate.applicationId ?? undefined,
      agentName: candidate.agentName ?? undefined,
      contactPhone: candidate.contactPhone ?? undefined,
      preferredLanguage: candidate.preferredLanguage,
      isSpanishDesk: candidate.isSpanishDesk,
      zohoDealId: candidate.zohoDealId ?? undefined,
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

  // Unified rule: any open phase/status closes on a post-create transaction.
  if (openRows.length > 0) {
    const lastTxByCarrier = await fetchCarrierLastTransactions(
      openRows.map((row) => row.carrierId),
    );
    for (const row of openRows) {
      const lastTx = lastTxByCarrier.get(row.carrierId);
      if (!hasReturned(row, lastTx, now)) continue;
      if (
        row.statusCode === 'p1_pool_claim_pending' ||
        row.pendingClaimantZohoUserId
      ) {
        const { deleteOpenClaimRequests } = await import(
          '../../repos/retentionPoolClaimRepo.js'
        );
        await deleteOpenClaimRequests(ctx, row.id);
      }
      await retentionCaseRepo.update(ctx, String(row.id), {
        statusCode: RETENTION_STATUS.p1Returned,
        agentOutcome: 'returned',
        eventType: 'outcome_recorded',
        eventNotes: 'Auto-closed: new transaction after case opened',
        pendingClaimantZohoUserId: null,
        // Clear Sales SLA so Closed cards don't keep a stale "→ Retention" deadline.
        currentDeadlineAt: null,
        currentDeadlineType: null,
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
