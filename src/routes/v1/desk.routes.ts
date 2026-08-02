/**
 * Zoho Desk tickets (/v1/desk) — READ-ONLY HISTORY.
 *
 * Ticketing moved to /v1/comms. Every WRITE here has been removed: creating a ticket, creating an
 * escalation and replying all go through the native path now, and the two Deluge functions those used
 * (`createticketincrm`, `createescalationticket`) are gone with them. Nothing in the Sales UI calls this
 * file any more.
 *
 * What is left is the only route back to tickets that were filed in Zoho Desk BEFORE the migration. There
 * is no history import, so deleting these would make those tickets unreachable from the app entirely — a
 * product decision, not a cleanup. Delete this file once that history is either imported or accepted as
 * lost.
 *
 * Identity stays session-authoritative: the list is scoped to the caller's own CRM user id
 * (cf_crm_created_by_id) via resolveZohoUserId; an admin may pass ?zoho_user_id to view another agent's.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import {
  getTicket,
  getTicketAttachmentContent,
  getTicketAttachments,
  getTicketComments,
  getTicketThread,
  getTicketThreads,
  pageTicketsByCreator,
  searchTicketsByCreator,
} from '../../integrations/zohoDesk.js';
import { assertTicketOwned } from '../../modules/tools/deskScope.js';
import { enrichTicketOwners } from '../../modules/tools/deskOwners.js';
import { resolveZohoUserId } from '../../modules/tools/serverCrmScope.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment } from './helpers.js';

/** Sales/admin gate (internal audience only, session-authoritative departments). */
function requireSalesAccess(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'sales', 'Desk tickets');
}

const listQuery = z.object({
  zoho_user_id: z.string().max(120).optional(),
  // Desk search accepts from=0 (zoho-octane ticketdashboard.html); list endpoints use 1-based.
  from: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(99).optional(),
});
const commentsQuery = z.object({ limit: z.coerce.number().int().min(1).max(99).optional() });



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
    const from = q.from ?? 0;
    const limit = q.limit ?? 20;
    const paging = { from, limit };
    try {
      // Reference ticketdashboard.html: /tickets/search?customField1=cf_crm_created_by_id:&from&limit
      // Needs Desk.search.READ. Without it we progressively scan /tickets and filter by creator so
      // Load more still returns the next 20 (scoped:false warns the UI).
      try {
        const tickets = await searchTicketsByCreator(crmUserId, paging);
        return {
          tickets: await enrichTicketOwners(tickets),
          scoped: true,
          windowed: false,
          hasMore: tickets.length >= limit,
          nextFrom: from + limit,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (/SCOPE_MISMATCH|403|422|UNPROCESSABLE|INVALID_/.test(msg)) {
          const page = await pageTicketsByCreator(crmUserId, paging);
          return {
            tickets: await enrichTicketOwners(page.tickets),
            scoped: false,
            windowed: true,
            hasMore: page.hasMore,
            nextFrom: from + page.tickets.length,
          };
        }
        throw err;
      }
    } catch (err) {
      throw deskError(err);
    }
  });

  /**
   * One ticket by id — used when a live WS comment lands on an older ticket that isn't in the
   * progressive list pages yet. Ownership-gated the same as comments/reply.
   */
  app.get('/desk/tickets/:id', guard, async (request) => {
    const ctx = requireSalesAccess(request);
    const { id } = request.params as { id: string };
    try {
      await assertTicketOwned(ctx, id);
      const raw = await getTicket(id);
      const [ticket] = await enrichTicketOwners([raw]);
      return { ticket };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw deskError(err);
    }
  });

  /**
   * One ticket's conversation — the requester↔agent THREADS (the ticket's actual body/replies),
   * agent COMMENTS, and the ticket's Attachments-tab ATTACHMENTS (files that live on the ticket
   * itself, not tied to any one comment/thread — the only way a file added straight to Desk's
   * Attachments tab, or sent from Mytrion via uploadTicketAttachment, reaches the conversation).
   * Auto-created tickets carry their content as a thread, not a comment, so threads alone are what
   * make the pane non-empty. The UI merges + sorts all three by time.
   */
  app.get('/desk/tickets/:id/comments', guard, async (request) => {
    const ctx = requireSalesAccess(request);
    const { id } = request.params as { id: string };
    const q = commentsQuery.parse(request.query);
    try {
      await assertTicketOwned(ctx, id);
      const [threadList, comments, attachments] = await Promise.all([
        getTicketThreads(id, q.limit).catch(() => [] as Record<string, unknown>[]),
        getTicketComments(id, q.limit).catch(() => [] as Record<string, unknown>[]),
        getTicketAttachments(id, q.limit).catch(() => [] as Record<string, unknown>[]),
      ]);
      // The thread LIST only carries a truncated `summary`; fetch each thread's full `content` in
      // parallel so long customer emails / replies aren't cut off. Only the most recent threads get
      // hydrated — each hydration is a separate Zoho GET, so an unbounded fan-out (a long-running
      // ticket can have dozens of threads) is what made opening a ticket slow. Older threads keep
      // their summary; the pane still shows them, just not the fully-expanded body.
      const THREAD_HYDRATE_WINDOW = 15;
      const recent = threadList.slice(-THREAD_HYDRATE_WINDOW);
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
      // Preserve older threads that weren't expanded (still show their summary).
      const enrichedIds = new Set(enriched.map((t) => String(t.id ?? '')));
      const older = threadList.filter((t) => !enrichedIds.has(String(t.id ?? '')));
      const threadsOut = [...older, ...enriched];
      // Flag the caller's OWN comments/attachments — those posted via the app's shared Desk agent —
      // so the UI right-aligns them as "me" (the reference matches commenter/creator to a fixed
      // zohoDeskAdminId).
      const agentId = env.ZOHO_DESK_AGENT_ID;
      const flagged = comments.map((c) => ({ ...c, mine: String(c.commenterId ?? '') === agentId }));
      const flaggedAttachments = attachments.map((a) => ({ ...a, mine: String(a.creatorId ?? '') === agentId }));
      return { threads: threadsOut, comments: flagged, attachments: flaggedAttachments };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw deskError(err);
    }
  });

  /** Download a ticket attachment's bytes (proxies Desk with the org token; auth + sales-gated). */
  app.get('/desk/tickets/:id/attachments/:attId/content', guard, async (request, reply) => {
    const ctx = requireSalesAccess(request);
    const { id, attId } = request.params as { id: string; attId: string };
    try {
      await assertTicketOwned(ctx, id);
      const { buffer, contentType } = await getTicketAttachmentContent(id, attId);
      return await reply.header('Content-Type', contentType).header('Content-Disposition', 'attachment').send(buffer);
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw deskError(err);
    }
  });

}
