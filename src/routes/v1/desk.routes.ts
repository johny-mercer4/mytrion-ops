/**
 * Zoho Desk tickets for the Sales Mytrion (/v1/desk) — the ticket dashboard's list +
 * conversation + reply, backed by the org's Desk (auth + orgId from the Zoho wrapper).
 *
 * Identity is session-authoritative: the ticket list is scoped to the caller's own CRM
 * user id (cf_crm_created_by_id) via resolveZohoUserId — a non-admin can only see their
 * own tickets; an admin (or act-as) may pass ?zoho_user_id to view another agent's.
 * Reads require the sales department (or admin); posting a reply is a write and is audited.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, RBACError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import {
  getTicketComments,
  listTickets,
  postTicketComment,
  searchTicketsByCreator,
} from '../../integrations/zohoDesk.js';
import { resolveZohoUserId } from '../../modules/tools/serverCrmScope.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireContext, withDepartmentAccess } from './helpers.js';

/** Sales/admin gate (internal audience only) — mirrors the touchpoints department gate. */
function requireSalesAccess(request: FastifyRequest): TenantContext {
  const base = requireContext(request);
  if (base.audience !== 'internal') throw new RBACError('Desk tickets are internal-only');
  const ctx = withDepartmentAccess(base, request);
  const ok =
    ctx.role === 'admin' ||
    ctx.bypassRbac === true ||
    ctx.allDepartmentAccess ||
    ctx.departments.includes('sales');
  if (!ok) throw new RBACError('Desk tickets require sales department access');
  return ctx;
}

const listQuery = z.object({
  zoho_user_id: z.string().max(120).optional(),
  from: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(99).optional(),
});
const commentsQuery = z.object({ limit: z.coerce.number().int().min(1).max(99).optional() });
const replyBody = z.object({
  content: z.string().min(1).max(8000),
  is_public: z.boolean().optional(),
});

function deskError(err: unknown): AppError {
  return new AppError('Zoho Desk request failed', {
    statusCode: 502,
    code: 'ZOHO_DESK_ERROR',
    cause: err,
    expose: true,
  });
}

export async function deskRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  /** The caller's own Desk tickets (admins may target another agent via ?zoho_user_id). */
  app.get('/desk/tickets', guard, async (request) => {
    const ctx = requireSalesAccess(request);
    const q = listQuery.parse(request.query);
    const crmUserId = resolveZohoUserId(ctx, q.zoho_user_id);
    const paging = {
      ...(q.from !== undefined ? { from: q.from } : {}),
      ...(q.limit !== undefined ? { limit: q.limit } : {}),
    };
    try {
      // Creator-scoped search is the intended filter, but it needs the Desk.search scope on the
      // OAuth token. When that scope is missing (SCOPE_MISMATCH), fall back to the recent-tickets
      // list so the dashboard still shows real data — flagged via `scoped:false`.
      try {
        const tickets = await searchTicketsByCreator(crmUserId, paging);
        return { tickets, scoped: true };
      } catch (err) {
        if (err instanceof Error && /SCOPE_MISMATCH|403/.test(err.message)) {
          const tickets = await listTickets({ limit: q.limit ?? 50 });
          return { tickets, scoped: false };
        }
        throw err;
      }
    } catch (err) {
      throw deskError(err);
    }
  });

  /** One ticket's conversation. */
  app.get('/desk/tickets/:id/comments', guard, async (request) => {
    requireSalesAccess(request);
    const { id } = request.params as { id: string };
    const q = commentsQuery.parse(request.query);
    try {
      const comments = await getTicketComments(id, q.limit);
      return { comments };
    } catch (err) {
      throw deskError(err);
    }
  });

  /** Post an agent reply (write — audited). POST alias only (Zoho-proxy-safe). */
  app.post('/desk/tickets/:id/reply', guard, async (request) => {
    const ctx = requireSalesAccess(request);
    const { id } = request.params as { id: string };
    const body = replyBody.parse(request.body);
    try {
      const comment = await postTicketComment(id, body.content, body.is_public ?? true);
      await auditFromContext(ctx, {
        action: 'desk.ticket.reply',
        status: 'ok',
        resourceType: 'desk_ticket',
        resourceId: id,
        detail: { length: body.content.length, isPublic: body.is_public ?? true },
      });
      return { comment };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw deskError(err);
    }
  });
}
