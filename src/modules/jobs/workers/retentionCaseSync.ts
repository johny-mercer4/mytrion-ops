/**
 * Nightly retention case sync worker — runs the DWH frequency-breach scan and generates
 * retention cases before shift start (SOP: the reps' list must be ready each morning).
 * Deterministic data job (no LLM). Scoped to the retention department; audited like a
 * manual /v1/retention/sync trigger, with trigger 'cron'.
 */
import { env } from '../../../config/env.js';
import { errorMessage } from '../../../lib/errors.js';
import { logger } from '../../../lib/logger.js';
import { auditFromContext } from '../../audit/auditLogger.js';
import { syncRetentionCases } from '../../retention/retentionSync.js';
import { buildSystemContext } from '../systemContext.js';

export async function runRetentionCaseSync(): Promise<void> {
  if (!env.DWH_DATABASE_URL) {
    logger.info('retention case sync skipped: DWH_DATABASE_URL is not configured');
    return;
  }
  const ctx = buildSystemContext(['retention']);
  try {
    const summary = await syncRetentionCases(ctx);
    await auditFromContext(ctx, {
      action: 'retention.sync',
      status: 'ok',
      resourceType: 'retention_case',
      detail: { ...summary, trigger: 'cron' },
    });
  } catch (err) {
    logger.warn({ err: errorMessage(err) }, 'retention case sync failed');
    throw err;
  }
}
