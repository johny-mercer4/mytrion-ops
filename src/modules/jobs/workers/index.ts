/**
 * Worker registration — one boss.work per queue, every handler zod-parses its payload and is
 * idempotent under re-delivery (see agentRun's markRunning guard / singleton cron policies).
 */
import type { PgBoss } from 'pg-boss';
import { env } from '../../../config/env.js';
import {
  approvalsExpiryJob,
  memoryDecayJob,
  checkpointSweepJob,
  deadLetterJob,
  agentRunJob,
  retentionCaseSyncJob,
  retentionDeadlineSweepJob,
} from '../catalog.js';
import { handleAgentRunJobs } from './agentRun.js';
import { bulkIngestJob, handleBulkIngestJobs } from './knowledgeIngest.js';
import { AUTOMATIONS, makeAutomationHandler } from './automations.js';
import { runRetentionCaseSync } from './retentionCaseSync.js';
import { runRetentionDeadlineSweep } from './retentionDeadlineSweep.js';
import {
  decayAgentMemories,
  handleDeadLetterJobs,
  sweepExpiredApprovals,
  sweepStaleCheckpoints,
} from './maintenance.js';

export async function registerWorkers(boss: PgBoss): Promise<void> {
  await boss.work(agentRunJob.name, { batchSize: env.JOBS_CONCURRENCY }, handleAgentRunJobs);

  for (const spec of AUTOMATIONS) {
    const handler = makeAutomationHandler(spec);
    await boss.work(spec.queue, { batchSize: 1 }, async () => handler());
  }

  await boss.work(retentionCaseSyncJob.name, { batchSize: 1 }, async (jobs) => {
    const job = jobs[0];
    if (!job) return undefined;
    const payload = retentionCaseSyncJob.schema.parse(job.data ?? {});
    return runRetentionCaseSync(payload);
  });
  await boss.work(retentionDeadlineSweepJob.name, { batchSize: 1 }, async (jobs) => {
    const job = jobs[0];
    if (!job) return undefined;
    const payload = retentionDeadlineSweepJob.schema.parse(job.data ?? {});
    return runRetentionDeadlineSweep(payload);
  });
  await boss.work(bulkIngestJob.name, { batchSize: 1 }, handleBulkIngestJobs);
  await boss.work(checkpointSweepJob.name, { batchSize: 1 }, async () => sweepStaleCheckpoints());
  await boss.work(approvalsExpiryJob.name, { batchSize: 1 }, async () => sweepExpiredApprovals());
  await boss.work(memoryDecayJob.name, { batchSize: 1 }, async () => decayAgentMemories());
  await boss.work(deadLetterJob.name, { batchSize: 5 }, handleDeadLetterJobs);
}
