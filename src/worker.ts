/**
 * Dedicated background-worker entry (dist/worker.js) — for the JOBS_WORKER_MODE='send-only'
 * deployment shape: the web service only enqueues; this process (a Render Background Worker
 * running the same image with `node dist/worker.js`) executes jobs + cron schedules.
 * No Fastify — just pg-boss workers.
 */
import { assertRuntimeSecrets, env } from './config/env.js';
import { closeDb } from './db/client.js';
import { logger } from './lib/logger.js';
import { startJobs, stopJobs } from './modules/jobs/boss.js';

// Same last-resort guards as server.ts: a DB blip mid-job must not kill the worker process
// (pg-boss retries failed jobs); a synchronous uncaught exception still exits for a clean restart.
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logger.error({ err }, 'unhandled promise rejection (survived — check the offending call site)');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception — exiting for a clean restart');
  process.exit(1);
});

async function main(): Promise<void> {
  assertRuntimeSecrets();
  if (!env.FF_JOBS_ENABLED) {
    logger.error('FF_JOBS_ENABLED is off — worker has nothing to do');
    process.exit(1);
  }
  await startJobs({ withWorkers: true });
  logger.info({ mode: env.JOBS_WORKER_MODE }, 'octane-assistant worker running');

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'worker shutting down');
    try {
      await stopJobs();
      await closeDb();
    } catch (err) {
      logger.error({ err }, 'error during worker shutdown');
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, 'failed to start worker');
  process.exit(1);
});
