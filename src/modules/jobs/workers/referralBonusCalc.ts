/**
 * Referral bonus calculation worker — cron on the 1st of each month, plus Admin manual enqueue.
 *
 * Deterministic data job (no LLM). Return value is stored as pg-boss job `output` so Admin can show
 * the run result. The engine also writes a `mytrion_referral_calc_runs` row, which is the durable
 * audit; this output is just the convenience view.
 */
import type { z } from 'zod';
import { env } from '../../../config/env.js';
import { errorMessage } from '../../../lib/errors.js';
import { logger } from '../../../lib/logger.js';
import { auditFromContext } from '../../audit/auditLogger.js';
import {
  previousMonthStart,
  runReferralBonusCalculation,
  type ReferralBonusRunSummary,
} from '../../manager/referralBonusEngine.js';
import { referralBonusCalcJob } from '../catalog.js';
import { buildSystemContext } from '../systemContext.js';

export type ReferralBonusCalcPayload = z.infer<typeof referralBonusCalcJob.schema>;

export async function runReferralBonusCalc(
  payload: ReferralBonusCalcPayload = {},
): Promise<ReferralBonusRunSummary | { skipped: true; reason: string }> {
  if (!env.DWH_DATABASE_URL) {
    logger.info('referral bonus calc skipped: DWH_DATABASE_URL is not configured');
    return { skipped: true, reason: 'DWH_DATABASE_URL is not configured' };
  }
  const ctx = buildSystemContext(['management']);
  const trigger = payload.trigger ?? 'cron';
  // Cron fires on the 1st and always means "the month that just ended". An explicit periodMonth is
  // how a backfill re-runs an older month.
  const periodMonth = payload.periodMonth ?? previousMonthStart(new Date());

  try {
    const summary = await runReferralBonusCalculation(ctx, {
      periodMonth,
      trigger: trigger === 'manual' ? 'manual' : 'scheduled',
      ...(payload.triggeredBy !== undefined ? { triggeredBy: payload.triggeredBy } : {}),
    });
    await auditFromContext(ctx, {
      action: 'referral.bonus.calculate',
      status: 'ok',
      resourceType: 'referral_bonus_run',
      resourceId: summary.runId,
      detail: { ...summary, trigger },
    });
    return summary;
  } catch (err) {
    const message = errorMessage(err);
    await auditFromContext(ctx, {
      action: 'referral.bonus.calculate',
      status: 'error',
      resourceType: 'referral_bonus_run',
      detail: { periodMonth, trigger, error: message },
    }).catch(() => undefined);
    throw err;
  }
}
