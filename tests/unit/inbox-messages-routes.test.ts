/**
 * Mytrion Inbox Messages routes (/v1/inbox/messages) — the servercrm/Zoho replacement.
 * Coverage: shared-secret webhook auth, create-then-publish over our realtime hub, tolerant Zoho /
 * normalized field parsing, required-field validation, owner-scoped list (RBAC leakage: a worker's
 * owner_id override is ignored) and owner-scoped delete.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
  process.env.INBOX_WEBHOOK_SECRET = 'test-inbox-secret';
});

vi.mock('../../src/repos/mytrionInboxMessageRepo.js', () => ({
  mytrionInboxMessageRepo: {
    create: vi.fn(),
    listForOwner: vi.fn(async () => []),
    deleteForOwner: vi.fn(async () => true),
    findByZohoRecordId: vi.fn(async () => undefined),
  },
}));
vi.mock('../../src/modules/audit/auditLogger.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/audit/auditLogger.js')>();
  return { ...mod, audit: vi.fn(async () => undefined), auditFromContext: vi.fn(async () => undefined) };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import { realtimeHub, type RealtimeSocket } from '../../src/modules/realtime/hub.js';
import { mytrionInboxMessageRepo } from '../../src/repos/mytrionInboxMessageRepo.js';
import type { MytrionInboxMessage } from '../../src/db/schema/index.js';

const repo = vi.mocked(mytrionInboxMessageRepo);

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
  repo.listForOwner.mockResolvedValue([]);
  repo.deleteForOwner.mockResolvedValue(true);
});

const WEBHOOK_HEADERS = { 'x-inbox-secret': 'test-inbox-secret', 'content-type': 'application/json' };

async function workerToken(profile: string, zohoUserId = '42'): Promise<string> {
  return signAccessToken({
    userId: `zoho:${zohoUserId}`,
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin', // stale claim — role is re-derived from the profile at verify
    worker: { zohoUserId, userName: 'Robiya', profile },
  });
}

function messageRow(overrides: Partial<MytrionInboxMessage> = {}): MytrionInboxMessage {
  return {
    id: 'mim_1',
    tenantId: DEFAULT_TENANT_ID,
    zohoRecordId: null,
    ownerZohoUserId: '42',
    ownerName: 'Joseph Gustavo',
    ownerEmail: 'joseph.g@octanefuel.com',
    subject: 'New Task Assigned',
    name: null,
    content: 'You have a new task',
    type: 'Task',
    priority: 'high',
    tag: null,
    sourceUrl: 'https://crm.zoho.com/x',
    recordStatus: 'Available',
    zohoCreatedAt: null,
    readAt: null,
    createdAt: new Date('2026-07-23T10:00:00.000Z'),
    updatedAt: new Date('2026-07-23T10:00:00.000Z'),
    ...overrides,
  } as MytrionInboxMessage;
}

function fakeSocket(): RealtimeSocket & { frames: string[] } {
  const frames: string[] = [];
  return { frames, readyState: 1, send: (d: string) => void frames.push(d) };
}

describe('inbox messages webhook — auth', () => {
  it('rejects a missing secret', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/inbox/messages/webhook',
      headers: { 'content-type': 'application/json' },
      payload: { ownerId: '42', subject: 'x' },
    });
    expect(res.statusCode).toBe(401);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects a wrong secret', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/inbox/messages/webhook',
      headers: { 'x-inbox-secret': 'nope', 'content-type': 'application/json' },
      payload: { ownerId: '42', subject: 'x' },
    });
    expect(res.statusCode).toBe(401);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects an empty body (owner + subject required)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/inbox/messages/webhook',
      headers: WEBHOOK_HEADERS,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe('inbox messages webhook — create + publish', () => {
  it('creates from normalized fields, persists, and pushes live to the owner topic', async () => {
    repo.create.mockResolvedValueOnce(messageRow({ ownerZohoUserId: '42' }));
    const sock = fakeSocket();
    realtimeHub.subscribe(sock, 'inbox:worker:42');
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/inbox/messages/webhook',
        headers: WEBHOOK_HEADERS,
        payload: { ownerId: '42', subject: 'New Task', content: 'hi', type: 'Task', priority: 'high' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ id: 'mim_1', delivered: 1 });
      expect(repo.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ ownerZohoUserId: '42', subject: 'New Task', type: 'Task', priority: 'high' }),
      );
      expect(sock.frames).toHaveLength(1);
      expect(JSON.parse(sock.frames[0]!)).toMatchObject({
        kind: 'event',
        topic: 'inbox:worker:42',
        event: { type: 'inbox.message.created', ownerId: '42', title: 'New Task Assigned' },
      });
    } finally {
      realtimeHub.dropSocket(sock);
    }
  });

  it('accepts Zoho field casing + a nested Owner object', async () => {
    repo.create.mockResolvedValueOnce(messageRow());
    const res = await app.inject({
      method: 'POST',
      url: '/v1/inbox/messages/webhook',
      headers: WEBHOOK_HEADERS,
      payload: {
        id: '6227679000194091850',
        Owner: { id: '6227679000047829017', name: 'Joseph Gustavo', email: 'joseph.g@octanefuel.com' },
        Subject: 'New Task Assigned: New Wex Task Received',
        Content: 'You have been assigned a new task',
        Type: 'Task',
        Priority: 'high',
        Source_Url: 'https://crm.zoho.com/x',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(repo.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        zohoRecordId: '6227679000194091850',
        ownerZohoUserId: '6227679000047829017',
        ownerName: 'Joseph Gustavo',
        subject: 'New Task Assigned: New Wex Task Received',
        type: 'Task',
        sourceUrl: 'https://crm.zoho.com/x',
      }),
    );
  });
});

describe('inbox messages — list (owner-scoped)', () => {
  it('rejects unauthenticated access', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/inbox/messages' });
    expect(res.statusCode).toBe(401);
  });

  it('a worker lists ONLY their own inbox — an owner_id override is ignored', async () => {
    repo.listForOwner.mockResolvedValueOnce([messageRow({ ownerZohoUserId: '42' })]);
    const token = await workerToken('Sales Rep', '42');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/inbox/messages?owner_id=77', // must NOT leak owner 77's inbox
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(repo.listForOwner).toHaveBeenCalledWith(expect.anything(), '42', expect.anything());
    const body = res.json() as { messages: Array<{ id: string }> };
    expect(body.messages).toHaveLength(1);
  });
});

describe('inbox messages — delete (owner-scoped)', () => {
  it('deletes the caller-owned message', async () => {
    repo.deleteForOwner.mockResolvedValueOnce(true);
    const token = await workerToken('Sales Rep', '42');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/inbox/messages/mim_1/delete',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ deleted: true, id: 'mim_1' });
    expect(repo.deleteForOwner).toHaveBeenCalledWith(expect.anything(), 'mim_1', '42');
  });

  it('404 when the message is not the caller-owned / does not exist', async () => {
    repo.deleteForOwner.mockResolvedValueOnce(false);
    const token = await workerToken('Sales Rep', '42');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/inbox/messages/mim_missing/delete',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });
});
