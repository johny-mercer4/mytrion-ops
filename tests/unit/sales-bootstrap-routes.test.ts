import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  inbox: vi.fn(),
  tasks: vi.fn(),
  unread: vi.fn(),
  dispatch: vi.fn(),
  readiness: vi.fn(),
}));

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

vi.mock('../../src/repos/mytrionInboxMessageRepo.js', () => ({
  mytrionInboxMessageRepo: { countsForOwner: mocks.inbox },
}));
vi.mock('../../src/repos/workerTaskRepo.js', () => ({
  workerTaskRepo: { countByStatus: mocks.tasks },
}));
vi.mock('../../src/repos/commsThreadMemberRepo.js', () => ({
  commsThreadMemberRepo: { unreadTotals: mocks.unread },
}));
vi.mock('../../src/modules/touchpoints/dispatcher.js', () => ({
  dispatchTouchpoint: mocks.dispatch,
}));
vi.mock('../../src/modules/comms/readiness.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/modules/comms/readiness.js')>();
  return { ...actual, getCommsSchemaReadiness: mocks.readiness };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => app.close());

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inbox.mockResolvedValue({ all: 7, unread: 3, task: 2, alert: 1, reminder: 4 });
  mocks.tasks.mockResolvedValue({ open: 2, in_progress: 1, completed: 4, cancelled: 0 });
  mocks.unread.mockResolvedValue([{ threadId: 'thread-1', unread: 5 }]);
  mocks.readiness.mockResolvedValue({ ready: true, missing: [] });
  mocks.dispatch.mockImplementation(async (_ctx: unknown, key: string) => {
    if (key === 'dashboard.home_snapshot') return { data: [{ snapshot: { active_clients: 12 } }] };
    if (key === 'dashboard.debtors') {
      return { data: { total_debt_amount: 1200, total_debtors: 2, total_hard_debtors: 1 } };
    }
    if (key === 'activity.agent') return { data: { metrics: { calls: { completed: 6 } } } };
    return { data: [{ Subject: 'Policy update', Type: 'policy' }] };
  });
});

async function auth(zohoUserId: string): Promise<Record<string, string>> {
  const token = await signAccessToken({
    userId: `zoho:${zohoUserId}`,
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin',
    worker: { zohoUserId, userName: 'Sales Worker', profile: 'Sales Agent' },
  });
  return { authorization: `Bearer ${token}` };
}

describe('Sales bootstrap', () => {
  it('returns one owner-scoped shell payload and source freshness', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/sales/bootstrap',
      headers: await auth('bootstrap-42'),
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.inbox).toHaveBeenCalledWith(expect.anything(), 'bootstrap-42');
    expect(mocks.tasks).toHaveBeenCalledWith(expect.anything(), 'bootstrap-42');
    expect(response.json()).toMatchObject({
      identity: { zohoUserId: 'bootstrap-42', actingAs: false },
      badges: {
        inbox: 3,
        tickets: 5,
        tasks: 3,
        inboxCounts: { all: 7, unread: 3 },
      },
      home: {
        snapshot: [{ snapshot: { active_clients: 12 } }],
        debtors: { total_debt_amount: 1200 },
      },
      sourceHealth: { database: 'ok', communications: 'ok', homeSnapshot: 'ok' },
      partial: false,
      freshness: 'fresh',
    });
  });

  it('keeps the shell available with explicit degraded metadata', async () => {
    mocks.dispatch.mockRejectedValue(new Error('provider unavailable'));
    mocks.readiness.mockResolvedValue({ ready: false, missing: ['mytrion_threads'] });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/sales/bootstrap',
      headers: await auth('bootstrap-43'),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      identity: { zohoUserId: 'bootstrap-43' },
      communicationsReady: false,
      partial: true,
      sourceHealth: {
        communications: 'disabled',
        homeSnapshot: 'degraded',
        debtors: 'degraded',
        activity: 'degraded',
        announcements: 'degraded',
      },
      home: { snapshot: null, debtors: null, activity: null, announcements: null },
    });
    expect(mocks.unread).not.toHaveBeenCalled();
  });
});
