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
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import {
  createDeskTicket,
  DESK_DEPARTMENTS,
  getTicketAttachmentContent,
  getTicketComments,
  getTicketThread,
  getTicketThreads,
  listTicketsByCreator,
  postTicketComment,
  searchTicketsByCreator,
  uploadDeskFile,
} from '../../integrations/zohoDesk.js';
import { dispatchTouchpoint } from '../../modules/touchpoints/dispatcher.js';
import { assertTicketOwned } from '../../modules/tools/deskScope.js';
import { resolveZohoUserId } from '../../modules/tools/serverCrmScope.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment } from './helpers.js';

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20 MB (matches the widget)

/** Collect a mixed multipart body (form fields + one optional file) into a plain shape. */
async function readMultipart(
  request: FastifyRequest,
): Promise<{ fields: Record<string, string>; file: { name: string; mime: string; buffer: Buffer } | null }> {
  const fields: Record<string, string> = {};
  let file: { name: string; mime: string; buffer: Buffer } | null = null;
  for await (const part of request.parts({ limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 } })) {
    if (part.type === 'file') {
      const buffer = await part.toBuffer();
      file = {
        name: part.filename || 'attachment',
        mime: part.mimetype || 'application/octet-stream',
        buffer,
      };
    } else {
      fields[part.fieldname] = typeof part.value === 'string' ? part.value : String(part.value ?? '');
    }
  }
  return { fields, file };
}

/** Sales/admin gate (internal audience only, session-authoritative departments). */
function requireSalesAccess(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'sales', 'Desk tickets');
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

const createTicketFields = z.object({
  department: z.enum(['cs', 'billing', 'verification', 'maintenance']),
  ticketType: z.string().min(1).max(120),
  dealId: z.string().min(1).max(60),
  subject: z.string().min(1).max(300),
  description: z.string().min(1).max(8000),
  carrierId: z.string().max(60).optional(),
  applicationId: z.string().max(60).optional(),
  cardNumber: z.string().max(60).optional(),
  contactName: z.string().max(200).optional(),
  accountName: z.string().max(200).optional(),
  email: z.string().max(200).optional(),
  phone: z.string().max(60).optional(),
  submitterName: z.string().max(200).optional(),
});

const createEscalationFields = z.object({
  subject: z.string().min(1).max(300),
  description: z.string().min(1).max(8000),
  reason: z.string().min(1).max(120),
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
    const ctx = requireSalesAccess(request);
    const { id } = request.params as { id: string };
    const q = commentsQuery.parse(request.query);
    try {
      await assertTicketOwned(ctx, id);
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
      // Flag the caller's OWN comments — those posted via the app's shared Desk agent — so the UI
      // right-aligns them as "me" (the reference matches commenterId to a fixed zohoDeskAdminId).
      const agentId = env.ZOHO_DESK_AGENT_ID;
      const flagged = comments.map((c) => ({ ...c, mine: String(c.commenterId ?? '') === agentId }));
      return { threads: enriched, comments: flagged };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw deskError(err);
    }
  });

  /**
   * Post an agent reply (write — audited). Accepts JSON `{content,is_public}` OR multipart
   * (`content` + `is_public` fields + an optional file). A file is uploaded to Desk (`/uploads`)
   * and attached to the comment via `attachmentIds`.
   */
  app.post('/desk/tickets/:id/reply', guard, async (request) => {
    const ctx = requireSalesAccess(request);
    const { id } = request.params as { id: string };
    const isMultipart = String(request.headers['content-type'] ?? '').includes('multipart/form-data');
    let content = '';
    let isPublic = true;
    let file: { name: string; mime: string; buffer: Buffer } | null = null;
    if (isMultipart) {
      const mp = await readMultipart(request);
      content = (mp.fields.content ?? '').trim();
      isPublic = mp.fields.is_public !== 'false';
      file = mp.file;
    } else {
      const body = replyBody.parse(request.body);
      content = body.content;
      isPublic = body.is_public ?? true;
    }
    if (!content && !file) {
      throw new AppError('Reply needs text or a file', { statusCode: 400, code: 'VALIDATION_ERROR', expose: true });
    }
    try {
      await assertTicketOwned(ctx, id);
      const attachmentIds: string[] = [];
      if (file) attachmentIds.push(await uploadDeskFile(file.buffer, file.name, file.mime));
      // A Desk comment must carry content — caption a file-only reply.
      const text = content || `📎 ${file?.name ?? 'attachment'}`;
      const comment = await postTicketComment(id, text, isPublic, attachmentIds);
      await auditFromContext(ctx, {
        action: 'desk.ticket.reply',
        status: 'ok',
        resourceType: 'desk_ticket',
        resourceId: id,
        detail: { length: text.length, isPublic, hasAttachment: !!file },
      });
      return { comment };
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

  /**
   * Create a support ticket (multipart: form fields + optional attachment). Orchestrates the widget
   * flow server-side: create the Desk ticket (inline contact — no search scope needed) → mirror into
   * the CRM Tickets module → if a file is attached, upload it to the Deal and hand it to the ticket.
   * The ticket is stamped with the caller's CRM user id so it appears in their own ticket list.
   */
  app.post('/desk/tickets', guard, async (request) => {
    const ctx = requireSalesAccess(request);
    const { fields, file } = await readMultipart(request);
    const f = createTicketFields.parse(fields);
    const crmUserId = resolveZohoUserId(ctx);
    try {
      const deskTicketId = await createDeskTicket({
        subject: `CRM Ticket: ${f.subject}`,
        description: f.description,
        departmentId: DESK_DEPARTMENTS[f.department],
        channel: 'Ticket Form',
        contact: {
          lastName: f.contactName || f.accountName || 'Customer',
          email: f.email,
          phone: f.phone,
        },
        cf: {
          cf_ticket_type: f.ticketType,
          cf_crm_created_by_id: crmUserId,
          cf_deal_id: f.dealId,
          cf_submitted_by: f.submitterName,
          cf_carrier_id_application_id: f.carrierId || f.applicationId,
          cf_card_number: f.cardNumber,
        },
      });
      const warnings: string[] = [];
      let attached = false;
      // Mirror into the CRM Tickets module (best-effort — the Desk ticket already exists).
      await dispatchTouchpoint(ctx, 'tickets.create_in_crm', {
        subject: f.subject,
        dealId: f.dealId,
        deskTicketId,
      }).catch((e: unknown) => warnings.push(`crm-link: ${e instanceof Error ? e.message : 'failed'}`));
      // Attachment: upload the file to Desk and hand it onto the NEW ticket as a comment attachment —
      // the same working path the conversation reply uses (real-dept tickets accept it). Best-effort:
      // the ticket already exists, so we never fail the create over an attachment hiccup.
      if (file) {
        try {
          const uploadId = await uploadDeskFile(file.buffer, file.name, file.mime);
          await postTicketComment(deskTicketId, `📎 ${file.name}`, true, [uploadId]);
          attached = true;
        } catch (e) {
          warnings.push(`attachment: ${e instanceof Error ? e.message : 'failed'}`);
        }
      }
      await auditFromContext(ctx, {
        action: 'desk.ticket.create',
        status: 'ok',
        resourceType: 'desk_ticket',
        resourceId: deskTicketId,
        detail: { department: f.department, ticketType: f.ticketType, dealId: f.dealId, attached, warnings },
      });
      return { ticketId: deskTicketId, attached };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw deskError(err);
    }
  });

  /**
   * Create an escalation request (multipart: fields + optional attachment). Runs the
   * `createescalationticket` Deluge (which builds the Escalation_Request record + Desk ticket), then
   * uploads any attachment to the escalation record and hands it to the ticket.
   */
  app.post('/desk/escalations', guard, async (request) => {
    const ctx = requireSalesAccess(request);
    const { fields, file } = await readMultipart(request);
    const f = createEscalationFields.parse(fields);
    try {
      const res = await dispatchTouchpoint(ctx, 'tickets.create_escalation', {
        escalationReason: f.reason,
        questionSubject: f.subject,
        description: f.description,
        attachmentUrl: '',
      });
      const out = (res.data ?? {}) as { ticketId?: string | number; escalationId?: string | number; message?: string };
      const ticketId = out.ticketId ? String(out.ticketId) : '';
      const escalationId = out.escalationId ? String(out.escalationId) : '';
      if (!ticketId || !escalationId) {
        throw new AppError(out.message || 'Escalation was not created — no ids returned.', {
          statusCode: 502,
          code: 'ZOHO_ESCALATION_ERROR',
          expose: true,
        });
      }
      const warnings: string[] = [];
      let attached = false;
      // Attach the file onto the escalation's Desk ticket (the returned ticketId) as a comment
      // attachment — the reliable path. Best-effort: the escalation already exists.
      if (file) {
        try {
          const uploadId = await uploadDeskFile(file.buffer, file.name, file.mime);
          await postTicketComment(ticketId, `📎 ${file.name}`, true, [uploadId]);
          attached = true;
        } catch (e) {
          warnings.push(`attachment: ${e instanceof Error ? e.message : 'failed'}`);
        }
      }
      await auditFromContext(ctx, {
        action: 'desk.escalation.create',
        status: 'ok',
        resourceType: 'desk_ticket',
        resourceId: ticketId,
        detail: { reason: f.reason, escalationId, attached, warnings },
      });
      return { ticketId, escalationId, attached };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw deskError(err);
    }
  });
}
