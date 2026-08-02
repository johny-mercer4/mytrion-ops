/**
 * Thread conversation (/v1/comms/threads/:id) — read the messages, reply, mark read.
 *
 * Keyed on the THREAD, not the ticket. An escalation's four-level ladder talks in one thread, and a DM has
 * no ticket at all, so ticket-keyed message routes would need a second copy of this the moment either
 * lands. Authorization is `commsThreadRepo.getForReader` — the same filter the ticket list and the
 * WebSocket subscribe check use, so the three cannot disagree.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { readerOf, toMessageDto, toThreadDto } from '../../modules/comms/dto.js';
import { markThreadRead, postReply } from '../../modules/comms/messageService.js';
import { NotFoundError } from '../../lib/errors.js';
import { commsMessageRepo, type ListMessagesOptions } from '../../repos/commsMessageRepo.js';
import { commsThreadMemberRepo } from '../../repos/commsThreadMemberRepo.js';
import { commsThreadRepo } from '../../repos/commsThreadRepo.js';
import { requireInternal } from './helpers.js';

const messagesQuery = z.object({
  /** Gap-fill after a socket reconnect: everything the client has not seen. */
  after_seq: z.coerce.number().int().min(0).optional(),
  /** Scroll-up paging. */
  before_seq: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const replyBody = z.object({
  body: z.string().min(1).max(8000),
  /** Internal note — workers only. Rejected outright on a DM by CHECK constraint. */
  isInternal: z.boolean().optional(),
  bodyFormat: z.enum(['text', 'markdown']).optional(),
  /** Echoed on the socket frame so an optimistic bubble reconciles on id rather than on text. */
  clientMsgId: z.string().max(120).optional(),
  mentions: z.array(z.string().max(120)).max(50).optional(),
});

const readBody = z.object({ seq: z.number().int().min(0) });

export async function commsThreadsRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  /**
   * A thread's messages, oldest first, plus the participant roster.
   *
   * Opening a department-queue thread joins the reader as a watcher. Without that they hold no member row,
   * so they would have no read state and the thread would read as unread forever — and they would not
   * receive the lane events for it either.
   */
  app.get('/comms/threads/:id/messages', guard, async (request) => {
    const ctx = requireInternal(request, 'Comms conversation');
    const { id } = request.params as { id: string };
    const q = messagesQuery.parse(request.query);

    const thread = await commsThreadRepo.getForReader(ctx, id);
    if (!thread) throw new NotFoundError('Conversation not found.');

    const reader = readerOf(ctx);
    if (reader.actorZohoUserId) {
      await commsThreadMemberRepo.ensureWatcher(ctx, id, {
        memberKind: 'worker',
        memberKey: reader.actorZohoUserId,
        memberName: ctx.userName ?? null,
      });
    }

    const opts: ListMessagesOptions = {};
    if (q.after_seq !== undefined) opts.afterSeq = q.after_seq;
    if (q.before_seq !== undefined) opts.beforeSeq = q.before_seq;
    if (q.limit !== undefined) opts.limit = q.limit;
    // Applied in SQL, not in the DTO: an internal note must not reach the response object at all for a
    // reader who may not see it.
    if (reader.isCustomer) opts.excludeInternal = true;

    const [messages, members] = await Promise.all([
      commsMessageRepo.listByThread(ctx, id, opts),
      commsThreadMemberRepo.listByThread(ctx, id),
    ]);

    return {
      thread: toThreadDto(thread),
      messages: messages.map((m) => toMessageDto(m, reader)),
      participants: members.map((m) => ({
        kind: m.memberKind,
        key: m.memberKey,
        name: m.memberName,
        role: m.role,
        state: m.state,
      })),
    };
  });

  /** Post a reply or an internal note (write — audited). */
  app.post('/comms/threads/:id/messages', guard, async (request, reply) => {
    const ctx = requireInternal(request, 'Comms conversation');
    const { id } = request.params as { id: string };
    const body = replyBody.parse(request.body);

    const result = await postReply(ctx, {
      threadId: id,
      body: body.body,
      isInternal: body.isInternal,
      bodyFormat: body.bodyFormat,
      clientMsgId: body.clientMsgId ?? null,
      mentions: body.mentions,
    });

    await auditFromContext(ctx, {
      action: body.isInternal ? 'comms.thread.note' : 'comms.thread.reply',
      status: 'ok',
      resourceType: 'comms_thread',
      resourceId: id,
      // Length, never the body: audit rows are widely readable and a reply can carry client detail.
      detail: { seq: result.message.seq, length: body.body.length, isInternal: !!body.isInternal },
    });

    return reply.code(201).send({ message: toMessageDto(result.message, readerOf(ctx)) });
  });

  /**
   * Advance the caller's read watermark. Not audited: it is a per-user UI watermark, not a change to
   * anyone else's data, and auditing every thread open would bury the rows that matter.
   */
  app.post('/comms/threads/:id/read', guard, async (request) => {
    const ctx = requireInternal(request, 'Comms conversation');
    const { id } = request.params as { id: string };
    const body = readBody.parse(request.body);
    return markThreadRead(ctx, id, body.seq);
  });

  /** Unread totals across every thread the caller participates in — the sidebar badge, one query. */
  app.get('/comms/unread', guard, async (request) => {
    const ctx = requireInternal(request, 'Comms conversation');
    const reader = readerOf(ctx);
    if (!reader.actorZohoUserId) return { total: 0, threads: [] };
    const rows = await commsThreadMemberRepo.unreadTotals(ctx, {
      memberKind: 'worker',
      memberKey: reader.actorZohoUserId,
    });
    return {
      total: rows.reduce((sum, r) => sum + r.unread, 0),
      threads: rows,
    };
  });
}
