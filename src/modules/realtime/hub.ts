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

/**
 * Wire frame kinds. `'event'` is the ORIGINAL envelope and is frozen forever — the two live
 * clients (useOctaneRealtime, the mini-app) hard-drop anything where `kind !== 'event'`, so
 * new kinds must never be published to a topic an old client can subscribe to. That is safe
 * by construction today: old clients only ever subscribe to `inbox:*` / `retention:pool`.
 */
export type RealtimeFrameKind = 'event' | 'comms' | 'signal' | 'receipt';

/**
 * The index signature is deliberate: it lets call sites pass a frame literal with per-kind
 * fields without tripping excess-property checks (the same friction `publishInboxEvent`'s
 * structural typing works around — see the const-hoist note in modules/inbox/service.ts).
 */
export interface RealtimeFrame {
  kind: RealtimeFrameKind;
  topic: string;
  [extra: string]: unknown;
}

const OPEN = 1; // ws.WebSocket.OPEN

export const INBOX_ALL_TOPIC = 'inbox:all';
/** Sales Open Pool live updates — any authenticated internal worker may subscribe. */
export const RETENTION_POOL_TOPIC = 'retention:pool';

/**
 * Comms topic families (tickets, escalations, chat).
 *
 *   comms:thread:<threadId>   the FAT feed — messages, attachments, typing. Subscribed only for the
 *                             thread a user currently has open, so an agent with 200 open tickets
 *                             adds one topic and not 200.
 *   comms:queue:<department>  list-level events for a department queue (created, assigned, closed).
 *   comms:user:<zohoUserId>   the caller's own thin lane: badges, assignment pings, DM previews.
 *                             This is what makes counts correct for threads that are NOT open.
 *
 * Note the id segments deliberately exclude ':' — unlike the older inbox grammar, which allows it and
 * therefore makes prefix-based reasoning about a topic unreliable.
 */
export const COMMS_THREAD_PREFIX = 'comms:thread:';
export const COMMS_QUEUE_PREFIX = 'comms:queue:';
export const COMMS_USER_PREFIX = 'comms:user:';

export const commsThreadTopic = (threadId: string): string => `${COMMS_THREAD_PREFIX}${threadId}`;
export const commsQueueTopic = (department: string): string => `${COMMS_QUEUE_PREFIX}${department}`;
export const commsUserTopic = (zohoUserId: string): string => `${COMMS_USER_PREFIX}${zohoUserId}`;

const topicSubscribers = new Map<string, Set<RealtimeSocket>>();
const socketTopics = new Map<RealtimeSocket, Set<string>>();

/** A topic name is one of ours: inbox topics, retention:pool, or a comms topic. */
export function isValidTopic(topic: string): boolean {
  return (
    topic === INBOX_ALL_TOPIC ||
    topic === RETENTION_POOL_TOPIC ||
    /^inbox:(worker|client|miniapp):[A-Za-z0-9._:-]{1,120}$/.test(topic) ||
    /^comms:thread:[A-Za-z0-9_-]{1,64}$/.test(topic) ||
    /^comms:queue:[a-z][a-z0-9-]{1,40}$/.test(topic) ||
    /^comms:user:[A-Za-z0-9._-]{1,120}$/.test(topic)
  );
}

/**
 * The caller's own comms lane, derived from the verified session — never from client input.
 *
 * Returns null while acting as someone else: view-as must not hand an admin a live feed of another
 * person's conversations, including their direct messages.
 */
export function commsUserTopicOf(ctx: TenantContext): string | null {
  if (ctx.audience !== 'internal' || !ctx.userId.startsWith('zoho:')) return null;
  if (ctx.impersonatorUserId !== undefined) return null;
  const id = ctx.userId.slice('zoho:'.length);
  return id.length > 0 ? commsUserTopic(id) : null;
}

/**
 * Row-level authorization for a `comms:thread:*` subscription.
 *
 * Injected rather than imported so this module keeps depending only on `logger` + types — the
 * property that lets the realtime tests fake a socket in a few lines. The comms module registers the
 * real implementation at boot, which routes to the SAME reader filter the REST path uses, so a socket
 * and an API call can never disagree about who may read a thread.
 */
type CommsThreadAuthorizer = (ctx: TenantContext, threadId: string) => Promise<boolean>;
let commsThreadAuthorizer: CommsThreadAuthorizer | null = null;

export function registerCommsThreadAuthorizer(fn: CommsThreadAuthorizer): void {
  commsThreadAuthorizer = fn;
}

/** Async companion to canSubscribe for thread topics. Fails CLOSED when nothing is registered. */
export async function canSubscribeCommsThread(ctx: TenantContext, topic: string): Promise<boolean> {
  if (!isValidTopic(topic) || !topic.startsWith(COMMS_THREAD_PREFIX)) return false;
  if (!commsThreadAuthorizer) {
    logger.warn({ topic }, 'comms thread authorizer not registered; refusing subscription');
    return false;
  }
  const threadId = topic.slice(COMMS_THREAD_PREFIX.length);
  if (threadId.length === 0) return false;
  return commsThreadAuthorizer(ctx, threadId);
}

/** The topic that carries a given owner's inbox events. */
export function inboxTopicFor(ownerKind: 'worker' | 'client', ownerId: string): string {
  return `inbox:${ownerKind}:${ownerId}`;
}

/** A mini-app (Telegram) user's live feed — subscribed by the initData-authenticated WS in
 *  carrierMiniApp.routes, published by the notification dispatcher and news posting. Internal
 *  TenantContext callers can only reach these topics as admin (canSubscribe falls through). */
export function miniAppTopicFor(telegramUserId: string): string {
  return `inbox:miniapp:${telegramUserId}`;
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

/**
 * May this caller subscribe to this topic? Own feed always; pool broadcast for internals; else admin.
 *
 * ORDER MATTERS. The comms branches are evaluated BEFORE the admin blanket-true below, so an admin
 * cannot subscribe to another person's comms lane and live-tail their direct messages. Moving the
 * admin check above them would silently reopen that, which is why it is called out here.
 */
export function canSubscribe(ctx: TenantContext, topic: string): boolean {
  if (!isValidTopic(topic)) return false;
  if (topic === RETENTION_POOL_TOPIC) return ctx.audience === 'internal';

  // A comms lane is OWN-ONLY — no admin bypass, no view-as.
  if (topic.startsWith(COMMS_USER_PREFIX)) return topic === commsUserTopicOf(ctx);

  // Thread topics need a row lookup, which cannot happen in a synchronous, DB-free function.
  // Deny here and let the route consult canSubscribeCommsThread.
  if (topic.startsWith(COMMS_THREAD_PREFIX)) return false;

  if (topic.startsWith(COMMS_QUEUE_PREFIX)) {
    if (ctx.audience !== 'internal') return false;
    const department = topic.slice(COMMS_QUEUE_PREFIX.length);
    return (
      ctx.role === 'admin' ||
      ctx.bypassRbac === true ||
      ctx.allDepartmentAccess ||
      ctx.departments.includes(department)
    );
  }

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

  /**
   * Fan a fully-formed frame out to a topic's live subscribers. Returns the delivery count.
   * `opts.exclude` skips one socket — used by client-initiated signals (typing) so the sender
   * does not receive an echo of their own frame.
   */
  publishFrame(topic: string, frame: RealtimeFrame, opts?: { exclude?: RealtimeSocket }): number {
    const subs = topicSubscribers.get(topic);
    if (!subs || subs.size === 0) return 0;
    const payload = JSON.stringify(frame);
    let delivered = 0;
    for (const socket of subs) {
      if (opts?.exclude === socket) continue;
      if (socket.readyState !== OPEN) continue;
      try {
        socket.send(payload);
        delivered += 1;
      } catch (err) {
        logger.warn({ err, topic }, 'realtime send failed; dropping socket');
        this.dropSocket(socket);
      }
    }
    return delivered;
  },

  /**
   * Fan an inbox-style event out as the legacy `'event'` envelope. Kept as its own method with
   * its exact original signature so every existing call site is untouched and the serialized
   * bytes stay identical — key order here IS the wire format: {"kind","topic","event"}.
   */
  publish(topic: string, event: unknown): number {
    return this.publishFrame(topic, { kind: 'event', topic, event });
  },

  stats(): { topics: number; sockets: number } {
    return { topics: topicSubscribers.size, sockets: socketTopics.size };
  },
};

/**
 * Persist-then-publish helper: push one inbox event to its owner's topic + the firehose.
 *
 * `firehose` defaults to true so every existing caller behaves exactly as before. Pass
 * `false` for high-volume feeds that must not land on the admin `inbox:all` topic — chat
 * traffic in particular, since a per-message inbox event would put every conversation in
 * the company on one topic.
 */
export function publishInboxEvent(
  event: {
    ownerKind: 'worker' | 'client';
    ownerId: string;
  },
  opts?: { firehose?: boolean },
): number {
  const own = realtimeHub.publish(inboxTopicFor(event.ownerKind, event.ownerId), event);
  if (opts?.firehose === false) return own;
  const all = realtimeHub.publish(INBOX_ALL_TOPIC, event);
  return own + all;
}
