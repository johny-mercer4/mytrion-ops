import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { NotFoundError } from '../../lib/errors.js';
import { scopeRiskRepo } from '../../repos/scopeRiskRepo.js';
import { requireContext } from './helpers.js';

const categoryEnum = z.enum(['blocker', 'red_flag', 'manual']);
const labelSchema = z.string().trim().min(1).max(280);
const iconSchema = z.string().max(40);
const nodeIdSchema = z.string().min(1).max(120);

const createSchema = z.object({
  nodeId: nodeIdSchema,
  category: categoryEnum,
  label: labelSchema,
  icon: iconSchema.optional(),
  position: z.number().int().min(0).optional(),
});

// Update accepts any subset; `.refine` rejects an empty patch so a no-op POST is a clear 400.
const updateSchema = z
  .object({
    label: labelSchema.optional(),
    icon: iconSchema.optional(),
    category: categoryEnum.optional(),
    position: z.number().int().min(0).optional(),
  })
  .refine((p) => Object.values(p).some((v) => v !== undefined), {
    message: 'Provide at least one field to update (label, icon, category, position).',
  });

const listQuerySchema = z.object({ nodeId: nodeIdSchema.optional() });
const bulkDeleteSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(200) });

/**
 * Octane Scope risk items — per-node Blockers / Red Flags / Manual Processes, editable from
 * the Mytrion RnD widget. Auth: API_KEY (same as /v1/knowledge). Every mutation is a POST
 * (the Zoho server-side proxy only issues GET/POST), so update/delete use POST aliases.
 */
export async function scopeRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.apiKeyAuth] };

  // List — by node (?nodeId=...) or, with no nodeId, every node's items for bulk preload.
  app.get('/scope/risks', guard, async (request) => {
    const ctx = requireContext(request);
    const { nodeId } = listQuerySchema.parse(request.query);
    const items = nodeId
      ? await scopeRiskRepo.listByNode(ctx, nodeId)
      : await scopeRiskRepo.listAll(ctx);
    return { items };
  });

  // Create.
  app.post('/scope/risks', guard, async (request, reply) => {
    const ctx = requireContext(request);
    const body = createSchema.parse(request.body);
    const item = await scopeRiskRepo.create(ctx, body);
    void reply.code(201);
    return { item };
  });

  // Bulk delete. (Fastify's router always prefers the static '/delete' segment over the
  // parametric '/:id', regardless of registration order, so 'delete' is never read as an :id.)
  app.post('/scope/risks/delete', guard, async (request) => {
    const ctx = requireContext(request);
    const { ids } = bulkDeleteSchema.parse(request.body);
    const deleted = await scopeRiskRepo.deleteMany(ctx, ids);
    const notFound = ids.filter((id) => !deleted.includes(id));
    return { deleted, notFound };
  });

  // Update (POST alias for PATCH).
  app.post<{ Params: { id: string } }>('/scope/risks/:id', guard, async (request) => {
    const ctx = requireContext(request);
    const patch = updateSchema.parse(request.body);
    const item = await scopeRiskRepo.update(ctx, request.params.id, patch);
    if (!item) throw new NotFoundError(`No scope risk item with id ${request.params.id}`);
    return { item };
  });

  // Delete (POST alias for DELETE).
  app.post<{ Params: { id: string } }>(
    '/scope/risks/:id/delete',
    guard,
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      const ctx = requireContext(request);
      const deleted = await scopeRiskRepo.deleteById(ctx, request.params.id);
      if (!deleted) throw new NotFoundError(`No scope risk item with id ${request.params.id}`);
      return { deleted: true, id: request.params.id };
    },
  );
}
