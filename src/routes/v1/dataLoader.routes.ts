import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { AppError, NotFoundError } from '../../lib/errors.js';
import { DATA_LOADER_TABLES } from '../../modules/dataLoader/allowlist.js';
import { bulkChangeLogRepo } from '../../repos/bulkChangeLogRepo.js';
import { adminOnlyOptions } from './admin.routes.js';
import { requireContext } from './helpers.js';

const batchesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(10),
  offset: z.coerce.number().int().min(0).default(0),
});

const batchParamsSchema = z.object({
  batchId: z.string().min(1).max(300),
});

function isMissingJournal(error: unknown): boolean {
  if (!(error instanceof Error) || !('code' in error)) return false;
  return error.code === '42P01' && error.message.includes('bulk_change_log');
}

async function withDataLoaderReady<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isMissingJournal(error)) {
      throw new AppError('Data Loader migration 0069 is not applied.', {
        statusCode: 503,
        code: 'DATA_LOADER_NOT_READY',
        expose: true,
        cause: error,
      });
    }
    throw error;
  }
}

export async function dataLoaderRoutes(app: FastifyInstance): Promise<void> {
  const adminOnly = adminOnlyOptions(app);

  app.get('/admin/data-loader/config', adminOnly, async () => ({
    baseUrl: env.NOCODB_BASE_URL || null,
    tables: DATA_LOADER_TABLES,
  }));

  app.get('/admin/data-loader/batches', adminOnly, async (request) => {
    const ctx = requireContext(request);
    const query = batchesQuerySchema.parse(request.query);
    const [batches, total] = await withDataLoaderReady(() =>
      Promise.all([
        bulkChangeLogRepo.list(ctx, query),
        bulkChangeLogRepo.count(ctx),
      ]),
    );
    return { batches, total, limit: query.limit, offset: query.offset };
  });

  app.get<{ Params: { batchId: string } }>(
    '/admin/data-loader/batches/:batchId',
    adminOnly,
    async (request) => {
      const ctx = requireContext(request);
      const { batchId } = batchParamsSchema.parse(request.params);
      const rows = await withDataLoaderReady(() =>
        bulkChangeLogRepo.findBatch(ctx, batchId),
      );
      if (rows.length === 0) throw new NotFoundError('Data Loader batch not found.');
      return { batchId, rows };
    },
  );

  app.post<{ Params: { batchId: string } }>(
    '/admin/data-loader/batches/:batchId/revert',
    adminOnly,
    async (request) => {
      const ctx = requireContext(request);
      const { batchId } = batchParamsSchema.parse(request.params);
      return withDataLoaderReady(() => bulkChangeLogRepo.revert(ctx, batchId));
    },
  );
}
