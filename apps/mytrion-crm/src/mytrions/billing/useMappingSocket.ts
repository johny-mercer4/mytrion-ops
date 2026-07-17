/**
 * Billing real-time mapping socket (Phase 3b) — a React port of the widget's
 * bmCreateReconnectingSocket + connectWebSocket/_handleWsMessage. Opens a reconnecting
 * WebSocket to the servercrm mapping hub, sends {type:'subscribe'} on open, and invokes
 * `onEvent` for each `billing_mapping` message that did NOT originate from this client
 * (echo filtered by originId). Reconnects with exponential backoff (2s → 30s cap).
 *
 * The inbound subscribe stream needs no key (public subscribe); the OUTBOUND relay goes
 * through the backend proxy (api/billing.broadcastMapping) so the servercrm key stays server-side.
 * URL comes from VITE_BILLING_WS_URL, else the known servercrm relay.
 */
import { useEffect, useRef } from 'react';

export interface RemoteMappingEvent {
  type: 'billing_mapping';
  action: 'map' | 'unmap' | 'returned';
  transactionRecordId: string;
  carrierId?: string;
  mappedBy?: string;
  mappedAt?: string;
  mappingType?: string;
  source?: string;
  originId?: string;
}

const WS_URL =
  (import.meta.env.VITE_BILLING_WS_URL as string | undefined) ?? 'wss://servercrm-wyhh.onrender.com';

/**
 * @param originId  this client's stable session id (own events are ignored)
 * @param onEvent   called for each remote billing_mapping event (not our own)
 */
export function useMappingSocket(originId: string, onEvent: (e: RemoteMappingEvent) => void): void {
  // Keep the latest callback without reconnecting the socket on every render.
  const cb = useRef(onEvent);
  cb.current = onEvent;

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let retries = 1;
    let destroyed = false;

    function connect() {
      if (socket) {
        socket.onclose = null;
        try {
          socket.close();
        } catch {
          /* noop */
        }
        socket = null;
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (destroyed) return;

      try {
        socket = new WebSocket(WS_URL);
        socket.onopen = () => {
          retries = 1;
          try {
            socket?.send(JSON.stringify({ type: 'subscribe' }));
          } catch {
            /* noop */
          }
        };
        socket.onmessage = (event: MessageEvent) => {
          try {
            const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
            if (!data || data.type !== 'billing_mapping') return;
            if (data.originId && data.originId === originId) return; // ignore our own echo
            cb.current(data as RemoteMappingEvent);
          } catch {
            /* malformed message — ignore */
          }
        };
        socket.onclose = () => {
          if (destroyed) return;
          const delay = Math.min(retries * 2000, 30000);
          retries += 1;
          reconnectTimer = setTimeout(() => {
            if (!destroyed) connect();
          }, delay);
        };
        socket.onerror = () => {
          /* onclose handles the reconnect */
        };
      } catch {
        // If construction throws, retry on the same backoff.
        const delay = Math.min(retries * 2000, 30000);
        retries += 1;
        reconnectTimer = setTimeout(() => {
          if (!destroyed) connect();
        }, delay);
      }
    }

    connect();
    return () => {
      destroyed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (socket) {
        socket.onclose = null;
        try {
          socket.close();
        } catch {
          /* noop */
        }
      }
    };
  }, [originId]);
}
