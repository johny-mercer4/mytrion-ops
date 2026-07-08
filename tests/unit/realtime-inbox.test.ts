/**
 * Realtime WebSocket + inbox_events. Coverage: hub pub/sub semantics + topic authorization
 * (own feed only; firehose/foreign topics need admin), REST RBAC (create/delete admin-only,
 * owner-scoped list/read for workers AND carrier clients), and a LIVE end-to-end pass —
 * real listener, real `ws` client, event created over REST arrives as a socket frame.
 */
import type { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

vi.mock('../../src/repos/inboxEventRepo.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/repos/inboxEventRepo.js')>();
  return {
    toInboxEventDto: mod.toInboxEventDto,
    inboxEventRepo: {
      list: vi.fn(async () => ({ events: [], total: 0, unread: 0 })),
      findById: vi.fn(async () => undefined),
      create: vi.fn(),
      markRead: vi.fn(async () => null),
      markAllRead: vi.fn(async () => 0),
      deleteById: vi.fn(async () => false),
    },
  };
});
vi.mock('../../src/modules/audit/auditLogger.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/audit/auditLogger.js')>();
  return {
    ...mod,
    audit: vi.fn(async () => undefined),
    auditFromContext: vi.fn(async () => undefined),
  };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import {
  canSubscribe,
  inboxTopicFor,
  ownTopicOf,
  realtimeHub,
  type RealtimeSocket,
} from '../../src/modules/realtime/hub.js';
import { inboxEventRepo, type InboxEventDto } from '../../src/repos/inboxEventRepo.js';
import type { InboxEvent } from '../../src/db/schema/index.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

const repo = vi.mocked(inboxEventRepo);

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  vi.clearAllMocks();
  repo.list.mockResolvedValue({ events: [], total: 0, unread: 0 });
});

const API_KEY_HEADERS = { 'x-api-key': 'test-secret-key' };

async function workerToken(profile: string, zohoUserId = '42'): Promise<string> {
  return signAccessToken({
    userId: `zoho:${zohoUserId}`,
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin', // stale claim — role is re-derived from the profile at verify
    worker: { zohoUserId, userName: 'Robiya', profile },
  });
}

async function clientToken(carrierUserId = 'cu_1'): Promise<string> {
  return signAccessToken({
    userId: `client:${carrierUserId}`,
    tenantId: DEFAULT_TENANT_ID,
    audience: 'customer',
    role: 'viewer',
    client: { carrierUserId, clientProfile: 'owner', carrierId: '104882' },
  });
}

function eventDto(overrides: Partial<InboxEventDto> = {}): InboxEventDto {
  return {
    id: 'ie_1',
    priority: 'high',
    tag: 'retention',
    type: 'retention.case.created',
    ownerKind: 'worker',
    ownerId: '42',
    title: 'New at-risk client',
    detail: 'HORSERIDER INC breached its 2-day cadence',
    readAt: null,
    createdAt: '2026-07-09T00:00:00.000Z',
    updatedAt: '2026-07-09T00:00:00.000Z',
    ...overrides,
  };
}

function eventRow(overrides: Partial<InboxEvent> = {}): InboxEvent {
  return {
    id: 'ie_1',
    tenantId: DEFAULT_TENANT_ID,
    priority: 'high',
    tag: 'retention',
    type: 'retention.case.created',
    ownerKind: 'worker',
    ownerId: '42',
    title: 'New at-risk client',
    detail: null,
    readAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as InboxEvent;
}

function ctxOf(partial: Partial<TenantContext>): TenantContext {
  return {
    tenantId: DEFAULT_TENANT_ID,
    userId: 'zoho:42',
    audience: 'internal',
    role: 'worker',
    scopes: [],
    departments: [],
    allDepartmentAccess: false,
    requestId: 'req_test',
    ...partial,
  };
}

function fakeSocket(): RealtimeSocket & { frames: string[] } {
  const frames: string[] = [];
  return {
    frames,
    readyState: 1,
    send(data: string) {
      frames.push(data);
    },
  };
}

describe('realtime hub — pub/sub semantics', () => {
  it('delivers to subscribers of the topic and nobody else', () => {
    const a = fakeSocket();
    const b = fakeSocket();
    realtimeHub.subscribe(a, 'inbox:worker:42');
    realtimeHub.subscribe(b, 'inbox:worker:77');
    const delivered = realtimeHub.publish('inbox:worker:42', { id: 'ie_1' });
    expect(delivered).toBe(1);
    expect(a.frames).toHaveLength(1);
    expect(JSON.parse(a.frames[0]!)).toMatchObject({ kind: 'event', topic: 'inbox:worker:42' });
    expect(b.frames).toHaveLength(0);
    realtimeHub.dropSocket(a);
    realtimeHub.dropSocket(b);
  });

  it('unsubscribe and dropSocket stop delivery; closed sockets are skipped', () => {
    const a = fakeSocket();
    realtimeHub.subscribe(a, 'inbox:worker:42');
    realtimeHub.unsubscribe(a, 'inbox:worker:42');
    expect(realtimeHub.publish('inbox:worker:42', {})).toBe(0);

    const b = fakeSocket();
    realtimeHub.subscribe(b, 'inbox:worker:42');
    (b as { readyState: number }).readyState = 3; // CLOSED
    expect(realtimeHub.publish('inbox:worker:42', {})).toBe(0);
    realtimeHub.dropSocket(b);
  });

  it('derives own topics from the verified session identity', () => {
    expect(ownTopicOf(ctxOf({ userId: 'zoho:42', audience: 'internal' }))).toBe('inbox:worker:42');
    expect(ownTopicOf(ctxOf({ userId: 'client:cu_9', audience: 'customer', role: 'viewer' }))).toBe(
      'inbox:client:cu_9',
    );
    expect(ownTopicOf(ctxOf({ userId: 'system' }))).toBeNull();
  });

  it('topic authorization: own feed yes, foreign/firehose only for admins', () => {
    const worker = ctxOf({ userId: 'zoho:42', role: 'worker' });
    expect(canSubscribe(worker, 'inbox:worker:42')).toBe(true);
    expect(canSubscribe(worker, 'inbox:worker:77')).toBe(false);
    expect(canSubscribe(worker, 'inbox:all')).toBe(false);
    expect(canSubscribe(worker, 'not-a-topic')).toBe(false);

    const admin = ctxOf({ userId: 'zoho:1', role: 'admin' });
    expect(canSubscribe(admin, 'inbox:worker:77')).toBe(true);
    expect(canSubscribe(admin, 'inbox:all')).toBe(true);

    const client = ctxOf({ userId: 'client:cu_9', audience: 'customer', role: 'viewer' });
    expect(canSubscribe(client, 'inbox:client:cu_9')).toBe(true);
    expect(canSubscribe(client, 'inbox:client:cu_1')).toBe(false);
    expect(canSubscribe(client, 'inbox:worker:42')).toBe(false);
  });
});

describe('inbox REST — RBAC', () => {
  it('rejects unauthenticated access', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/inbox/events' });
    expect(res.statusCode).toBe(401);
  });

  it('create is admin-only — a plain worker is refused', async () => {
    const token = await workerToken('Sales Rep');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/inbox/events',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: {
        type: 'retention.case.created',
        owner_kind: 'worker',
        owner_id: '42',
        title: 'x',
      },
    });
    expect(res.statusCode).toBe(403);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('creates via API key (201) with the requested columns', async () => {
    repo.create.mockResolvedValueOnce(eventDto());
    const res = await app.inject({
      method: 'POST',
      url: '/v1/inbox/events',
      headers: { ...API_KEY_HEADERS, 'content-type': 'application/json' },
      payload: {
        priority: 'high',
        tag: 'retention',
        type: 'retention.case.created',
        owner_kind: 'worker',
        owner_id: 42,
        title: 'New at-risk client',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(repo.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        priority: 'high',
        tag: 'retention',
        type: 'retention.case.created',
        ownerKind: 'worker',
        ownerId: '42',
      }),
    );
  });

  it('a worker lists ONLY their own feed regardless of query filters', async () => {
    const token = await workerToken('Sales Rep', '42');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/inbox/events?owner_kind=worker&owner_id=77', // ignored for non-admins
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(repo.list).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ownerKind: 'worker', ownerId: '42' }),
    );
  });

  it('a carrier client lists their own feed', async () => {
    const token = await clientToken('cu_9');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/inbox/events',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(repo.list).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ownerKind: 'client', ownerId: 'cu_9' }),
    );
  });

  it('mark-read is owner-or-admin: a foreign worker is refused', async () => {
    repo.findById.mockResolvedValueOnce(eventRow({ ownerId: '77' }));
    const token = await workerToken('Sales Rep', '42');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/inbox/events/ie_1/read',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(repo.markRead).not.toHaveBeenCalled();
  });

  it('the owner can mark their event read', async () => {
    repo.findById.mockResolvedValueOnce(eventRow({ ownerId: '42' }));
    repo.markRead.mockResolvedValueOnce(eventDto({ readAt: '2026-07-09T01:00:00.000Z' }));
    const token = await workerToken('Sales Rep', '42');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/inbox/events/ie_1/read',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(repo.markRead).toHaveBeenCalledWith(expect.anything(), 'ie_1');
  });

  it('delete is admin-only', async () => {
    const token = await workerToken('Sales Rep');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/inbox/events/ie_1/delete',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(repo.deleteById).not.toHaveBeenCalled();
  });
});

describe('realtime WebSocket — live end to end', () => {
  it('worker connects with ?token=, gets hello + auto-subscription, and receives a published event', async () => {
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const token = await workerToken('Sales Rep', '42');
    const ws = new WebSocket(`${address.replace('http', 'ws')}/v1/realtime?token=${token}`);

    // Collector attached BEFORE the handshake settles: the hello frame can arrive in the
    // same TCP batch as the 101 and be emitted synchronously right after 'open'.
    const queue: Array<Record<string, unknown>> = [];
    let wake: (() => void) | null = null;
    ws.on('message', (data) => {
      queue.push(JSON.parse(String(data)) as Record<string, unknown>);
      wake?.();
    });
    const nextFrame = async (): Promise<Record<string, unknown>> => {
      while (queue.length === 0) {
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, 2000);
        });
        wake = null;
      }
      return queue.shift()!;
    };

    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    const hello = await nextFrame();
    expect(hello).toMatchObject({ kind: 'hello', ownTopic: 'inbox:worker:42' });

    // A foreign-topic subscribe is refused over the wire.
    const denied = nextFrame();
    ws.send(JSON.stringify({ action: 'subscribe', topic: 'inbox:worker:77' }));
    expect(await denied).toMatchObject({ kind: 'error', topic: 'inbox:worker:77' });

    // Create an event for this worker via REST (API key) → arrives on the socket.
    repo.create.mockResolvedValueOnce(eventDto({ ownerId: '42' }));
    const pushed = nextFrame();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/inbox/events',
      headers: { ...API_KEY_HEADERS, 'content-type': 'application/json' },
      payload: {
        priority: 'high',
        tag: 'retention',
        type: 'retention.case.created',
        owner_kind: 'worker',
        owner_id: '42',
        title: 'New at-risk client',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().delivered).toBe(1);
    expect(await pushed).toMatchObject({
      kind: 'event',
      topic: 'inbox:worker:42',
      event: expect.objectContaining({ type: 'retention.case.created', ownerId: '42' }),
    });

    ws.close();
    await new Promise((resolve) => ws.once('close', resolve));
  });

  it('rejects a WS handshake without a token', async () => {
    const address = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
    const ws = new WebSocket(`${address.replace('http', 'ws')}/v1/realtime`);
    const failed = await new Promise<boolean>((resolve) => {
      ws.once('open', () => resolve(false));
      ws.once('error', () => resolve(true));
      ws.once('unexpected-response', () => resolve(true));
    });
    expect(failed).toBe(true);
  });
});

// Sanity: the helper used by the publish path builds the exact topic the socket joined.
describe('topic helper', () => {
  it('inboxTopicFor matches the auto-subscribed own topic', () => {
    expect(inboxTopicFor('worker', '42')).toBe('inbox:worker:42');
    expect(inboxTopicFor('client', 'cu_9')).toBe('inbox:client:cu_9');
  });
});
