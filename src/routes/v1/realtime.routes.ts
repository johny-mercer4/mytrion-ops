/**
 * Realtime + Inbox (/v1/realtime, /v1/inbox) — our native WebSocket pub/sub over the
 * inbox_events entity.
 *
 * WS `GET /v1/realtime?token=<jwt|API_KEY>`: browsers can't set headers on a WebSocket
 * handshake, so the token rides a query param and is lifted into the normal auth header
 * before the same `sessionOrApiKey` guard runs. On connect the socket is auto-subscribed
 * to the caller's OWN inbox topic; explicit subscribe/unsubscribe messages may add more,
 * but only admins can watch someone else's topic or the `inbox:all` firehose.
 *
 * REST: create (admin — events are system/automation-generated) persists the row FIRST,
 * then publishes to the owner's topic; list/read are owner-scoped for workers AND carrier
 * clients; delete is admin. Writes are audited.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { NotFoundError, RBACError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import {
  canSubscribe,
  ownTopicOf,
  publishInboxEvent,
  realtimeHub,
} from '../../modules/realtime/hub.js';
import { inboxEventRepo, type InboxEventDto } from '../../repos/inboxEventRepo.js';
import type { InboxOwnerKind } from '../../db/schema/index.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireContext } from './helpers.js';

const PRIORITIES = ['low', 'medium', 'high'] as const;
const OWNER_KINDS = ['worker', 'client'] as const;

const createSchema = z.object({
  priority: z.enum(PRIORITIES).default('medium'),
  tag: z.string().max(120).optional(),
  type: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9_.-]+$/, 'lowercase dot-namespaced slug'),
  owner_kind: z.enum(OWNER_KINDS),
  owner_id: z.union([z.string().min(1).max(120), z.number()]).transform(String),
  title: z.string().min(1).max(300),
  detail: z.string().max(4000).optional(),
});

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  owner_kind: z.enum(OWNER_KINDS).optional(),
  owner_id: z.string().max(120).optional(),
  tag: z.string().max(120).optional(),
  type: z.string().max(120).optional(),
  priority: z.enum(PRIORITIES).optional(),
  unread_only: z.coerce.boolean().optional(),
});

const MAX_TOPICS_PER_SOCKET = 25;
const MAX_WS_MESSAGE_BYTES = 4096;

/** The caller's own inbox identity (worker zoho id / client cu id), from the session only. */
function callerOwner(ctx: TenantContext): { ownerKind: InboxOwnerKind; ownerId: string } | null {
  if (ctx.audience === 'customer' && ctx.userId.startsWith('client:')) {
    return { ownerKind: 'client', ownerId: ctx.userId.slice('client:'.length) };
  }
  if (ctx.audience === 'internal' && ctx.userId.startsWith('zoho:')) {
    return { ownerKind: 'worker', ownerId: ctx.userId.slice('zoho:'.length) };
  }
  return null;
}

function requireAdmin(request: FastifyRequest): TenantContext {
  const ctx = requireContext(request);
  if (ctx.role !== 'admin' && !ctx.bypassRbac) {
    throw new RBACError('This inbox operation requires admin access');
  }
  return ctx;
}

/**
 * Browsers can't set Authorization on the WS handshake — accept `?token=` and present it
 * to the normal guard as a Bearer (a session JWT passes app.authenticate; the raw API_KEY
 * falls through to the api-key check, which accepts it as a Bearer too).
 */
function liftTokenFromQuery(request: FastifyRequest): void {
  if (request.headers.authorization || request.headers['x-api-key']) return;
  const { token } = request.query as { token?: string };
  if (typeof token === 'string' && token.length > 0) {
    request.headers.authorization = `Bearer ${token}`;
  }
}

interface ClientFrame {
  action?: unknown;
  topic?: unknown;
}

export async function realtimeRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };
  const wsGuard = {
    onRequest: [
      async (request: FastifyRequest, reply: FastifyReply) => {
        liftTokenFromQuery(request);
        await app.sessionOrApiKey(request, reply);
      },
    ],
  };

  app.get('/realtime', { ...wsGuard, websocket: true }, (socket, request) => {
    const ctx = requireContext(request);

    const send = (frame: Record<string, unknown>): void => {
      try {
        socket.send(JSON.stringify(frame));
      } catch {
        /* socket already gone; 'close' will clean up */
      }
    };

    // Auto-subscribe the caller to their own feed — a client needs zero protocol to get
    // its events. System identities (API key) have no own topic; they subscribe explicitly.
    const ownTopic = ownTopicOf(ctx);
    if (ownTopic) realtimeHub.subscribe(socket, ownTopic);
    send({ kind: 'hello', ownTopic, role: ctx.role });

    let topicCount = ownTopic ? 1 : 0;

    socket.on('message', (raw) => {
      const text = String(raw);
      if (text.length > MAX_WS_MESSAGE_BYTES) {
        send({ kind: 'error', message: 'Message too large' });
        return;
      }
      let frame: ClientFrame;
      try {
        frame = JSON.parse(text) as ClientFrame;
      } catch {
        send({ kind: 'error', message: 'Frames must be JSON' });
        return;
      }
      const action = typeof frame.action === 'string' ? frame.action : '';
      if (action === 'ping') {
        send({ kind: 'pong' });
        return;
      }
      const topic = typeof frame.topic === 'string' ? frame.topic : '';
      if (action === 'subscribe') {
        if (!canSubscribe(ctx, topic)) {
          send({ kind: 'error', action, topic, message: 'Subscription not allowed' });
          return;
        }
        if (topicCount >= MAX_TOPICS_PER_SOCKET) {
          send({ kind: 'error', action, topic, message: 'Too many topics on this socket' });
          return;
        }
        realtimeHub.subscribe(socket, topic);
        topicCount += 1;
        send({ kind: 'ack', action, topic });
        return;
      }
      if (action === 'unsubscribe') {
        realtimeHub.unsubscribe(socket, topic);
        topicCount = Math.max(0, topicCount - 1);
        send({ kind: 'ack', action, topic });
        return;
      }
      send({ kind: 'error', message: `Unknown action '${action}'` });
    });

    socket.on('close', () => realtimeHub.dropSocket(socket));
    socket.on('error', () => realtimeHub.dropSocket(socket));
  });

  /** Create an inbox event: persist first, then push live to the owner's topic. */
  app.post('/inbox/events', guard, async (request, reply) => {
    const ctx = requireAdmin(request);
    const body = createSchema.parse(request.body);
    const event: InboxEventDto = await inboxEventRepo.create(ctx, {
      priority: body.priority,
      tag: body.tag,
      type: body.type,
      ownerKind: body.owner_kind,
      ownerId: body.owner_id,
      title: body.title,
      detail: body.detail,
    });
    const delivered = publishInboxEvent(event);
    await auditFromContext(ctx, {
      action: 'inbox.event.create',
      status: 'ok',
      resourceType: 'inbox_event',
      resourceId: event.id,
      detail: { type: event.type, ownerKind: event.ownerKind, ownerId: event.ownerId, delivered },
    });
    return reply.code(201).send({ event, delivered });
  });

  /** List events — own feed by default; admins may inspect any owner via filters. */
  app.get('/inbox/events', guard, async (request) => {
    const ctx = requireContext(request);
    const query = listQuerySchema.parse(request.query);
    const isAdmin = ctx.role === 'admin' || ctx.bypassRbac === true;
    let owner = callerOwner(ctx);
    if (isAdmin && query.owner_kind && query.owner_id) {
      owner = { ownerKind: query.owner_kind, ownerId: query.owner_id };
    }
    if (!owner && !isAdmin) {
      throw new RBACError('This session has no inbox identity');
    }
    return inboxEventRepo.list(ctx, {
      ...(owner ? { ownerKind: owner.ownerKind, ownerId: owner.ownerId } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      ...(query.offset !== undefined ? { offset: query.offset } : {}),
      ...(query.tag ? { tag: query.tag } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.unread_only !== undefined ? { unreadOnly: query.unread_only } : {}),
    });
  });

  /** Mark one event read — its owner or an admin. */
  app.post('/inbox/events/:id/read', guard, async (request) => {
    const ctx = requireContext(request);
    const { id } = request.params as { id: string };
    const row = await inboxEventRepo.findById(ctx, id);
    if (!row) throw new NotFoundError('Inbox event not found');
    const owner = callerOwner(ctx);
    const isAdmin = ctx.role === 'admin' || ctx.bypassRbac === true;
    const isOwner = owner && owner.ownerKind === row.ownerKind && owner.ownerId === row.ownerId;
    if (!isAdmin && !isOwner) {
      throw new RBACError('Only the event owner can mark it read');
    }
    const event = await inboxEventRepo.markRead(ctx, id);
    return { event };
  });

  /** Mark the caller's whole feed read. */
  app.post('/inbox/events/read-all', guard, async (request) => {
    const ctx = requireContext(request);
    const owner = callerOwner(ctx);
    if (!owner) throw new RBACError('This session has no inbox identity');
    const updated = await inboxEventRepo.markAllRead(ctx, owner.ownerKind, owner.ownerId);
    await auditFromContext(ctx, {
      action: 'inbox.event.read_all',
      status: 'ok',
      resourceType: 'inbox_event',
      detail: { ownerKind: owner.ownerKind, ownerId: owner.ownerId, updated },
    });
    return { updated };
  });

  /** Delete one event (admin). */
  app.post('/inbox/events/:id/delete', guard, async (request) => {
    const ctx = requireAdmin(request);
    const { id } = request.params as { id: string };
    const removed = await inboxEventRepo.deleteById(ctx, id);
    if (!removed) throw new NotFoundError('Inbox event not found');
    await auditFromContext(ctx, {
      action: 'inbox.event.delete',
      status: 'ok',
      resourceType: 'inbox_event',
      resourceId: id,
    });
    return { deleted: true, id };
  });
}
