import { pathToFileURL, URL } from 'node:url';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { INGEST_QUEUE_NAME } from '../../config/constants.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { ingestDocument, type IngestInput, type IngestResult } from './ingestService.js';

export interface IngestJobData {
  ctx: TenantContext;
  input: IngestInput;
}

/**
 * Build BullMQ connection options from REDIS_URL. We pass plain RedisOptions (not an
 * ioredis instance) so BullMQ uses its own bundled ioredis — avoiding a type/version
 * skew between our ioredis and BullMQ's. lazyConnect keeps imports socket-free;
 * maxRetriesPerRequest: null is required by BullMQ's blocking worker connection.
 */
function createConnection(): ConnectionOptions {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    maxRetriesPerRequest: null,
    lazyConnect: true,
    ...(url.password ? { password: url.password } : {}),
    ...(url.username ? { username: url.username } : {}),
  };
}

let queue: Queue<IngestJobData> | null = null;

/** Lazily-created producer queue. Routes/CLIs use this to enqueue async ingest jobs. */
export function getIngestQueue(): Queue<IngestJobData> {
  if (!queue) {
    queue = new Queue<IngestJobData>(INGEST_QUEUE_NAME, { connection: createConnection() });
  }
  return queue;
}

export function enqueueIngest(data: IngestJobData): Promise<unknown> {
  return getIngestQueue().add('ingest', data, {
    removeOnComplete: 100,
    removeOnFail: 500,
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  });
}

export function createIngestWorker(): Worker<IngestJobData, IngestResult> {
  const worker = new Worker<IngestJobData, IngestResult>(
    INGEST_QUEUE_NAME,
    async (job) => {
      const { ctx, input } = job.data;
      logger.info({ jobId: job.id, tenantId: ctx.tenantId, title: input.title }, 'ingest job start');
      return ingestDocument(ctx, input);
    },
    { connection: createConnection() },
  );
  worker.on('completed', (job, result) => {
    logger.info({ jobId: job.id, result }, 'ingest job completed');
  });
  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'ingest job failed');
  });
  return worker;
}

// Entry point for `pnpm worker` / `pnpm worker:prod`.
const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === invokedPath) {
  createIngestWorker();
  logger.info({ queue: INGEST_QUEUE_NAME }, 'knowledge ingest worker started');
}
