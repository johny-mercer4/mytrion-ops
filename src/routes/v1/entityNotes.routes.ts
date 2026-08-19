/**
 * Entity notes (/v1/entity-notes) — polymorphic user notes attached to any module record.
 * Reads and writes require an active session; tenant scope is enforced in the repo.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { entityNotesRepo } from '../../repos/entityNotesRepo.js';
import { requireContext } from './helpers.js';

const ENTITY_TYPES = [
  'retention_case',
  'worker_task',
  'maintenance_case',
  'verification_case',
] as const;

const listQuerySchema = z.object({
  entity_type: z.enum(ENTITY_TYPES),
  entity_id: z.string().max(200),
});

const createSchema = z.object({
  entity_type: z.enum(ENTITY_TYPES),
  entity_id: z.string().max(200),
  content: z.string().min(1).max(10000),
  author_name: z.string().max(200).optional(),
});

export async function entityNotesRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  app.get('/entity-notes', guard, async (request) => {
    const ctx = requireContext(request);
    const query = listQuerySchema.parse((request as unknown as { query: unknown }).query);
    const notes = await entityNotesRepo.list(ctx, query.entity_type, query.entity_id);
    return { notes };
  });

  app.post('/entity-notes', guard, async (request, reply) => {
    const ctx = requireContext(request);
    const body = createSchema.parse((request as unknown as { body: unknown }).body);
    const authorZohoUserId = ctx.userId.startsWith('zoho:')
      ? ctx.userId.slice('zoho:'.length)
      : null;
    const note = await entityNotesRepo.insert(ctx, {
      entityType: body.entity_type,
      entityId: body.entity_id,
      content: body.content,
      authorZohoUserId,
      authorName: body.author_name ?? null,
    });
    return reply.status(201).send({ note });
  });

  app.delete('/entity-notes/:id', guard, async (request, reply) => {
    const ctx = requireContext(request);
    const { id } = z
      .object({ id: z.string().max(200) })
      .parse((request as unknown as { params: unknown }).params);
    const deleted = await entityNotesRepo.delete(ctx, id);
    if (!deleted) return reply.status(404).send({ error: 'Note not found' });
    return reply.status(204).send();
  });
}
