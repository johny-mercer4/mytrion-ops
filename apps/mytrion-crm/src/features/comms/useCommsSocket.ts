import { useEffect, useRef, useState } from 'react';
import { resolveApiConfig, v1Url } from '@/api/config';
import { getSession } from '@/api/session';
import { refreshBearer } from '@/api/transport';

/**
 * The comms WebSocket: one connection per mounted console, with DYNAMIC thread subscription.
 *
 * Deliberately separate from `useOctaneRealtime`, which drops every frame that is not `kind === 'event'`
 * and has a fixed topic list. Comms frames are FLAT (`{kind:'comms', topic, type, threadId, …}`) with no
 * `event` wrapper, and the topic set changes as the user opens and closes conversations — a thread topic is
 * subscribed only while its chat is open, so an agent with 200 tickets adds one topic and not 200.
 *
 * Two topic families arrive without asking:
 *   `comms:user:<me>`         the server auto-subscribes it and names it in the `hello` frame. Carries
 *                             badges and assignment pings for threads that are NOT open — which
 *                             per-thread subscriptions structurally cannot deliver.
 *   `comms:queue:<dept>`      subscribed explicitly, for a department board.
 *
 * A client cannot construct its own lane name: the server returns null for it while acting as someone else,
 * so it is read from `hello` rather than built from a user id.
 */

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

export interface CommsFrame {
  kind: 'comms';
  topic: string;
  type: CommsEventType;
  threadId: string;
  seq?: number;
  clientMsgId?: string | null;
  messageId?: string;
  ticketId?: string | null;
  escalationId?: string;
  attachmentId?: string;
  number?: string;
  level?: number;
  levelLabel?: string;
  assigneeZohoUserId?: string | null;
  assigneeName?: string | null;
  authorZohoUserId?: string | null;
  authorName?: string | null;
  preview?: string;
  isInternal?: boolean;
  name?: string;
  sizeBytes?: number | null;
  status?: string;
  priority?: string;
  subject?: string;
  targetDepartment?: string | null;
  companyName?: string | null;
  outcome?: string;
}

export type CommsSocketStatus = 'connecting' | 'live' | 'offline';

export interface UseCommsSocketOptions {
  enabled?: boolean;
  /** Department queue boards to watch, e.g. ['customer-service']. */
  queues?: string[];
  /** The one conversation currently open. Subscribed on change, unsubscribed on leave. */
  openThreadId?: string | null;
  onFrame?: (frame: CommsFrame) => void;
}

function wsUrl(token: string): string {
  const { baseUrl } = resolveApiConfig();
  const http = v1Url(baseUrl, `/realtime?token=${encodeURIComponent(token)}`);
  if (http.startsWith('https://')) return `wss://${http.slice('https://'.length)}`;
  if (http.startsWith('http://')) return `ws://${http.slice('http://'.length)}`;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}${http.startsWith('/') ? http : `/${http}`}`;
}

export interface CommsSocket {
  status: CommsSocketStatus;
  /** The caller's own lane, from the `hello` frame. Null while acting as someone else. */
  commsTopic: string | null;
}

export function useCommsSocket(opts: UseCommsSocketOptions): CommsSocket {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const [status, setStatus] = useState<CommsSocketStatus>('connecting');
  const [commsTopic, setCommsTopic] = useState<string | null>(null);

  const sockRef = useRef<WebSocket | null>(null);
  // What we believe is subscribed. Rebuilt from scratch on reconnect, because the server keeps no
  // subscription state across sockets — a reconnect that assumed otherwise would silently go deaf.
  const subscribedRef = useRef<Set<string>>(new Set());

  const queuesKey = (opts.queues ?? []).slice().sort().join('|');
  const openThreadId = opts.openThreadId ?? null;

  // --- one connection for the lifetime of the mount --------------------------------------------
  useEffect(() => {
    if (opts.enabled === false) return undefined;
    let destroyed = false;
    let retries = 1;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const send = (payload: unknown): void => {
      const sock = sockRef.current;
      if (!sock || sock.readyState !== WebSocket.OPEN) return;
      try {
        sock.send(JSON.stringify(payload));
      } catch {
        /* the close handler will reconnect */
      }
    };

    const subscribeAll = (): void => {
      subscribedRef.current.clear();
      for (const dept of optsRef.current.queues ?? []) {
        const topic = `comms:queue:${dept}`;
        send({ action: 'subscribe', topic });
        subscribedRef.current.add(topic);
      }
      const thread = optsRef.current.openThreadId;
      if (thread) {
        const topic = `comms:thread:${thread}`;
        send({ action: 'subscribe', topic });
        subscribedRef.current.add(topic);
      }
    };

    const connect = async (): Promise<void> => {
      if (destroyed) return;
      setStatus('connecting');
      let token = getSession()?.accessToken;
      if (!token) {
        const refreshed = await refreshBearer();
        token = refreshed ? getSession()?.accessToken : undefined;
      }
      if (!token || destroyed) {
        setStatus('offline');
        return;
      }

      let sock: WebSocket;
      try {
        sock = new WebSocket(wsUrl(token));
      } catch {
        setStatus('offline');
        scheduleReconnect();
        return;
      }
      sockRef.current = sock;

      sock.onopen = () => {
        retries = 1;
        setStatus('live');
        // Re-subscribe everything: a reconnect starts from an empty server-side topic set.
        subscribeAll();
      };

      sock.onmessage = (ev) => {
        let frame: Record<string, unknown>;
        try {
          frame = JSON.parse(String(ev.data)) as Record<string, unknown>;
        } catch {
          return;
        }
        if (frame.kind === 'hello') {
          setCommsTopic(typeof frame.commsTopic === 'string' ? frame.commsTopic : null);
          return;
        }
        // Everything else that is not a comms frame (inbox events, acks, pongs) is not ours.
        if (frame.kind !== 'comms' || typeof frame.type !== 'string') return;
        optsRef.current.onFrame?.(frame as unknown as CommsFrame);
      };

      sock.onclose = () => {
        sockRef.current = null;
        subscribedRef.current.clear();
        if (destroyed) return;
        setStatus('offline');
        scheduleReconnect();
      };

      sock.onerror = () => {
        try {
          sock.close();
        } catch {
          /* onclose handles it */
        }
      };
    };

    const scheduleReconnect = (): void => {
      if (destroyed || timer) return;
      // Bounded backoff. A tab left open overnight must not retry in a tight loop against a cold backend.
      const delay = Math.min(30_000, 1000 * retries);
      timer = setTimeout(() => {
        timer = null;
        retries = Math.min(retries + 1, 30);
        void connect();
      }, delay);
    };

    void connect();

    return () => {
      destroyed = true;
      if (timer) clearTimeout(timer);
      try {
        sockRef.current?.close();
      } catch {
        /* noop */
      }
      sockRef.current = null;
      subscribedRef.current.clear();
    };
    // Intentionally NOT keyed on queues/openThreadId: those are handled by the diffing effect below, so a
    // topic change never tears down and re-establishes the socket.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.enabled]);

  // --- diff the desired topic set against what is subscribed -----------------------------------
  useEffect(() => {
    const sock = sockRef.current;
    if (!sock || sock.readyState !== WebSocket.OPEN) return;

    const want = new Set<string>();
    for (const dept of opts.queues ?? []) want.add(`comms:queue:${dept}`);
    if (openThreadId) want.add(`comms:thread:${openThreadId}`);

    const have = subscribedRef.current;
    for (const topic of have) {
      if (!want.has(topic)) {
        try {
          sock.send(JSON.stringify({ action: 'unsubscribe', topic }));
        } catch {
          /* noop */
        }
        have.delete(topic);
      }
    }
    for (const topic of want) {
      if (!have.has(topic)) {
        try {
          sock.send(JSON.stringify({ action: 'subscribe', topic }));
        } catch {
          /* noop */
        }
        have.add(topic);
      }
    }
    // `status` is a dependency so the diff re-runs the moment a reconnect reports 'live' — otherwise a
    // thread opened while offline would never get its subscription.
  }, [queuesKey, openThreadId, status, opts.queues]);

  return { status, commsTopic };
}
