import { buildApp } from './app.js';
import { assertRuntimeSecrets, env } from './config/env.js';
import { closeDb } from './db/client.js';
import { logger } from './lib/logger.js';
import { jobsEnabled, startJobs, stopJobs } from './modules/jobs/boss.js';

async function main(): Promise<void> {
  assertRuntimeSecrets();
  const app = await buildApp();

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'octane-assistant API listening');

  // Background jobs: 'inline' runs workers in-process (single Render service);
  // 'send-only' boots boss for enqueueing only (a dedicated dist/worker.js executes).
  if (jobsEnabled()) {
    await startJobs({ withWorkers: env.JOBS_WORKER_MODE === 'inline' });
  }

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    try {
      // Order matters: finish in-flight jobs first (Render allows ~30s after SIGTERM),
      // then stop accepting HTTP, then release the DB pool.
      await stopJobs();
      await app.close();
      await closeDb();
    } catch (err) {
      logger.error({ err }, 'error during shutdown');
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, 'failed to start server');
  process.exit(1);
});
