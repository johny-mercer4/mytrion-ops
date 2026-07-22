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
import { AppError, RBACError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import {
  createDeskTicket,
  DESK_DEPARTMENTS,
  getTicket,
  getTicketAttachmentContent,
  getTicketAttachments,
  getTicketComments,
  getTicketThread,
  getTicketThreads,
  pageTicketsByCreator,
  postTicketComment,
  searchTicketsByCreator,
  uploadTicketAttachment,
} from '../../integrations/zohoDesk.js';
import { attachFileToRecord } from '../../integrations/zohoCrm.js';
import { fetchDealOwnerId } from '../../integrations/salesDataCenter.js';
import { dispatchTouchpoint } from '../../modules/touchpoints/dispatcher.js';
import { assertTicketOwned } from '../../modules/tools/deskScope.js';
import { enrichTicketOwners } from '../../modules/tools/deskOwners.js';
import { resolveZohoUserId } from '../../modules/tools/serverCrmScope.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment } from './helpers.js';

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20 MB (matches the widget)

type UploadFile = { name: string; mime: string; buffer: Buffer };

/** Collect a mixed multipart body (form fields + one optional file) into a plain shape. */
async function readMultipart(
  request: FastifyRequest,
): Promise<{ fields: Record<string, string>; file: UploadFile | null }> {
  const fields: Record<string, string> = {};
  let file: UploadFile | null = null;
  try {
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
  } catch (err) {
    // Fastify throws when the fileSize limit is exceeded — surface a clean 413, not a raw 500.
    if (err instanceof Error && /file too large|FST_REQ_FILE_TOO_LARGE|request file too large/i.test(err.message)) {
      throw new AppError('Attachment exceeds the 20MB limit.', {
        statusCode: 413,
        code: 'ATTACHMENT_TOO_LARGE',
        expose: true,
      });
    }
    throw err;
  }
  return { fields, file };
}

/**
 * Prefer Desk's Attachments tab; if the Desk token lacks attachment scope (403), land the file on
 * the linked CRM record so the agent still has it (widget-parity fallback).
 */
async function attachCreateFile(opts: {
  deskTicketId: string;
  file: UploadFile;
  crmModule: 'Deals' | 'Escalation_Request';
  crmRecordId: string;
  warnings: string[];
}): Promise<boolean> {
  try {
    await uploadTicketAttachment(
      opts.deskTicketId,
      opts.file.buffer,
      opts.file.name,
      opts.file.mime,
      true,
    );
    return true;
  } catch (deskErr) {
    opts.warnings.push(
      `desk-attachment: ${deskErr instanceof Error ? deskErr.message : 'failed'}`,
    );
    if (!opts.crmRecordId) return false;
    try {
      await attachFileToRecord(
        opts.crmModule,
        opts.crmRecordId,
        opts.file.name,
        opts.file.buffer,
        opts.file.mime,
      );
      opts.warnings.push(`attachment: saved on CRM ${opts.crmModule} (Desk upload unavailable)`);
      return true;
    } catch (crmErr) {
      opts.warnings.push(`crm-attachment: ${crmErr instanceof Error ? crmErr.message : 'failed'}`);
      return false;
    }
  }
}

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
const replyBody = z.object({
  content: z.string().min(1).max(8000),
  is_public: z.boolean().optional(),
});

const createTicketFields = z.object({
  department: z.enum(['cs', 'billing', 'verification', 'maintenance']),
  ticketType: z.string().min(1).max(120),
  // CRM record ids are numeric strings — enforced here AND in fetchDealOwnerId (COQL safety).
  dealId: z.string().regex(/^\d+$/, 'dealId must be a CRM record id').max(60),
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
      // parallel so long customer emails / replies aren't cut off (reference loads comments with
      // limit 100 — match that window). Falls back to the summary if the per-thread GET fails.
      const recent = threadList.slice(-40);
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

  /**
   * Post an agent reply (write — audited). Accepts JSON `{content,is_public}` OR multipart
   * (`content` + `is_public` fields + an optional file). Text becomes a comment; a file goes
   * straight to the ticket's Attachments tab (uploadTicketAttachment) — NOT a comment attachment —
   * so it shows up where Desk agents actually look for it. The two are independent: a reply may
   * carry either, or both.
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
      // Text + file are independent Desk calls — run together when both are present.
      const [comment] = await Promise.all([
        content ? postTicketComment(id, content, isPublic) : Promise.resolve(undefined),
        file
          ? uploadTicketAttachment(id, file.buffer, file.name, file.mime, isPublic)
          : Promise.resolve(undefined),
      ]);
      await auditFromContext(ctx, {
        action: 'desk.ticket.reply',
        status: 'ok',
        resourceType: 'desk_ticket',
        resourceId: id,
        detail: { length: content.length, isPublic, hasAttachment: !!file },
      });
      return { comment, attached: !!file };
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
   * the CRM Tickets module → attach file to Desk (CRM Deal fallback if Desk attachment scope fails).
   * The ticket is stamped with the caller's CRM user id so it appears in their own ticket list.
   */
  app.post('/desk/tickets', guard, async (request) => {
    const ctx = requireSalesAccess(request);
    const { fields, file } = await readMultipart(request);
    const f = createTicketFields.parse(fields);
    const crmUserId = resolveZohoUserId(ctx);
    // dealId is caller-supplied — a non-admin may only file tickets on their OWN deals.
    if (!ctx.allDepartmentAccess && !ctx.bypassRbac) {
      const dealOwnerId = await fetchDealOwnerId(f.dealId).catch(() => {
        throw deskError(new Error('Deal ownership check failed'));
      });
      if (dealOwnerId !== crmUserId) {
        await auditFromContext(ctx, {
          action: 'desk.ticket.create',
          status: 'denied',
          resourceType: 'crm_deal',
          resourceId: f.dealId,
          detail: { reason: 'deal not owned by caller', dealOwnerId },
        });
        throw new RBACError('This deal is not yours — you can only file tickets on your own deals.');
      }
    }
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
          cf_submitted_by: f.submitterName ?? ctx.userName,
          cf_carrier_id_application_id: f.carrierId || f.applicationId,
          cf_card_number: f.cardNumber,
        },
      });
      const warnings: string[] = [];
      // Mirror into the CRM Tickets module (best-effort — the Desk ticket already exists).
      await dispatchTouchpoint(ctx, 'tickets.create_in_crm', {
        subject: f.subject,
        dealId: f.dealId,
        deskTicketId,
      }).catch((e: unknown) => warnings.push(`crm-link: ${e instanceof Error ? e.message : 'failed'}`));
      const attached = file
        ? await attachCreateFile({
            deskTicketId,
            file,
            crmModule: 'Deals',
            crmRecordId: f.dealId,
            warnings,
          })
        : false;
      await auditFromContext(ctx, {
        action: 'desk.ticket.create',
        status: 'ok',
        resourceType: 'desk_ticket',
        resourceId: deskTicketId,
        detail: { department: f.department, ticketType: f.ticketType, dealId: f.dealId, attached, warnings },
      });
      return { ticketId: deskTicketId, attached, warnings };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw deskError(err);
    }
  });

  /**
   * Create an escalation request (multipart: fields + optional attachment). Runs the
   * `createescalationticket` Deluge (Escalation_Request + Desk ticket), then attaches any file
   * to Desk (CRM Escalation_Request fallback if Desk attachment scope fails).
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
      const attached = file
        ? await attachCreateFile({
            deskTicketId: ticketId,
            file,
            crmModule: 'Escalation_Request',
            crmRecordId: escalationId,
            warnings,
          })
        : false;
      await auditFromContext(ctx, {
        action: 'desk.escalation.create',
        status: 'ok',
        resourceType: 'desk_ticket',
        resourceId: ticketId,
        detail: { reason: f.reason, escalationId, attached, warnings },
      });
      return { ticketId, escalationId, attached, warnings };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw deskError(err);
    }
  });
}
