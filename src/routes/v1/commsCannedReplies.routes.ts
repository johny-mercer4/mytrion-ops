/**
 * Canned replies (/v1/comms/canned-replies) — team-shared reply templates.
 *
 * Internal-only. Listing and creating are open to any internal agent (templates are a shared team tool,
 * not client data); deleting is restricted to the template's creator or an admin, so one agent cannot
 * wipe another's. Tenant isolation is the repo's `tenant_id` binding.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { readerOf } from '../../modules/comms/dto.js';
import { NotFoundError, RBACError } from '../../lib/errors.js';
import { commsCannedReplyRepo } from '../../repos/commsCannedReplyRepo.js';
import type { MytrionCannedReply } from '../../db/schema/index.js';
import { requireInternal } from './helpers.js';

const createBody = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(8000),
  department: z.string().max(60).optional(),
});

function toDto(row: MytrionCannedReply): {
  id: string;
  title: string;
  body: string;
  department: string | null;
} {
  return { id: row.id, title: row.title, body: row.body, department: row.department };
}

export async function commsCannedRepliesRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  app.get('/comms/canned-replies', guard, async (request) => {
    const ctx = requireInternal(request, 'Canned replies');
    const q = z.object({ department: z.string().max(60).optional() }).parse(request.query);
    const rows = await commsCannedReplyRepo.list(ctx, q.department ? { department: q.department } : {});
    return { replies: rows.map(toDto) };
  });

  app.post('/comms/canned-replies', guard, async (request, reply) => {
    const ctx = requireInternal(request, 'Canned replies');
    const body = createBody.parse(request.body);
    const created = await commsCannedReplyRepo.create(ctx, {
      title: body.title,
      body: body.body,
      department: body.department ?? null,
      createdByZohoUserId: readerOf(ctx).actorZohoUserId,
    });
    await auditFromContext(ctx, {
      action: 'comms.canned_reply.create',
      status: 'ok',
      resourceType: 'comms_canned_reply',
      resourceId: created.id,
      detail: { title: created.title },
    });
    return reply.code(201).send({ reply: toDto(created) });
  });

  app.delete('/comms/canned-replies/:id', guard, async (request) => {
    const ctx = requireInternal(request, 'Canned replies');
    const { id } = request.params as { id: string };
    const existing = await commsCannedReplyRepo.findById(ctx, id);
    if (!existing) throw new NotFoundError('Canned reply not found.');

    const blanket = ctx.role === 'admin' || ctx.bypassRbac === true || ctx.allDepartmentAccess === true;
    const mine = existing.createdByZohoUserId === readerOf(ctx).actorZohoUserId;
    if (!blanket && !mine) {
      throw new RBACError('Only the author (or an admin) can delete this canned reply.');
    }

    await commsCannedReplyRepo.remove(ctx, id);
    await auditFromContext(ctx, {
      action: 'comms.canned_reply.delete',
      status: 'ok',
      resourceType: 'comms_canned_reply',
      resourceId: id,
      detail: { title: existing.title },
    });
    return { ok: true };
  });
}
