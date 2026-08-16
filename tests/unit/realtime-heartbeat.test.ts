/**
 * WebSocket liveness. Coverage: the reaper's two-sweep contract over fakes (a browser answers
 * `pong` automatically and cannot be made to look dead, which is exactly why `sweepOnce` is
 * exported and parameterised), that reaping frees the socket's hub subscriptions, and a LIVE
 * end-to-end pass proving a real client actually receives a protocol ping.
 */
import type { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
  // Must be set before config/env.ts parses. The floor the schema allows (1s), so the live ping
  // test does not sit through the 25s production interval — without weakening that floor, which
  // exists to stop a pathologically low value causing a ping storm in prod.
  process.env.REALTIME_PING_INTERVAL_MS = '1000';
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import { realtimeHub } from '../../src/modules/realtime/hub.js';
import { presenceSnapshotForTests } from '../../src/modules/realtime/presence.js';
import { sweepOnce, type HeartbeatSocket } from '../../src/plugins/wsHeartbeat.js';

interface Fake extends HeartbeatSocket {
  frames: string[];
  pings: number;
  terminated: number;
}

function fakeSocket(readyState = 1): Fake {
  const frames: string[] = [];
  return {
    frames,
    pings: 0,
    terminated: 0,
    readyState,
    send(data: string) {
      frames.push(data);
    },
    ping() {
      this.pings += 1;
    },
    terminate() {
      this.terminated += 1;
    },
  };
}

describe('ws heartbeat — sweepOnce', () => {
  it('pings on the first sweep and reaps on the next when no pong arrived', () => {
    const socket = fakeSocket();
    const awaiting = new WeakSet<object>();

    expect(sweepOnce([socket], awaiting)).toEqual({ pinged: 1, reaped: 0 });
    expect(socket.pings).toBe(1);
    expect(socket.terminated).toBe(0);

    expect(sweepOnce([socket], awaiting)).toEqual({ pinged: 0, reaped: 1 });
    expect(socket.terminated).toBe(1);
  });

  it('a socket that pongs between sweeps is pinged again, never reaped', () => {
    const socket = fakeSocket();
    const awaiting = new WeakSet<object>();

    sweepOnce([socket], awaiting);
    awaiting.delete(socket); // what the 'pong' listener does

    expect(sweepOnce([socket], awaiting)).toEqual({ pinged: 1, reaped: 0 });
    expect(socket.terminated).toBe(0);
    expect(socket.pings).toBe(2);
  });

  it('skips sockets that are not OPEN', () => {
    const connecting = fakeSocket(0);
    const closing = fakeSocket(2);
    const closed = fakeSocket(3);
    const awaiting = new WeakSet<object>();

    expect(sweepOnce([connecting, closing, closed], awaiting)).toEqual({ pinged: 0, reaped: 0 });
    expect(connecting.pings + closing.pings + closed.pings).toBe(0);
  });

  it('reaping drops the socket from the hub so no further publish targets it', () => {
    const socket = fakeSocket();
    const awaiting = new WeakSet<object>();
    realtimeHub.subscribe(socket, 'inbox:worker:42');
    expect(realtimeHub.publish('inbox:worker:42', { id: 'a' })).toBe(1);

    sweepOnce([socket], awaiting); // ping
    sweepOnce([socket], awaiting); // reap

    expect(socket.terminated).toBe(1);
    // The subscription is gone, not merely the socket closed — otherwise a reaped socket keeps
    // consuming a Set slot and every publish keeps paying for it.
    expect(realtimeHub.publish('inbox:worker:42', { id: 'b' })).toBe(0);
  });

  it('one dead socket does not stop the sweep from servicing the others', () => {
    const dead = fakeSocket();
    const live = fakeSocket();
    const awaiting = new WeakSet<object>();
    awaiting.add(dead); // already owed a pong

    expect(sweepOnce([dead, live], awaiting)).toEqual({ pinged: 1, reaped: 1 });
    expect(dead.terminated).toBe(1);
    expect(live.pings).toBe(1);
  });
});

describe('ws heartbeat — live', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it('a real connected client receives a protocol ping', async () => {
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const token = await signAccessToken({
      userId: 'zoho:42',
      tenantId: DEFAULT_TENANT_ID,
      audience: 'internal',
      role: 'worker',
      worker: { zohoUserId: '42', userName: 'CI Test Admin', profile: 'Sales Rep' },
    });
    const ws = new WebSocket(`${address.replace('http', 'ws')}/v1/realtime?token=${token}`);

    const pinged = new Promise<boolean>((resolve) => {
      ws.once('ping', () => resolve(true));
      setTimeout(() => resolve(false), 3000);
    });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });

    expect(await pinged).toBe(true);

    // FF_COMMS_PRESENCE is off by default, so a live socket must NOT be tracked and the sweep must
    // not touch the DB. This is what keeps the presence table shippable ahead of ticket assignment
    // — and it is asserted because removing the guard would make every suite that opens a socket
    // start writing to whatever MYTRION_OPS_DATABASE_URL points at.
    expect(presenceSnapshotForTests()).toEqual([]);

    ws.close();
    await new Promise((resolve) => ws.once('close', resolve));
  });

  it('clears its interval on app close so a suite cannot be held open', async () => {
    const spy = vi.spyOn(globalThis, 'clearInterval');
    const throwaway = await buildApp();
    await throwaway.ready();
    await throwaway.close();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
