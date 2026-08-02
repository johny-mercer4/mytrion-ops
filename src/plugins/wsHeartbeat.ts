import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { env } from '../config/env.js';
import { realtimeHub, type RealtimeSocket } from '../modules/realtime/hub.js';
import { flushPresence } from '../modules/realtime/presence.js';

/**
 * WebSocket liveness: a periodic protocol ping plus a reaper for sockets that stop answering.
 *
 * Why a plugin rather than a hub method: the hub deliberately imports only `logger` + types so
 * `tests/unit/realtime-inbox.test.ts` can fake a socket in a few lines. Reaping needs Fastify's
 * server handle and a timer, neither of which belongs in that dependency-free module.
 *
 * Why `wss.on('connection')` rather than per-route listeners: @fastify/websocket emits
 * `connection` on the shared server for every upgraded socket, so ONE listener covers both
 * `GET /v1/realtime` and `GET /v1/carrier/mini-app/realtime` with no route changes — the
 * mini-app socket gets liveness for free.
 *
 * Note `clientTracking` needs no configuration: @fastify/websocket merges its options over
 * `{ noServer: true }` and `ws` defaults tracking on, so `app.websocketServer.clients` is a
 * live Set even in noServer mode.
 */

const OPEN = 1; // ws.WebSocket.OPEN — mirrored locally so this module needs no `ws` value import.

/** A socket we can both fan out to (hub) and probe (heartbeat). `ws` satisfies it; tests fake it. */
export interface HeartbeatSocket extends RealtimeSocket {
  ping(): void;
  terminate(): void;
}

/**
 * One sweep: reap anything that ignored the previous ping, ping everything else.
 *
 * Exported and parameterised over plain interfaces so the reaper is testable without a real
 * socket — a browser answers `pong` automatically and cannot be made to look dead.
 */
export function sweepOnce(
  clients: Iterable<HeartbeatSocket>,
  awaitingPong: WeakSet<object>,
): { pinged: number; reaped: number } {
  let pinged = 0;
  let reaped = 0;
  for (const socket of clients) {
    if (socket.readyState !== OPEN) continue;
    if (awaitingPong.has(socket)) {
      // Missed a full interval: drop its subscriptions first so no further publish targets it,
      // then force the socket shut (`terminate`, not `close` — a half-open peer never replies
      // to a close handshake, which is exactly the case being cleaned up).
      awaitingPong.delete(socket);
      realtimeHub.dropSocket(socket);
      socket.terminate();
      reaped += 1;
      continue;
    }
    awaitingPong.add(socket);
    socket.ping();
    pinged += 1;
  }
  return { pinged, reaped };
}

export function wsHeartbeatPlugin(app: FastifyInstance): void {
  const wss = app.websocketServer;
  if (!wss) {
    app.log.warn('ws heartbeat: no websocketServer on the instance; heartbeat disabled');
    return;
  }

  // Liveness lives in a WeakSet rather than an `isAlive` property bolted onto a vendor type:
  // no module augmentation, no cast, and a dropped socket needs no explicit cleanup.
  const awaitingPong = new WeakSet<object>();

  wss.on('connection', (socket: WebSocket) => {
    socket.on('pong', () => {
      awaitingPong.delete(socket);
    });
  });

  const timer = setInterval(() => {
    try {
      const { reaped } = sweepOnce(wss.clients, awaitingPong);
      if (reaped > 0) {
        app.log.warn({ reaped, ...realtimeHub.stats() }, 'realtime: reaped unresponsive sockets');
      }
    } catch (err) {
      // A sweep failure must never take the process down; the next tick retries.
      app.log.error({ err }, 'realtime heartbeat sweep failed');
    }
    // Piggyback the presence lease flush on the same tick: it is one batched statement and only
    // emits rows whose count changed or whose lease is aging, so an idle org costs ~nothing.
    // flushPresence swallows its own errors — a failed write must not stop the pings.
    if (env.FF_COMMS_PRESENCE) void flushPresence();
  }, env.REALTIME_PING_INTERVAL_MS);

  // Both, deliberately: `unref` stops a forgotten app.close() from hanging a vitest run, and the
  // onClose hook is the correct teardown when shutdown is orderly.
  timer.unref();
  app.addHook('onClose', async () => {
    clearInterval(timer);
  });
}
