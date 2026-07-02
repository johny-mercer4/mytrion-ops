/**
 * pg-boss lifecycle: lazy singleton on the app Postgres (own `pgboss` schema, self-migrating at
 * start — never modeled in drizzle), queue creation, worker registration, cron schedules, and
 * graceful shutdown. JOBS_WORKER_MODE decides whether THIS process executes jobs ('inline'),
 * only enqueues ('send-only' — a dedicated dist/worker.js executes), or is off entirely.
 */
import { PgBoss } from 'pg-boss';
import { databaseUrl, env } from '../../config/env.js';
import { dbSslOption } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { ALL_JOBS } from './catalog.js';
import { applySchedules } from './scheduler.js';
import { registerWorkers } from './workers/index.js';

let boss: PgBoss | null = null;
let started = false;

export function getBoss(): PgBoss {
  if (!boss) {
    boss = new PgBoss({
      connectionString: databaseUrl,
      schema: env.PGBOSS_SCHEMA,
      max: 3, // small pool — the app pool + checkpointer already use the connection budget
      ssl: dbSslOption(databaseUrl),
    });
    boss.on('error', (err) => logger.error({ err }, 'pg-boss error'));
  }
  return boss;
}

export function jobsEnabled(): boolean {
  return env.FF_JOBS_ENABLED && env.JOBS_WORKER_MODE !== 'off';
}

/**
 * Boot pg-boss (queues always ensured so send() works). Workers + cron schedules are
 * registered when `withWorkers` (inline mode, or the dedicated worker entry).
 */
export async function startJobs(opts: { withWorkers: boolean }): Promise<void> {
  if (!jobsEnabled()) return;
  const b = getBoss();
  if (!started) {
    await b.start();
    started = true;
  }
  for (const job of ALL_JOBS) {
    await b.createQueue(job.name, job.queue);
  }
  if (opts.withWorkers) {
    await registerWorkers(b);
    await applySchedules(b);
    logger.info({ mode: env.JOBS_WORKER_MODE }, 'pg-boss workers + schedules registered');
  } else {
    logger.info('pg-boss started (send-only)');
  }
}

/** Graceful stop: lets in-flight jobs finish within the Render SIGTERM window. */
export async function stopJobs(): Promise<void> {
  if (!boss || !started) return;
  try {
    await boss.stop({ graceful: true, close: true, timeout: 25_000 });
  } catch (err) {
    logger.warn({ err }, 'pg-boss stop failed');
  } finally {
    started = false;
  }
}
