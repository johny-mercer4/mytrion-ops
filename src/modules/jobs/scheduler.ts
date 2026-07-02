/**
 * Idempotent cron registration: the catalog is the source of truth — schedules are upserted
 * every boot and any stray schedule (renamed/removed automation) is unscheduled.
 */
import type { PgBoss } from 'pg-boss';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { CRON_SCHEDULES } from './catalog.js';

export async function applySchedules(boss: PgBoss): Promise<void> {
  const wanted = new Map(CRON_SCHEDULES.map((s) => [s.name, s.cron]));
  const existing = await boss.getSchedules();
  for (const schedule of existing) {
    if (!wanted.has(schedule.name)) {
      await boss.unschedule(schedule.name);
      logger.info({ queue: schedule.name }, 'unscheduled stray cron');
    }
  }
  for (const [name, cron] of wanted) {
    await boss.schedule(name, cron, {}, { tz: env.JOBS_CRON_TZ });
  }
}
