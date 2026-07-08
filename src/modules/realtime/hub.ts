/**
 * Realtime hub — our own in-process publish/subscribe over native WebSockets (no Redis,
 * per project direction). Topics are strings; sockets subscribe/unsubscribe and publishes
 * fan out to every live subscriber of that topic.
 *
 * Topic grammar for inbox events:
 *   inbox:worker:<zohoUserId>   one worker's feed
 *   inbox:client:<carrierUserId> one carrier account's feed
 *   inbox:all                    the firehose (admins only)
 *
 * Scope note: the hub lives in the web process. With JOBS_WORKER_MODE='inline' (the
 * default deploy) cron-created events publish live. In a split 'send-only' deploy the
 * worker process has no sockets — events still persist to inbox_events and surface on the
 * next fetch; live push then needs a cross-process bridge (pg NOTIFY) — not built yet.
 */
import { logger } from '../../lib/logger.js';
import type { TenantContext } from '../../types/tenantContext.js';

/** The minimal socket surface the hub needs (satisfied by `ws`; easy to fake in tests). */
export interface RealtimeSocket {
  send(data: string): void;
  readyState: number;
}

const OPEN = 1; // ws.WebSocket.OPEN

export const INBOX_ALL_TOPIC = 'inbox:all';

const topicSubscribers = new Map<string, Set<RealtimeSocket>>();
const socketTopics = new Map<RealtimeSocket, Set<string>>();

/** A topic name is one of ours: 'inbox:all' or 'inbox:(worker|client):<id>'. */
export function isValidTopic(topic: string): boolean {
  return topic === INBOX_ALL_TOPIC || /^inbox:(worker|client):[A-Za-z0-9._:-]{1,120}$/.test(topic);
}

/** The topic that carries a given owner's inbox events. */
export function inboxTopicFor(ownerKind: 'worker' | 'client', ownerId: string): string {
  return `inbox:${ownerKind}:${ownerId}`;
}

/**
 * The caller's OWN inbox topic, derived from the verified session identity — never from
 * anything the client sends. Workers: userId 'zoho:<id>' → inbox:worker:<id>. Customers:
 * userId 'client:<cu_id>' → inbox:client:<cu_id>. System identities have no own topic.
 */
export function ownTopicOf(ctx: TenantContext): string | null {
  if (ctx.audience === 'customer' && ctx.userId.startsWith('client:')) {
    return inboxTopicFor('client', ctx.userId.slice('client:'.length));
  }
  if (ctx.audience === 'internal' && ctx.userId.startsWith('zoho:')) {
    return inboxTopicFor('worker', ctx.userId.slice('zoho:'.length));
  }
  return null;
}

/** May this caller subscribe to this topic? Own feed always; anything else needs admin. */
export function canSubscribe(ctx: TenantContext, topic: string): boolean {
  if (!isValidTopic(topic)) return false;
  if (ctx.role === 'admin' || ctx.bypassRbac === true) return true;
  return topic === ownTopicOf(ctx);
}

export const realtimeHub = {
  subscribe(socket: RealtimeSocket, topic: string): void {
    let subs = topicSubscribers.get(topic);
    if (!subs) {
      subs = new Set();
      topicSubscribers.set(topic, subs);
    }
    subs.add(socket);
    let topics = socketTopics.get(socket);
    if (!topics) {
      topics = new Set();
      socketTopics.set(socket, topics);
    }
    topics.add(topic);
  },

  unsubscribe(socket: RealtimeSocket, topic: string): void {
    topicSubscribers.get(topic)?.delete(socket);
    if (topicSubscribers.get(topic)?.size === 0) topicSubscribers.delete(topic);
    socketTopics.get(socket)?.delete(topic);
  },

  /** Drop a closed socket from every topic (called on 'close'/'error'). */
  dropSocket(socket: RealtimeSocket): void {
    const topics = socketTopics.get(socket);
    if (!topics) return;
    for (const topic of topics) {
      topicSubscribers.get(topic)?.delete(socket);
      if (topicSubscribers.get(topic)?.size === 0) topicSubscribers.delete(topic);
    }
    socketTopics.delete(socket);
  },

  /** Fan an event out to a topic's live subscribers. Returns the delivery count. */
  publish(topic: string, event: unknown): number {
    const subs = topicSubscribers.get(topic);
    if (!subs || subs.size === 0) return 0;
    const frame = JSON.stringify({ kind: 'event', topic, event });
    let delivered = 0;
    for (const socket of subs) {
      if (socket.readyState !== OPEN) continue;
      try {
        socket.send(frame);
        delivered += 1;
      } catch (err) {
        logger.warn({ err, topic }, 'realtime send failed; dropping socket');
        this.dropSocket(socket);
      }
    }
    return delivered;
  },

  stats(): { topics: number; sockets: number } {
    return { topics: topicSubscribers.size, sockets: socketTopics.size };
  },
};

/** Persist-then-publish helper: push one inbox event to its owner's topic + the firehose. */
export function publishInboxEvent(event: {
  ownerKind: 'worker' | 'client';
  ownerId: string;
}): number {
  const own = realtimeHub.publish(inboxTopicFor(event.ownerKind, event.ownerId), event);
  const all = realtimeHub.publish(INBOX_ALL_TOPIC, event);
  return own + all;
}
