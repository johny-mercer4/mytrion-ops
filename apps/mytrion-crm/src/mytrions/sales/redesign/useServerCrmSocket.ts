/**
 * servercrm real-time WebSocket — ports the self-service widget's `ssCreateReconnectingSocket`
 * + the ticket dashboard's subscription protocol into a React hook. One socket per mounting
 * component; exponential-backoff reconnect (cap 30s); a subscribe frame is (re)sent on every
 * open. Consumers pass an `onMessage` that switches on the server's `data.type`:
 *   - crm_inbox_notification { ownerId, subject, name }  → new inbox item for a user
 *   - sales_announcement                                  → announcements changed
 *   - ticket_comment_added / ticket_attachment_added      → live ticket updates
 *   - connection / subscribed                             → acks
 * The socket is public (no auth in the URL), matching the reference widget.
 */
import { useEffect, useRef } from 'react';

export const SERVERCRM_WS_URL =
  import.meta.env.VITE_SERVERCRM_WS_URL || 'wss://servercrm-wyhh.onrender.com';

export interface ServerCrmMessage {
  type: string;
  ownerId?: string | number;
  subject?: string;
  name?: string;
  ticketId?: string | number;
  message?: string;
  [k: string]: unknown;
}

export interface SocketOptions {
  /** Frame sent on every (re)connect. Generic feed: {type:'subscribe'}. Tickets add userId+ticketIds. */
  subscribe?: Record<string, unknown>;
  onMessage?: (msg: ServerCrmMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
  /** Set false to disable (e.g. no session yet). Default true. */
  enabled?: boolean;
}

/**
 * Open a reconnecting servercrm socket for the component's lifetime. `subscribe` is captured
 * per render via a ref, so changing subscription payloads (e.g. the ticket id list) re-sends
 * on the next open without tearing down the connection; call the returned `resubscribe()` to
 * push a fresh frame immediately on the live socket.
 */
export function useServerCrmSocket(opts: SocketOptions): { resubscribe: () => void } {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const socketRef = useRef<WebSocket | null>(null);

  const resubscribe = () => {
    const sock = socketRef.current;
    const sub = optsRef.current.subscribe;
    if (sock && sock.readyState === WebSocket.OPEN && sub) {
      try {
        sock.send(JSON.stringify(sub));
      } catch {
        /* noop */
      }
    }
  };

  useEffect(() => {
    if (opts.enabled === false) return;
    let destroyed = false;
    let retries = 1;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (destroyed) return;
      let sock: WebSocket;
      try {
        sock = new WebSocket(SERVERCRM_WS_URL);
      } catch {
        return;
      }
      socketRef.current = sock;

      sock.onopen = () => {
        retries = 1;
        const sub = optsRef.current.subscribe;
        if (sub) {
          try {
            sock.send(JSON.stringify(sub));
          } catch {
            /* noop */
          }
        }
        optsRef.current.onOpen?.();
      };
      sock.onmessage = (event) => {
        try {
          const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
          if (data && typeof data === 'object' && typeof data.type === 'string') {
            optsRef.current.onMessage?.(data as ServerCrmMessage);
          }
        } catch {
          /* ignore malformed frames */
        }
      };
      sock.onclose = () => {
        optsRef.current.onClose?.();
        if (destroyed) return;
        const delay = Math.min(retries * 2000, 30_000);
        retries += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
      sock.onerror = () => {
        /* onclose handles the reconnect */
      };
    };

    connect();
    return () => {
      destroyed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const sock = socketRef.current;
      if (sock) {
        sock.onclose = null;
        try {
          sock.close();
        } catch {
          /* noop */
        }
        socketRef.current = null;
      }
    };
    // Reconnect lifecycle is keyed on enabled only; payload changes ride optsRef + resubscribe().
    // eslint-disable-next-line
  }, [opts.enabled]);

  return { resubscribe };
}
