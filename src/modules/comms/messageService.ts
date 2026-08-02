import { NotFoundError, RBACError, ValidationError } from '../../lib/errors.js';
import { commsMessageRepo } from '../../repos/commsMessageRepo.js';
import { actorZohoUserIdOf, commsThreadRepo } from '../../repos/commsThreadRepo.js';
import { commsThreadMemberRepo } from '../../repos/commsThreadMemberRepo.js';
import { commsTicketEventRepo } from '../../repos/commsTicketEventRepo.js';
import { commsTicketRepo } from '../../repos/commsTicketRepo.js';
import { commsTicketStateRepo } from '../../repos/commsTicketStateRepo.js';
import type { MytrionThread, MytrionThreadMessage } from '../../db/schema/index.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { publishSafely, publishThreadEvent, publishUserEvent } from './publish.js';

/**
 * Replying in a thread — the one write path for conversation, shared by tickets, escalations and (later)
 * DMs.
 *
 * Thread-keyed rather than ticket-keyed on purpose. An escalation's whole ladder talks in ONE thread, so
 * a ticket-keyed reply endpoint would need a second implementation the moment escalations land; keying on
 * the thread means escalations get this for free and there is exactly one place where a message is
 * written, a watcher is joined, and the fan-out happens.
 */

export interface ReplyInput {
  threadId: string;
  body: string;
  /** Internal note: visible to workers, never to a carrier. Rejected on a DM by CHECK constraint. */
  isInternal?: boolean | undefined;
  bodyFormat?: 'text' | 'markdown' | undefined;
  /** Echoed back on the socket frame so an optimistic bubble reconciles on id, not on text. */
  clientMsgId?: string | null | undefined;
  mentions?: string[] | undefined;
}

export interface ReplyResult {
  message: MytrionThreadMessage;
  thread: MytrionThread;
}

/**
 * Post a reply.
 *
 * Order matters and is deliberate:
 *   1. Authorize by READING the thread through the shared gate. A non-member of a non-department thread
 *      gets 404 — the same answer a nonexistent id gets, so a probe learns nothing.
 *   2. Append (which allocates seq under a row lock, so a conversation totally orders).
 *   3. Join the author as a watcher. Must come AFTER the append: `ensureWatcher` is
 *      `onConflictDoNothing`, and the requester/assignee roles must not be touched.
 *   4. Stamp first response, journal, publish — all after the message is durable, and all failure-safe.
 */
export async function postReply(ctx: TenantContext, input: ReplyInput): Promise<ReplyResult> {
  const body = input.body.trim();
  if (body.length === 0) throw new ValidationError('A reply needs text.');

  const actor = actorZohoUserIdOf(ctx);
  if (!actor) throw new RBACError('Replying requires a signed-in worker identity.');

  const thread = await commsThreadRepo.getForReader(ctx, input.threadId);
  if (!thread) throw new NotFoundError('Conversation not found.');
  if (thread.state === 'archived') {
    throw new ValidationError('This conversation is archived and cannot take new messages.');
  }

  const message = await commsMessageRepo.append(ctx, {
    threadId: thread.id,
    body,
    kind: input.isInternal ? 'note' : 'message',
    bodyFormat: input.bodyFormat ?? 'text',
    authorKind: 'worker',
    authorZohoUserId: actor,
    authorName: ctx.userName ?? actor,
    isInternal: input.isInternal ?? false,
    mentions: input.mentions ?? [],
  });

  // A department-queue thread has no member row for the CS agent who picks it up, so without this their
  // own reply would leave the thread showing as unread to them forever.
  await commsThreadMemberRepo.ensureWatcher(ctx, thread.id, {
    memberKind: 'worker',
    memberKey: actor,
    memberName: ctx.userName ?? null,
  });
  // Their own message is read by definition.
  await commsThreadMemberRepo.markRead(
    ctx,
    thread.id,
    { memberKind: 'worker', memberKey: actor },
    message.seq,
  );

  const members = await commsThreadMemberRepo.listByThread(ctx, thread.id);

  // The ticket side: first response and the journal. A thread without a ticket (a future DM) simply has
  // nothing to stamp, which is why this is a lookup and not an assumption.
  const owned = await commsTicketRepo.getByThreadForReader(ctx, thread.id);
  if (owned) {
    const { ticket } = owned;
    // "First response" means someone OTHER than the requester answered, and an internal note is not an
    // answer to anybody. Counting either would make the metric flatter and meaningless.
    const isRequester = ticket.requesterZohoUserId === actor;
    if (!isRequester && !input.isInternal) {
      await commsTicketStateRepo.stampFirstResponse(ctx, ticket.id, message.createdAt);
    }
    await commsTicketEventRepo.append(ctx, {
      ticketId: ticket.id,
      threadId: thread.id,
      eventType: input.isInternal ? 'note_added' : 'commented',
      actorZohoUserId: actor,
      actorName: ctx.userName ?? null,
      detail: { seq: message.seq },
    });
  }

  publishSafely('comms.thread.message', () => {
    publishThreadEvent(
      { id: thread.id, department: thread.department },
      members,
      {
        type: 'comms.thread.message',
        threadId: thread.id,
        seq: message.seq,
        clientMsgId: input.clientMsgId ?? null,
        messageId: message.id,
        isInternal: message.isInternal,
        authorZohoUserId: actor,
        authorName: ctx.userName ?? null,
        // Preview only — the frame is a notification, and the client fetches or already has the body.
        preview: body.slice(0, 160),
        ticketId: owned?.ticket.id ?? null,
      },
      { excludeMemberKey: actor },
    );
  });

  return { message, thread };
}

/**
 * Advance the caller's read watermark.
 *
 * Idempotent and monotonic (the repo's WHERE refuses a lower seq), so two tabs or a replayed frame can
 * never make a thread look unread again. `ensureWatcher` runs first because a department-queue reader may
 * have no member row to advance yet — without it, marking read would be a silent no-op.
 */
export async function markThreadRead(
  ctx: TenantContext,
  threadId: string,
  seq: number,
): Promise<{ seq: number }> {
  const actor = actorZohoUserIdOf(ctx);
  if (!actor) throw new RBACError('Marking read requires a signed-in worker identity.');

  const thread = await commsThreadRepo.getForReader(ctx, threadId);
  if (!thread) throw new NotFoundError('Conversation not found.');

  // Clamp to what exists: a client that has raced ahead must not park the watermark in the future, which
  // would hide the messages that arrive next.
  const target = Math.min(Math.max(Math.trunc(seq), 0), thread.messageCount);

  await commsThreadMemberRepo.ensureWatcher(ctx, threadId, {
    memberKind: 'worker',
    memberKey: actor,
    memberName: ctx.userName ?? null,
  });
  await commsThreadMemberRepo.markRead(
    ctx,
    threadId,
    { memberKind: 'worker', memberKey: actor },
    target,
  );

  // The caller's OWN lane, via publishUserEvent rather than publishThreadEvent — the latter always hits
  // the thread topic first, which would broadcast who-read-what to every participant with the
  // conversation open. A read receipt exists to sync the reader's other tabs; nobody else needs it.
  publishSafely('comms.thread.read', () => {
    publishUserEvent(actor, { type: 'comms.thread.read', threadId, seq: target });
  });

  return { seq: target };
}
