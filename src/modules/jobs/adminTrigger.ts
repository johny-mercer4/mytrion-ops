/**
 * Admin-triggered enqueue for catalog cron queues. Payloads stay zod-validated;
 * singleton queues reject overlaps with a clear 409-style AppError.
 */
import { AppError } from '../../lib/errors.js';
import {
  ALL_JOBS,
  DISABLED_JOB_QUEUES,
  MANUAL_TRIGGERABLE_QUEUES,
  retentionCaseSyncJob,
  retentionDeadlineSweepJob,
  type JobDef,
} from './catalog.js';
import { enqueue } from './queue.js';
import type { z } from 'zod';

function findJob(name: string): JobDef<z.ZodTypeAny> | undefined {
  return ALL_JOBS.find((j) => j.name === name);
}

export async function triggerCatalogJob(
  name: string,
  payload: Record<string, unknown> = {},
): Promise<{ jobId: string; name: string }> {
  if (DISABLED_JOB_QUEUES.has(name)) {
    throw new AppError(`Queue '${name}' is disabled`, {
      statusCode: 400,
      code: 'JOB_DISABLED',
      expose: true,
    });
  }
  if (!MANUAL_TRIGGERABLE_QUEUES.has(name)) {
    throw new AppError(`Queue '${name}' cannot be triggered from Admin`, {
      statusCode: 400,
      code: 'JOB_NOT_TRIGGERABLE',
      expose: true,
    });
  }
  const job = findJob(name);
  if (!job) {
    throw new AppError(`Unknown job queue '${name}'`, {
      statusCode: 404,
      code: 'JOB_UNKNOWN',
      expose: true,
    });
  }

  let data: Record<string, unknown> = { ...payload };
  if (name === retentionCaseSyncJob.name) {
    data = {
      trigger: 'manual',
      ...(typeof payload.lookbackDays === 'number' ? { lookbackDays: payload.lookbackDays } : {}),
      ...(typeof payload.limit === 'number' ? { limit: payload.limit } : {}),
    };
  }
  if (name === retentionDeadlineSweepJob.name) {
    data = {
      trigger: 'manual',
      ...(typeof payload.limit === 'number' ? { limit: payload.limit } : {}),
    };
  }

  try {
    const jobId = await enqueue(job, data);
    return { jobId, name };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/duplicate singleton|rejected/i.test(msg)) {
      throw new AppError(
        `Queue '${name}' already has a run in progress or queued (singleton). Wait for it to finish.`,
        { statusCode: 409, code: 'JOB_ALREADY_QUEUED', expose: true, cause: err },
      );
    }
    throw err;
  }
}
