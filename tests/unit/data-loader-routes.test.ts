import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

const repoMocks = vi.hoisted(() => ({
  list: vi.fn(),
  count: vi.fn(),
  findBatch: vi.fn(),
  revert: vi.fn(),
}));

vi.mock('../../src/repos/bulkChangeLogRepo.js', () => ({
  bulkChangeLogRepo: repoMocks,
}));

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

async function workerAuthorization(): Promise<string> {
  const token = await signAccessToken({
    userId: 'zoho:worker-1',
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin',
    worker: {
      zohoUserId: 'worker-1',
      userName: 'Sales Worker',
      profile: 'Sales Agent',
    },
  });
  return `Bearer ${token}`;
}

async function adminAuthorization(): Promise<string> {
  const token = await signAccessToken({
    userId: 'admin-1',
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin',
  });
  return `Bearer ${token}`;
}

describe('Data Loader admin gate', () => {
  it('returns 403 to a non-admin on all four routes', async () => {
    const authorization = await workerAuthorization();
    const requests = [
      { method: 'GET' as const, url: '/v1/admin/data-loader/config' },
      { method: 'GET' as const, url: '/v1/admin/data-loader/batches' },
      { method: 'GET' as const, url: '/v1/admin/data-loader/batches/batch-1' },
      { method: 'POST' as const, url: '/v1/admin/data-loader/batches/batch-1/revert' },
    ];
    for (const request of requests) {
      const response = await app.inject({
        ...request,
        headers: { authorization },
      });
      expect(response.statusCode, request.url).toBe(403);
    }
  });
});

describe('Data Loader readiness', () => {
  it('returns an actionable 503 when migration 0069 is missing', async () => {
    repoMocks.list.mockRejectedValueOnce(
      Object.assign(new Error('relation "bulk_change_log" does not exist'), {
        code: '42P01',
      }),
    );
    repoMocks.count.mockResolvedValueOnce(0);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/data-loader/batches',
      headers: { authorization: await adminAuthorization() },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: {
        code: 'DATA_LOADER_NOT_READY',
        message: 'Data Loader migration 0069 is not applied.',
      },
    });
  });
});
