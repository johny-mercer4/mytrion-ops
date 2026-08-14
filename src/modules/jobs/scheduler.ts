/**
 * Idempotent cron registration: the catalog is the source of truth — schedules are upserted
 * every boot and any stray schedule (renamed/removed automation) is unscheduled.
 */
import type { PgBoss } from 'pg-boss';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { verificationIngestStateRepo } from '../../repos/verificationIngestStateRepo.js';
import {
  CRON_SCHEDULES,
  DEPARTMENT_AUTOMATION_QUEUES,
  DISABLED_JOB_QUEUES,
  verificationCaseIngestJob,
} from './catalog.js';
import { buildSystemContext } from './systemContext.js';

export async function applySchedules(boss: PgBoss): Promise<void> {
  // Department automations run LLM agent turns (and DM Telegram) — they must NOT auto-fire just
  // because jobs are on. Gate them on the orchestrator flag; maintenance crons always run.
  // DISABLED_JOB_QUEUES are never scheduled (e.g. retention weekly LLM while Sales flow ships).
  const orchestratorOn = env.FF_ORCHESTRATOR_ENABLED || env.FF_DEEP_AGENTS_ENABLED;
  const wanted = new Map(
    CRON_SCHEDULES.filter(
      (s) =>
        !DISABLED_JOB_QUEUES.has(s.name) &&
        (env.FF_KPI_COLLECTION_ENABLED || !s.name.startsWith('kpi.sales.')) &&
        (orchestratorOn || !DEPARTMENT_AUTOMATION_QUEUES.has(s.name)),
    ).map((s) => [s.name, s]),
  );
  const existing = await boss.getSchedules();
  for (const schedule of existing) {
    if (!wanted.has(schedule.name)) {
      await boss.unschedule(schedule.name);
      logger.info({ queue: schedule.name }, 'unscheduled stray cron');
    }
  }
  for (const [name, schedule] of wanted) {
    await boss.schedule(name, schedule.cron, {}, { tz: schedule.timezone ?? env.JOBS_CRON_TZ });
  }
  if (wanted.has(verificationCaseIngestJob.name)) {
    try {
      const pinned = await verificationIngestStateRepo.pinLegacyToNow(
        buildSystemContext(['verification']),
      );
      logger.info({ watermark: pinned }, 'verification ingest fresh-only watermark ready');
    } catch (err) {
      logger.warn({ err }, 'verification ingest watermark pin skipped');
    }
  }
}
