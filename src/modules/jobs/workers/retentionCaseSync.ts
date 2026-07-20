/**
 * Retention case sync worker (cron every hour + Admin manual enqueue) — runs the DWH
 * frequency-breach scan and generates retention cases. Deterministic data job (no LLM).
 * Return value is stored as pg-boss job `output` so Admin can show run results.
 */
import type { z } from 'zod';
import { env } from '../../../config/env.js';
import { errorMessage } from '../../../lib/errors.js';
import { logger } from '../../../lib/logger.js';
import { auditFromContext } from '../../audit/auditLogger.js';
import {
  syncRetentionCases,
  type RetentionSyncSummary,
} from '../../retention/retentionSync.js';
import { retentionCaseSyncJob } from '../catalog.js';
import { buildSystemContext } from '../systemContext.js';

export type RetentionCaseSyncPayload = z.infer<typeof retentionCaseSyncJob.schema>;

export async function runRetentionCaseSync(
  payload: RetentionCaseSyncPayload = {},
): Promise<RetentionSyncSummary | { skipped: true; reason: string }> {
  if (!env.DWH_DATABASE_URL) {
    logger.info('retention case sync skipped: DWH_DATABASE_URL is not configured');
    return { skipped: true, reason: 'DWH_DATABASE_URL is not configured' };
  }
  const ctx = buildSystemContext(['retention']);
  const trigger = payload.trigger ?? 'cron';
  try {
    const summary = await syncRetentionCases(ctx, {
      ...(payload.lookbackDays !== undefined ? { lookbackDays: payload.lookbackDays } : {}),
      ...(payload.limit !== undefined ? { limit: payload.limit } : {}),
    });
    await auditFromContext(ctx, {
      action: 'retention.sync',
      status: 'ok',
      resourceType: 'retention_case',
      detail: { ...summary, trigger },
    });
    return summary;
  } catch (err) {
    logger.warn({ err: errorMessage(err) }, 'retention case sync failed');
    throw err;
  }
}
