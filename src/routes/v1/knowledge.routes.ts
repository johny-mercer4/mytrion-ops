import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DEFAULT_RETRIEVAL_K, MAX_RETRIEVAL_K } from '../../config/constants.js';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { ingestDocument } from '../../modules/knowledge/ingestService.js';
import { enqueueIngest } from '../../modules/knowledge/ingestWorker.js';
import { retrieve } from '../../modules/knowledge/retriever.js';
import { requireContext } from './helpers.js';

const embedSchema = z.object({
  title: z.string().min(1).max(500),
  content: z.string().min(1).max(1_000_000),
  source: z.string().max(1000).optional(),
  mimeType: z.string().max(200).optional(),
  async: z.boolean().optional(),
});

const querySchema = z.object({
  query: z.string().min(1).max(1000),
  limit: z.number().int().min(1).max(MAX_RETRIEVAL_K).optional(),
});

export async function knowledgeRoutes(app: FastifyInstance): Promise<void> {
  // Knowledge curation is an internal task; restrict to admin/ops.
  app.post(
    '/knowledge/embed',
    { onRequest: [app.authenticate], preHandler: [app.requireRole('admin', 'ops')] },
    async (request) => {
      if (!env.FF_KNOWLEDGE_INGEST_ENABLED) {
        throw new AppError('Knowledge ingestion is disabled', {
          statusCode: 503,
          code: 'FEATURE_DISABLED',
          expose: true,
        });
      }
      const ctx = requireContext(request);
      const body = embedSchema.parse(request.body);
      const input = {
        title: body.title,
        content: body.content,
        ...(body.source !== undefined ? { source: body.source } : {}),
        ...(body.mimeType !== undefined ? { mimeType: body.mimeType } : {}),
      };
      if (body.async) {
        await enqueueIngest({ ctx, input });
        return { status: 'queued' as const };
      }
      return ingestDocument(ctx, input);
    },
  );

  app.post('/knowledge/query', { onRequest: [app.authenticate] }, async (request) => {
    const ctx = requireContext(request);
    const body = querySchema.parse(request.body);
    const passages = await retrieve(ctx, body.query, body.limit ?? DEFAULT_RETRIEVAL_K);
    return { passages };
  });
}
