import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
  process.env.FF_AUDIT_LOG_ENABLED = '1';
});

const automationMocks = vi.hoisted(() => ({
  insert: vi.fn(),
  list: vi.fn(async () => []),
  count: vi.fn(async () => 0),
  facets: vi.fn(async () => ({ automationTypes: [], agentNames: [], originSources: [] })),
}));
const auditMock = vi.hoisted(() => vi.fn(async () => undefined));
const resolveActAsMock = vi.hoisted(() => vi.fn());
const resolveAccessMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/repos/automationLogRepo.js', () => ({
  automationLogRepo: automationMocks,
  AUTOMATION_EXPORT_MAX: 10_000,
}));
vi.mock('../../src/modules/audit/auditLogger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/modules/audit/auditLogger.js')>();
  return { ...actual, audit: auditMock, auditFromContext: auditMock };
});
vi.mock('../../src/modules/auth/actAsDirectory.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/modules/auth/actAsDirectory.js')>();
  return { ...actual, resolveActAsTarget: resolveActAsMock };
});
vi.mock('../../src/modules/access/mytrionAccessService.js', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../src/modules/access/mytrionAccessService.js')
  >();
  return {
    ...actual,
    mytrionAccessService: {
      ...actual.mytrionAccessService,
      resolveWorkerAccess: resolveAccessMock,
    },
  };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import type { AutomationLog } from '../../src/db/schema/index.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';

const now = new Date('2026-08-18T12:00:00.000Z');

function log(overrides: Partial<AutomationLog> = {}): AutomationLog {
  return {
    id: 'log_1',
    tenantId: DEFAULT_TENANT_ID,
    runId: '4f86cf44-1daa-4fd3-8df5-999cb27430c9',
    phase: 'started',
    durationMs: null,
    errorCode: null,
    sourceMytrion: 'sales',
    actorUserId: 'zoho:42',
    impersonatorUserId: null,
    triggerTime: null,
    triggerDate: null,
    automationType: 'balance_check',
    agentName: null,
    originSource: 'Mytrion Horizon',
    createdAt: now,
    ...overrides,
  };
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => app.close());

beforeEach(() => {
  vi.clearAllMocks();
  automationMocks.insert.mockResolvedValue({ log: log(), inserted: true });
  resolveActAsMock.mockResolvedValue({
    zohoUserId: '777',
    name: 'Viewed Sales Agent',
    profile: 'Sales Agent',
    role: 'Agent',
  });
  resolveAccessMock.mockImplementation(async (input: { zohoUserId: string }) => ({
    accessibleMytrions: input.zohoUserId === 'hr1' ? ['hr'] : ['sales'],
    homeMytrion: input.zohoUserId === 'hr1' ? 'hr' : 'sales',
    allDepartmentAccess: input.zohoUserId === 'admin1',
    departments: input.zohoUserId === 'admin1'
      ? []
      : input.zohoUserId === 'hr1' ? ['hr'] : ['sales'],
    viewAsUserIds: [],
    mytrionAccessModes: { sales: 'full' },
    mytrionTabGrants: {},
  }));
});

async function authorization(): Promise<string> {
  const token = await signAccessToken({
    userId: 'zoho:42',
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'worker',
    worker: { zohoUserId: '42', userName: 'Sales Agent', profile: 'Sales Agent' },
  });
  return `Bearer ${token}`;
}

async function adminAuthorization(): Promise<string> {
  const token = await signAccessToken({
    userId: 'zoho:admin1',
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin',
    worker: { zohoUserId: 'admin1', userName: 'Admin', profile: 'Administrator' },
  });
  return `Bearer ${token}`;
}

async function nonSalesAuthorization(): Promise<string> {
  const token = await signAccessToken({
    userId: 'zoho:hr1',
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'worker',
    worker: { zohoUserId: 'hr1', userName: 'HR Agent', profile: 'HR Agent' },
  });
  return `Bearer ${token}`;
}

describe('automation lifecycle logging', () => {
  it('attributes a lifecycle phase from the verified server context', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/automation/logs',
      headers: { authorization: await authorization() },
      payload: {
        automationType: 'balance_check',
        runId: '4f86cf44-1daa-4fd3-8df5-999cb27430c9',
        phase: 'started',
        originSource: 'Mytrion Horizon',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(automationMocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: DEFAULT_TENANT_ID, userId: 'zoho:42' }),
      expect.objectContaining({ actorUserId: 'zoho:42', phase: 'started' }),
    );
    expect(response.json()).toMatchObject({ phase: 'started', replayed: false });
  });

  it('marks View-as lifecycle rows with the verified target and impersonator', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/automation/logs',
      headers: {
        authorization: await adminAuthorization(),
        'x-act-as-zoho-user-id': '777',
      },
      payload: {
        automationType: 'balance_check',
        runId: '4f86cf44-1daa-4fd3-8df5-999cb27430c9',
        phase: 'started',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(automationMocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'zoho:777', impersonatorUserId: 'zoho:admin1' }),
      expect.objectContaining({
        actorUserId: 'zoho:777',
        impersonatorUserId: 'zoho:admin1',
      }),
    );
  });

  it('rejects lifecycle rows from a non-Sales session', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/automation/logs',
      headers: { authorization: await nonSalesAuthorization() },
      payload: {
        automationType: 'balance_check',
        runId: '4f86cf44-1daa-4fd3-8df5-999cb27430c9',
        phase: 'started',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(automationMocks.insert).not.toHaveBeenCalled();
  });

  it('does not duplicate the audit row when an idempotent phase is replayed', async () => {
    automationMocks.insert.mockResolvedValue({ log: log(), inserted: false });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/automation/logs',
      headers: { authorization: await authorization() },
      payload: {
        automationType: 'balance_check',
        runId: '4f86cf44-1daa-4fd3-8df5-999cb27430c9',
        phase: 'started',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ replayed: true });
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('requires duration and a coarse error code for failed terminal rows', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/automation/logs',
      headers: { authorization: await authorization() },
      payload: {
        automationType: 'balance_check',
        runId: '4f86cf44-1daa-4fd3-8df5-999cb27430c9',
        phase: 'failed',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(automationMocks.insert).not.toHaveBeenCalled();
  });

  it('rejects arbitrary error tokens instead of persisting caller data', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/automation/logs',
      headers: { authorization: await authorization() },
      payload: {
        automationType: 'balance_check',
        runId: '4f86cf44-1daa-4fd3-8df5-999cb27430c9',
        phase: 'failed',
        durationMs: 50,
        errorCode: 'customer_12345_secret',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(automationMocks.insert).not.toHaveBeenCalled();
  });
});
