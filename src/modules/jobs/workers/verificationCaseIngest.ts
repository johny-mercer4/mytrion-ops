import type { z } from 'zod';
import { errorMessage } from '../../../lib/errors.js';
import { logger } from '../../../lib/logger.js';
import { auditFromContext } from '../../audit/auditLogger.js';
import { ingestVerificationDeals, type VerificationIngestSummary } from '../../verification/zohoDealIngest.js';
import { verificationCaseIngestJob } from '../catalog.js';
import { buildSystemContext } from '../systemContext.js';

export type VerificationCaseIngestPayload = z.infer<typeof verificationCaseIngestJob.schema>;

export async function runVerificationCaseIngest(
  payload: VerificationCaseIngestPayload = {},
): Promise<VerificationIngestSummary | { skipped: true; reason: string }> {
  const ctx = buildSystemContext(['verification']);
  const trigger = payload.trigger ?? 'cron';
  try {
    const summary = await ingestVerificationDeals(ctx);
    await auditFromContext(ctx, {
      action: 'verification.case_ingest',
      status: 'ok',
      resourceType: 'verification_case',
      detail: { ...summary, trigger },
    });
    return summary;
  } catch (err) {
    logger.warn({ err: errorMessage(err) }, 'verification case ingest failed');
    throw err;
  }
}
