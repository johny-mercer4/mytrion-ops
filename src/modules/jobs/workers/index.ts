/**
 * Worker registration — one boss.work per queue, every handler zod-parses its payload and is
 * idempotent under re-delivery (see agentRun's markRunning guard / singleton cron policies).
 */
import type { PgBoss } from 'pg-boss';
import { env } from '../../../config/env.js';
import {
  checkpointSweepJob,
  deadLetterJob,
  agentRunJob,
} from '../catalog.js';
import { handleAgentRunJobs } from './agentRun.js';
import { AUTOMATIONS, makeAutomationHandler } from './automations.js';
import { handleDeadLetterJobs, sweepStaleCheckpoints } from './maintenance.js';

export async function registerWorkers(boss: PgBoss): Promise<void> {
  await boss.work(agentRunJob.name, { batchSize: env.JOBS_CONCURRENCY }, handleAgentRunJobs);

  for (const spec of AUTOMATIONS) {
    const handler = makeAutomationHandler(spec);
    await boss.work(spec.queue, { batchSize: 1 }, async () => handler());
  }

  await boss.work(checkpointSweepJob.name, { batchSize: 1 }, async () => sweepStaleCheckpoints());
  await boss.work(deadLetterJob.name, { batchSize: 5 }, handleDeadLetterJobs);
}
