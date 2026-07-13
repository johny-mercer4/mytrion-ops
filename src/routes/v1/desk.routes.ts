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
  getTicketThread,
  getTicketThreads,
  listTicketsByCreator,
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
      // Creator-scoped search is the intended filter (returns ALL of the caller's tickets in one
      // query), but it needs the Desk.search scope. When that scope is missing (SCOPE_MISMATCH), we
      // STILL scope to the caller — `listTicketsByCreator` pages the recent tickets with the
      // cf_crm_created_by_id custom field inline (Desk `fields` param) and keeps only theirs. Both
      // paths are creator-scoped, so `scoped:true`; the fallback is just bounded to a recency window.
      try {
        const tickets = await searchTicketsByCreator(crmUserId, paging);
        return { tickets, scoped: true };
      } catch (err) {
        if (err instanceof Error && /SCOPE_MISMATCH|403/.test(err.message)) {
          const tickets = await listTicketsByCreator(crmUserId, { maxPages: 6 });
          return { tickets, scoped: true, windowed: true };
        }
        throw err;
      }
    } catch (err) {
      throw deskError(err);
    }
  });

  /**
   * One ticket's conversation — the requester↔agent THREADS (the ticket's actual body/replies)
   * plus agent COMMENTS. Auto-created tickets carry their content as a thread, not a comment, so
   * threads alone are what make the pane non-empty. The UI merges + sorts the two by time.
   */
  app.get('/desk/tickets/:id/comments', guard, async (request) => {
    requireSalesAccess(request);
    const { id } = request.params as { id: string };
    const q = commentsQuery.parse(request.query);
    try {
      const [threadList, comments] = await Promise.all([
        getTicketThreads(id, q.limit).catch(() => [] as Record<string, unknown>[]),
        getTicketComments(id, q.limit).catch(() => [] as Record<string, unknown>[]),
      ]);
      // The thread LIST only carries a truncated `summary`; fetch each thread's full `content` in
      // parallel (bounded to the most recent 15) so long messages aren't cut off. Falls back to the
      // summary if the per-thread GET fails.
      const recent = threadList.slice(-15);
      const enriched = await Promise.all(
        recent.map(async (t) => {
          if (typeof t.content === 'string' && t.content) return t;
          try {
            const full = await getTicketThread(id, String(t.id ?? ''));
            return typeof full.content === 'string' && full.content ? { ...t, content: full.content } : t;
          } catch {
            return t;
          }
        }),
      );
      return { threads: enriched, comments };
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
