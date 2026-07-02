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
import { bulkIngestJob } from './workers/knowledgeIngest.js';
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
  // The dead-letter queue MUST exist before any queue that references it: pg-boss v12
  // createQueue validates the deadLetter target up front. Create referenced dead-letter
  // targets first, then the rest.
  const jobs = [...ALL_JOBS, bulkIngestJob];
  const deadLetterNames = new Set(jobs.map((j) => j.queue.deadLetter).filter((n): n is string => Boolean(n)));
  const ordered = [...jobs].sort((a, b) => {
    const aDead = deadLetterNames.has(a.name) ? 0 : 1;
    const bDead = deadLetterNames.has(b.name) ? 0 : 1;
    return aDead - bDead;
  });
  for (const job of ordered) {
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
