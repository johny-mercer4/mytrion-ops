/**
 * Mytrion Inbox Messages (/v1/inbox/messages) — our own copy of the Zoho CRM inbox (`Org_Module`),
 * replacing the servercrm `crm_inbox_notification` path.
 *
 *  - POST /inbox/messages/webhook  — shared-secret (`x-inbox-secret`) create, called by the Zoho
 *    CRM workflow (repointed from servercrm) and any external caller. Persists a row then pushes a
 *    live event to the owner's `/v1/realtime` topic. Tolerant of Zoho or normalized field casing.
 *  - GET  /inbox/messages          — session-authed, owner-scoped list (admins may View-as another
 *    agent via `?owner_id=`). Feeds the Sales inbox refresh.
 *  - POST /inbox/messages/:id/delete — session-authed, owner-scoped delete.
 *
 * Internal "several places" that raise a notification call `createInboxMessage()` directly instead
 * of POSTing the webhook. Note: `inbox.list` / `inbox.delete_message` touchpoints (Zoho-backed) are
 * now legacy and unused by the app.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { safeEqual } from '../../lib/crypto.js';
import { AppError, AuthError, NotFoundError } from '../../lib/errors.js';
import { audit, auditFromContext } from '../../modules/audit/auditLogger.js';
import { systemContext } from '../../modules/auth/authService.js';
import { createInboxMessage, toInboxMessageDto } from '../../modules/inbox/service.js';
import { resolveZohoUserId } from '../../modules/tools/serverCrmScope.js';
import { mytrionInboxMessageRepo } from '../../repos/mytrionInboxMessageRepo.js';
import { requireContext } from './helpers.js';

const SECRET_HEADER = 'x-inbox-secret';

/** Validated create payload (after normalizing Zoho / normalized casing). Owner + subject required
 *  so an empty `{}` body — which the global parser tolerates — never becomes a silent no-op. */
const webhookSchema = z.object({
  zohoRecordId: z.string().max(64).optional(),
  ownerZohoUserId: z.string().min(1).max(64),
  ownerName: z.string().max(200).optional(),
  ownerEmail: z.string().max(200).optional(),
  subject: z.string().min(1).max(500),
  name: z.string().max(500).optional(),
  content: z.string().max(20000).optional(),
  type: z.string().max(60).optional(),
  priority: z.string().max(30).optional(),
  tag: z.string().max(200).optional(),
  sourceUrl: z.string().max(2000).optional(),
  recordStatus: z.string().max(30).optional(),
  createdTime: z.string().max(60).optional(),
});

const listQuerySchema = z.object({
  owner_id: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/** Read a string-ish field from the raw body under any of the accepted key spellings. */
function pickString(body: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = body[k];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return undefined;
}

/** Zoho sends Owner as a nested lookup object `{ id, name, email }`; internal callers send flat ids. */
function ownerFromBody(body: Record<string, unknown>): {
  id?: string | undefined;
  name?: string | undefined;
  email?: string | undefined;
} {
  const flatId = pickString(body, 'owner_id', 'ownerId', 'Owner_Id', 'ownerZohoUserId');
  const owner = body.Owner;
  if (owner && typeof owner === 'object') {
    const o = owner as { id?: unknown; name?: unknown; email?: unknown };
    const nestedId = typeof o.id === 'string' ? o.id : typeof o.id === 'number' ? String(o.id) : undefined;
    return {
      id: flatId ?? nestedId,
      name: typeof o.name === 'string' ? o.name : undefined,
      email: typeof o.email === 'string' ? o.email : undefined,
    };
  }
  return { id: flatId };
}

export async function inboxMessagesRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  /** Create an inbox message (shared-secret webhook): persist, then push live to the owner's topic. */
  app.post('/inbox/messages/webhook', async (request: FastifyRequest, reply: FastifyReply) => {
    const secret = env.INBOX_WEBHOOK_SECRET;
    if (!secret) {
      throw new AppError('Inbox webhook secret is not configured', {
        statusCode: 503,
        code: 'SERVER_MISCONFIGURED',
      });
    }
    const provided = request.headers[SECRET_HEADER];
    if (typeof provided !== 'string' || !safeEqual(provided, secret)) {
      throw new AuthError('Invalid or missing inbox webhook secret');
    }

    const raw = (request.body ?? {}) as Record<string, unknown>;
    const owner = ownerFromBody(raw);
    const b = webhookSchema.parse({
      zohoRecordId: pickString(raw, 'id', 'recordId', 'zoho_record_id', 'zohoRecordId'),
      ownerZohoUserId: owner.id,
      ownerName: pickString(raw, 'owner_name', 'ownerName', 'Owner_Name') ?? owner.name,
      ownerEmail: pickString(raw, 'owner_email', 'ownerEmail', 'Owner_Email') ?? owner.email,
      subject: pickString(raw, 'subject', 'Subject') ?? pickString(raw, 'name', 'Name'),
      name: pickString(raw, 'name', 'Name'),
      content: pickString(raw, 'content', 'Content'),
      type: pickString(raw, 'type', 'Type', 'notificationType', 'notification_type'),
      priority: pickString(raw, 'priority', 'Priority'),
      tag: pickString(raw, 'tag', 'Tag'),
      sourceUrl: pickString(raw, 'source_url', 'Source_Url', 'sourceUrl'),
      recordStatus: pickString(raw, 'record_status', 'Record_Status__s', 'recordStatus'),
      createdTime: pickString(raw, 'created_time', 'Created_Time', 'eventTime', 'createdTime'),
    });

    const created = b.createdTime ? new Date(b.createdTime) : null;
    const ctx = systemContext(request.id);
    const { message, delivered } = await createInboxMessage(ctx, {
      ownerZohoUserId: b.ownerZohoUserId,
      subject: b.subject,
      content: b.content ?? null,
      type: b.type ?? null,
      priority: b.priority ?? null,
      tag: b.tag ?? null,
      sourceUrl: b.sourceUrl ?? null,
      name: b.name ?? null,
      ownerName: b.ownerName ?? null,
      ownerEmail: b.ownerEmail ?? null,
      zohoRecordId: b.zohoRecordId ?? null,
      recordStatus: b.recordStatus ?? null,
      zohoCreatedAt: created && !Number.isNaN(created.getTime()) ? created : null,
    });

    // Secret-authed webhook (no session ctx) → synthetic system actor.
    await audit({
      tenantId: ctx.tenantId,
      action: 'inbox.message.webhook',
      status: 'ok',
      audience: 'internal',
      userName: 'inbox-webhook',
      resourceType: 'mytrion_inbox_message',
      resourceId: message.zohoRecordId ?? message.id,
      detail: { ownerId: message.ownerZohoUserId, type: message.type, delivered },
      requestId: request.id,
    });
    return reply.code(201).send({ id: message.id, delivered });
  });

  /** List the caller's inbox (owner-scoped; admins may target another agent via ?owner_id). */
  app.get('/inbox/messages', guard, async (request) => {
    const ctx = requireContext(request);
    const query = listQuerySchema.parse(request.query);
    // Non-admins are locked to self; admins/all-department may View-as via ?owner_id (same rule the
    // Data Center / tickets use). resolveZohoUserId throws if the session carries no Zoho id.
    const ownerId = resolveZohoUserId(ctx, query.owner_id);
    const rows = await mytrionInboxMessageRepo.listForOwner(ctx, ownerId, {
      ...(query.limit !== undefined ? { limit: query.limit } : { limit: 200 }),
      ...(query.offset !== undefined ? { offset: query.offset } : {}),
    });
    const messages = rows.map(toInboxMessageDto);
    return { messages, total: messages.length, userId: ownerId };
  });

  /** Delete one message the caller owns (owner-scoped). */
  app.post('/inbox/messages/:id/delete', guard, async (request) => {
    const ctx = requireContext(request);
    const { id } = request.params as { id: string };
    const ownerId = resolveZohoUserId(ctx, (request.query as { owner_id?: string }).owner_id);
    const removed = await mytrionInboxMessageRepo.deleteForOwner(ctx, id, ownerId);
    if (!removed) throw new NotFoundError('Inbox message not found');
    await auditFromContext(ctx, {
      action: 'inbox.message.delete',
      status: 'ok',
      resourceType: 'mytrion_inbox_message',
      resourceId: id,
      detail: { ownerId },
    });
    return { deleted: true, id };
  });
}
