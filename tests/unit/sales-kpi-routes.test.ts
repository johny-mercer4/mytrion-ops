import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
  process.env.FF_KPI_COLLECTION_ENABLED = '1';
  process.env.MYTRION_TASK_WEBHOOK_KEY_ID = 'automation-1';
  process.env.MYTRION_TASK_WEBHOOK_SECRET = 'webhook-secret';
});

vi.mock('../../src/modules/audit/auditLogger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/modules/audit/auditLogger.js')>();
  return {
    ...actual,
    audit: vi.fn(async () => undefined),
    auditFromContext: vi.fn(async () => undefined),
  };
});

vi.mock('../../src/repos/kpiWorkerRepo.js', () => ({
  kpiWorkerRepo: {
    list: vi.fn(async () => []),
    findByZohoUserId: vi.fn(),
    isCurrentlyEligible: vi.fn(async () => true),
    sync: vi.fn(),
  },
}));

vi.mock('../../src/repos/workerTaskRepo.js', () => ({
  workerTaskRepo: {
    listTypes: vi.fn(async () => [
      {
        id: 'mtt_general',
        tenantId: 'octane',
        code: 'general',
        label: 'General',
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]),
    list: vi.fn(async () => []),
    countByStatus: vi.fn(async () => ({
      open: 0,
      in_progress: 0,
      completed: 0,
      cancelled: 0,
    })),
    findById: vi.fn(),
    findWebhookReplay: vi.fn(),
    listEvents: vi.fn(async () => []),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../../src/repos/kpiRepo.js', () => ({
  kpiRepo: {
    listIngestionRuns: vi.fn(async () => []),
    listDaily: vi.fn(async () => []),
    listMonthly: vi.fn(async () => []),
  },
}));

vi.mock('../../src/repos/kpiMappingRepo.js', () => ({
  kpiMappingRepo: {
    listUnresolved: vi.fn(async () => []),
    recordUnresolved: vi.fn(async () => undefined),
  },
}));

vi.mock('../../src/repos/kpiAdminRepo.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/repos/kpiAdminRepo.js')>();
  return {
    ...actual,
    kpiAdminRepo: {
      dateBounds: vi.fn(async () => ({ from: '2026-07-26', to: '2026-07-26' })),
      ingestionRuns: vi.fn(async () => []),
      tableCounts: vi.fn(async () => ({})),
      aggregateMetrics: vi.fn(async () => []),
      workers: vi.fn(async () => []),
      facts: vi.fn(async () => []),
    },
  };
});

vi.mock('../../src/repos/kpiTelemetryRepo.js', () => ({
  KPI_ACTIVITY_EVENT_NAMES: [
    'navigation.tab_open',
    'crm.lead_open',
    'crm.deal_open',
    'crm.call_click',
    'crm.edit_open',
    'crm.edit_save_success',
    'crm.edit_save_failed',
  ],
  kpiTelemetryRepo: {
    recordPresence: vi.fn(async () => 1),
    recordActivity: vi.fn(async () => 1),
  },
}));

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import type { KpiWorker, MytrionWorkerTask } from '../../src/db/schema/index.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import {
  expectedTaskWebhookSignature,
  webhookPayloadHash,
} from '../../src/modules/kpi/taskWebhookAuth.js';
import { kpiTelemetryRepo } from '../../src/repos/kpiTelemetryRepo.js';
import { kpiWorkerRepo } from '../../src/repos/kpiWorkerRepo.js';
import { workerTaskRepo } from '../../src/repos/workerTaskRepo.js';

const workers = vi.mocked(kpiWorkerRepo);
const tasks = vi.mocked(workerTaskRepo);
const telemetry = vi.mocked(kpiTelemetryRepo);

const now = new Date('2026-07-28T12:00:00.000Z');
const worker: KpiWorker = {
  id: 'kpw_42',
  tenantId: DEFAULT_TENANT_ID,
  zohoUserId: '42',
  displayName: 'Sales Worker',
  email: 'sales@example.com',
  currentProfileName: 'Sales Agent',
  currentRoleName: 'Agent',
  sourceActive: true,
  firstSeenAt: now,
  lastSeenAt: now,
  createdAt: now,
  updatedAt: now,
};
const task: MytrionWorkerTask = {
  id: 'mwt_1',
  tenantId: DEFAULT_TENANT_ID,
  assigneeZohoUserId: '42',
  createdByUserId: 'manager',
  source: 'manager',
  webhookKeyId: null,
  idempotencyKey: null,
  payloadHash: null,
  externalId: null,
  department: 'sales',
  taskType: 'general',
  subject: 'Follow up',
  description: null,
  content: null,
  priority: 'normal',
  status: 'open',
  deadlineAt: null,
  completedAt: null,
  cancelledAt: null,
  version: 1,
  createdAt: now,
  updatedAt: now,
};

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
  workers.findByZohoUserId.mockResolvedValue(worker);
  workers.isCurrentlyEligible.mockResolvedValue(true);
  workers.sync.mockResolvedValue(worker);
  tasks.findWebhookReplay.mockResolvedValue(undefined);
  tasks.create.mockResolvedValue(task);
  tasks.list.mockResolvedValue([]);
});

async function token(profile: string, zohoUserId = '42'): Promise<string> {
  return signAccessToken({
    userId: `zoho:${zohoUserId}`,
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin',
    worker: { zohoUserId, userName: 'Test Worker', profile },
  });
}

function bearer(value: string): Record<string, string> {
  return { authorization: `Bearer ${value}` };
}

describe('Sales KPI route boundaries', () => {
  it('rejects unauthenticated telemetry and non-admin KPI health reads', async () => {
    const telemetryResponse = await app.inject({
      method: 'POST',
      url: '/v1/kpi/presence',
      payload: {
        sessionId: 'session-123',
        events: [{ clientEventId: 'event-123', state: 'active' }],
      },
    });
    expect(telemetryResponse.statusCode).toBe(401);

    const managerResponse = await app.inject({
      method: 'GET',
      url: '/v1/admin/kpi/overview',
      headers: bearer(await token('Billing Clerk')),
    });
    expect(managerResponse.statusCode).toBe(403);
  });

  it('exposes collection and data only through Mytrion Admin', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/kpi/overview?from=2026-07-26&to=2026-07-26',
      headers: bearer(await token('Administrator')),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      reportingTimezone: 'America/New_York',
      range: { from: '2026-07-26', to: '2026-07-26' },
    });

    const removedManagerRoute = await app.inject({
      method: 'GET',
      url: '/v1/manager/sales/kpi/collection-health',
      headers: bearer(await token('Administrator')),
    });
    expect(removedManagerRoute.statusCode).toBe(404);
  });

  it('derives Sales task and telemetry identity from the verified session', async () => {
    const headers = bearer(await token('Sales Agent', '42'));
    const taskResponse = await app.inject({
      method: 'GET',
      url: '/v1/sales/tasks?assigneeZohoUserId=999',
      headers,
    });
    expect(taskResponse.statusCode).toBe(200);
    expect(tasks.list).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: DEFAULT_TENANT_ID, userId: 'zoho:42' }),
      expect.objectContaining({ assigneeZohoUserId: '42' }),
    );

    const presenceResponse = await app.inject({
      method: 'POST',
      url: '/v1/kpi/presence',
      headers,
      payload: {
        sessionId: 'session-123',
        events: [{ clientEventId: 'event-123', state: 'active' }],
      },
    });
    expect(presenceResponse.statusCode).toBe(202);
    expect(workers.sync).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: DEFAULT_TENANT_ID, userId: 'zoho:42' }),
      expect.objectContaining({ zohoUserId: '42' }),
    );
    expect(telemetry.recordPresence).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: DEFAULT_TENANT_ID }),
      'kpw_42',
      expect.stringContaining('kpw_42'),
      expect.anything(),
      expect.any(Array),
    );
  });

  it('rejects activity names outside the privacy allowlist', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/kpi/activity-events',
      headers: bearer(await token('Sales Agent')),
      payload: {
        events: [
          {
            clientEventId: 'event-privacy-1',
            eventName: 'dom.arbitrary_click',
            metadata: { phoneNumber: '+15550100' },
          },
        ],
      },
    });
    expect(response.statusCode).toBe(400);
    expect(telemetry.recordActivity).not.toHaveBeenCalled();
  });
});

describe('task webhook authentication and idempotency', () => {
  const body = {
    assigneeZohoUserId: '42',
    type: 'general',
    subject: 'Follow up',
    priority: 'high',
    externalId: 'automation-77',
  };

  it('requires a valid signed timestamp and idempotency key', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/mytrion-tasks',
      payload: body,
    });
    expect(response.statusCode).toBe(401);
    expect(tasks.create).not.toHaveBeenCalled();
  });

  it('creates once and returns the stored task for an identical replay', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = expectedTaskWebhookSignature('webhook-secret', timestamp, body);
    const headers = {
      'x-webhook-key-id': 'automation-1',
      'x-webhook-timestamp': timestamp,
      'x-webhook-signature': signature,
      'idempotency-key': 'retry-key-1',
    };
    const created = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/mytrion-tasks',
      headers,
      payload: body,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ replayed: false, task: { id: 'mwt_1' } });

    tasks.findWebhookReplay.mockResolvedValue({
      ...task,
      source: 'webhook',
      webhookKeyId: 'automation-1',
      idempotencyKey: 'retry-key-1',
      payloadHash: webhookPayloadHash(body),
    });
    const replay = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/mytrion-tasks',
      headers,
      payload: body,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ replayed: true, task: { id: 'mwt_1' } });
    expect(tasks.create).toHaveBeenCalledTimes(1);
  });

  it('returns conflict when an idempotency key is reused with different content', async () => {
    tasks.findWebhookReplay.mockResolvedValue({
      ...task,
      source: 'webhook',
      webhookKeyId: 'automation-1',
      idempotencyKey: 'retry-key-2',
      payloadHash: 'different',
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers = {
      'x-webhook-key-id': 'automation-1',
      'x-webhook-timestamp': timestamp,
      'x-webhook-signature': expectedTaskWebhookSignature('webhook-secret', timestamp, body),
      'idempotency-key': 'retry-key-2',
    };
    const response = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/mytrion-tasks',
      headers,
      payload: body,
    });
    expect(response.statusCode).toBe(409);
    expect(tasks.create).not.toHaveBeenCalled();
  });
});
