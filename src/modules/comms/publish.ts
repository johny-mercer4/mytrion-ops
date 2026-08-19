import { logger } from '../../lib/logger.js';
import { commsQueueTopic, commsThreadTopic, commsUserTopic, realtimeHub } from '../realtime/hub.js';
import type { MytrionThread, MytrionThreadMember } from '../../db/schema/index.js';

/**
 * The single place that decides who gets told what.
 *
 * Every comms notification goes through this module, so "did the requester get told?" has one answer
 * to audit instead of one per call site — which is how a publish path quietly forgets a recipient.
 *
 * DELIBERATELY NOT `publishInboxEvent`. That helper double-publishes to the admin `inbox:all`
 * firehose, so routing chat through it would put every message in the company on one topic. Durable
 * inbox_events rows are for workflow events (assigned, escalated, closed, SLA breach) and mentions —
 * never for ordinary conversation. The unread badge does not need them: it derives from
 * mytrion_thread_members.last_message_at vs last_read_seq, which is durable on its own.
 */

/** Dot-namespaced so a client can subscribe by prefix. These two drive the live widget. */
export type CommsEventType =
  | 'comms.thread.message'
  | 'comms.thread.attachment'
  | 'comms.thread.read'
  | 'comms.thread.mention'
  | 'comms.ticket.created'
  | 'comms.ticket.assigned'
  | 'comms.ticket.status_changed'
  | 'comms.ticket.priority_changed'
  | 'comms.ticket.tagged'
  | 'comms.ticket.closed'
  | 'comms.ticket.reopened'
  | 'comms.escalation.raised'
  | 'comms.escalation.advanced'
  | 'comms.escalation.handed_off'
  | 'comms.escalation.resolved';

export interface CommsEventPayload {
  type: CommsEventType;
  threadId: string;
  /** Message sequence, when the event concerns one. Lets a client detect a gap and refetch the tail. */
  seq?: number;
  /** Echoed back so an optimistic bubble can be reconciled instead of matched on text. */
  clientMsgId?: string | null;
  [extra: string]: unknown;
}

interface FanOutResult {
  /** Sockets reached on the thread topic — i.e. people with the conversation open. */
  thread: number;
  /** Sockets reached across recipients' own lanes. */
  lanes: number;
}

/**
 * Publish to the thread's live feed AND to each other participant's own lane.
 *
 * Both halves are needed and neither is redundant: the thread topic serves whoever has the
 * conversation open (this is what renders a message instantly), while the lane carries the badge and
 * toast for participants who are looking at something else entirely — which per-thread subscriptions
 * structurally cannot deliver, since those people are not subscribed to that thread.
 */
export function publishThreadEvent(
  thread: Pick<MytrionThread, 'id' | 'department'>,
  members: Pick<MytrionThreadMember, 'memberKind' | 'memberKey' | 'state' | 'notify'>[],
  payload: CommsEventPayload,
  opts: { excludeMemberKey?: string | null; alsoQueue?: boolean } = {},
): FanOutResult {
  const frame = { kind: 'comms' as const, topic: commsThreadTopic(thread.id), ...payload };
  const threadDelivered = realtimeHub.publishFrame(frame.topic, frame);

  let lanes = 0;
  for (const member of members) {
    if (member.state === 'left' || member.notify === 'none') continue;
    // Only workers have a comms lane; a carrier is reached over the mini-app topic instead.
    if (member.memberKind !== 'worker') continue;
    // The author already rendered their own message optimistically.
    if (opts.excludeMemberKey && member.memberKey === opts.excludeMemberKey) continue;
    const topic = commsUserTopic(member.memberKey);
    lanes += realtimeHub.publishFrame(topic, { kind: 'comms', topic, ...payload });
  }

  if (opts.alsoQueue && thread.department) {
    const topic = commsQueueTopic(thread.department);
    realtimeHub.publishFrame(topic, { kind: 'comms', topic, ...payload });
  }

  return { thread: threadDelivered, lanes };
}

/**
 * Queue-level event for a department board (a ticket created, assigned, closed).
 *
 * A delivery count of zero is a normal outcome — nobody happens to have the queue open — and never an
 * error: the row is already committed and will surface on the next fetch.
 */
export function publishQueueEvent(department: string, payload: CommsEventPayload): number {
  const topic = commsQueueTopic(department);
  return realtimeHub.publishFrame(topic, { kind: 'comms', topic, ...payload });
}

/** Direct ping to one worker's lane — "this was assigned to you", "your escalation moved". */
export function publishUserEvent(zohoUserId: string, payload: CommsEventPayload): number {
  if (zohoUserId.length === 0) return 0;
  const topic = commsUserTopic(zohoUserId);
  return realtimeHub.publishFrame(topic, { kind: 'comms', topic, ...payload });
}

/**
 * Wrap a publish so a realtime failure can never fail the request that already committed.
 *
 * Same doctrine as modules/hr/leave/notify.ts: a transition is durable the moment it is written, and
 * a push error must not make the client retry and duplicate it.
 */
export function publishSafely(label: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    logger.warn({ err, label }, 'comms realtime publish failed (state is already committed)');
  }
}
