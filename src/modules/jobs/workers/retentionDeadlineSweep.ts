/**
 * Retention deadline sweep worker — cron every 15m + Admin manual enqueue.
 */
import type { z } from 'zod';
import { errorMessage } from '../../../lib/errors.js';
import { logger } from '../../../lib/logger.js';
import { auditFromContext } from '../../audit/auditLogger.js';
import {
  sweepRetentionDeadlines,
  type DeadlineSweepSummary,
} from '../../retention/deadlineSweep.js';
import { retentionDeadlineSweepJob } from '../catalog.js';
import { buildSystemContext } from '../systemContext.js';

export type RetentionDeadlineSweepPayload = z.infer<typeof retentionDeadlineSweepJob.schema>;

export async function runRetentionDeadlineSweep(
  payload: RetentionDeadlineSweepPayload = {},
): Promise<DeadlineSweepSummary> {
  const ctx = buildSystemContext(['retention']);
  const trigger = payload.trigger ?? 'cron';
  try {
    const summary = await sweepRetentionDeadlines(ctx, {
      ...(payload.limit !== undefined ? { limit: payload.limit } : {}),
    });
    await auditFromContext(ctx, {
      action: 'retention.deadline_sweep',
      status: 'ok',
      resourceType: 'retention_case',
      detail: { ...summary, trigger },
    });
    return summary;
  } catch (err) {
    logger.warn({ err: errorMessage(err) }, 'retention deadline sweep failed');
    throw err;
  }
}
