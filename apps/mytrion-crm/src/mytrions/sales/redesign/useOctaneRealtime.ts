/**
 * Octane native realtime WebSocket (`GET /v1/realtime?token=…`).
 * Auto-subscribes to the caller's inbox topic server-side; admins can also
 * subscribe to an acted-as agent's topic so View-as still gets live retention.
 */
import { useEffect, useRef } from 'react';
import { resolveApiConfig, v1Url } from '@/api/config';
import { getSession } from '@/api/session';
import { refreshBearer } from '@/api/transport';

export interface OctaneInboxEvent {
  id: string;
  type: string;
  tag: string | null;
  ownerKind: 'worker' | 'client';
  ownerId: string;
  title: string;
  detail: string | null;
  priority: string;
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OctaneRealtimeOptions {
  enabled?: boolean;
  /** Extra topics (admins only) — e.g. inbox:worker:<actedAsZohoId>. */
  extraTopics?: string[];
  onInboxEvent?: (event: OctaneInboxEvent) => void;
}

function wsUrlForToken(token: string): string {
  const { baseUrl } = resolveApiConfig();
  const http = v1Url(baseUrl, `/realtime?token=${encodeURIComponent(token)}`);
  if (http.startsWith('https://')) return `wss://${http.slice('https://'.length)}`;
  if (http.startsWith('http://')) return `ws://${http.slice('http://'.length)}`;
  // Same-origin relative → use page host.
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}${http.startsWith('/') ? http : `/${http}`}`;
}

export function useOctaneRealtime(opts: OctaneRealtimeOptions): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const topicsKey = (opts.extraTopics ?? []).slice().sort().join('|');

  useEffect(() => {
    if (opts.enabled === false) return;
    let destroyed = false;
    let retries = 1;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let sock: WebSocket | null = null;

    const connect = async (): Promise<void> => {
      if (destroyed) return;
      let token = getSession()?.accessToken;
      if (!token) {
        const refreshed = await refreshBearer();
        token = refreshed ? getSession()?.accessToken : undefined;
      }
      if (!token || destroyed) return;

      try {
        sock = new WebSocket(wsUrlForToken(token));
      } catch {
        scheduleReconnect();
        return;
      }

      sock.onopen = () => {
        retries = 1;
        const extras = optsRef.current.extraTopics ?? [];
        for (const topic of extras) {
          try {
            sock?.send(JSON.stringify({ action: 'subscribe', topic }));
          } catch {
            /* noop */
          }
        }
      };

      sock.onmessage = (ev) => {
        let frame: { kind?: string; event?: OctaneInboxEvent };
        try {
          frame = JSON.parse(String(ev.data)) as typeof frame;
        } catch {
          return;
        }
        if (frame.kind !== 'event' || !frame.event) return;
        optsRef.current.onInboxEvent?.(frame.event);
      };

      sock.onclose = () => {
        sock = null;
        if (!destroyed) scheduleReconnect();
      };

      sock.onerror = () => {
        try {
          sock?.close();
        } catch {
          /* noop */
        }
      };
    };

    const scheduleReconnect = (): void => {
      if (destroyed || reconnectTimer) return;
      const delay = Math.min(30_000, 1000 * retries);
      retries = Math.min(retries + 1, 30);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, delay);
    };

    void connect();

    return () => {
      destroyed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        sock?.close();
      } catch {
        /* noop */
      }
      sock = null;
    };
    // Reconnect when acted-as target changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.enabled, topicsKey]);
}
