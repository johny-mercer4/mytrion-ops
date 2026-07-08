/**
 * Bulk knowledge ingest: parse a stored file and embed it into the knowledge base in the
 * background (large uploads would block a request). Retry-safe — ingestDocument is
 * checksum-idempotent. Executes under the requester's exact context.
 */
import type { Job } from 'pg-boss';
import { z } from 'zod';
import { errorMessage } from '../../../lib/errors.js';
import { logger } from '../../../lib/logger.js';
import { agentTaskRepo } from '../../../repos/agentTaskRepo.js';
import type { TenantContext } from '../../../types/tenantContext.js';
import { readFileBuffer } from '../../files/fileService.js';
import { parseFile } from '../../files/parse/index.js';
import { ingestDocument } from '../../knowledge/ingestService.js';
import { defineJob, DEAD_LETTER_QUEUE, payloadToContext, tenantContextSchema } from '../catalog.js';
import { enqueue } from '../queue.js';

export const bulkIngestJob = defineJob({
  name: 'knowledge.bulk-ingest',
  schema: z.object({
    taskId: z.string().min(1),
    ctx: tenantContextSchema,
    fileId: z.string().min(1),
    department: z.string().optional(),
    title: z.string().optional(),
  }),
  queue: { retryLimit: 2, retryDelay: 30, retryBackoff: true, expireInSeconds: 600, deadLetter: DEAD_LETTER_QUEUE },
});

export async function enqueueBulkIngest(
  ctx: TenantContext,
  input: { fileId: string; department?: string; title?: string },
): Promise<string> {
  const task = await agentTaskRepo.create(ctx, {
    userId: ctx.userId,
    kind: 'knowledge.bulk_ingest',
    queue: bulkIngestJob.name,
    request: { fileId: input.fileId, ...(input.department ? { department: input.department } : {}) },
    fileId: input.fileId,
  });
  const jobId = await enqueue(
    bulkIngestJob,
    { taskId: task.id, ctx, ...input },
    { singletonKey: task.id },
  );
  await agentTaskRepo.setJobId(ctx, task.id, jobId);
  return task.id;
}

export async function handleBulkIngestJobs(jobs: Job<unknown>[]): Promise<void> {
  for (const job of jobs) {
    const payload = bulkIngestJob.schema.parse(job.data);
    const ctx = payloadToContext(payload.ctx);
    const claimed = await agentTaskRepo.markRunning(ctx, payload.taskId);
    if (!claimed) continue;
    try {
      const { file, buffer } = await readFileBuffer(ctx, payload.fileId);
      const parsed = await parseFile(buffer, file.mime, file.name);
      const result = await ingestDocument(ctx, {
        title: payload.title ?? file.name,
        content: parsed.text,
        source: `file:${file.id}`,
        ...(payload.department ? { department: payload.department } : {}),
      });
      await agentTaskRepo.complete(ctx, payload.taskId, { docId: result.docId, status: result.status });
    } catch (err) {
      const message = errorMessage(err);
      await agentTaskRepo.fail(ctx, payload.taskId, message);
      logger.warn({ taskId: payload.taskId, err: message }, 'bulk ingest failed');
      throw err;
    }
  }
}
