import type { z } from 'zod';
import { errorMessage } from '../../../lib/errors.js';
import { logger } from '../../../lib/logger.js';
import { auditFromContext } from '../../audit/auditLogger.js';
import { watchService } from '../../mytrionWatch/watchService.js';
import { DISABLED_JOB_QUEUES, mytrionWatchScoringJob } from '../catalog.js';
import { buildSystemContext } from '../systemContext.js';

export type MytrionWatchScoringPayload = z.infer<typeof mytrionWatchScoringJob.schema>;

/**
 * Weekly behavioural scoring of every active carrier.
 *
 * Writes a dated snapshot into our own Postgres. A re-run of the same date corrects the rows rather
 * than adding a second history point, so this is safe to retry.
 */
export async function runMytrionWatchScoring(
  payload: MytrionWatchScoringPayload = {},
): Promise<
  | { scoringDate: string; scored: number; durationMs: number }
  | { skipped: true; reason: string }
> {
  if (DISABLED_JOB_QUEUES.has(mytrionWatchScoringJob.name)) {
    logger.info('mytrion watch scoring skipped — queue disabled');
    return { skipped: true, reason: 'disabled' };
  }
  const ctx = buildSystemContext(['verification']);
  try {
    const result = await watchService.runScoring(ctx, {
      trigger: payload.trigger ?? 'cron',
      ...(payload.scoringDate ? { scoringDate: payload.scoringDate } : {}),
    });
    await auditFromContext(ctx, {
      action: 'mytrion_watch.scoring_run',
      status: 'ok',
      resourceType: 'mytrion_watch_run',
      resourceId: result.scoringDate,
      detail: {
        scored: result.scored,
        durationMs: result.durationMs,
        unmatchedFeatures: result.unmatchedFeatures,
      },
    });
    return { scoringDate: result.scoringDate, scored: result.scored, durationMs: result.durationMs };
  } catch (err) {
    logger.warn({ err: errorMessage(err) }, 'mytrion watch scoring failed');
    throw err;
  }
}
