import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

vi.mock('../../src/modules/audit/auditLogger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/modules/audit/auditLogger.js')>();
  return {
    ...actual,
    audit: vi.fn(async () => undefined),
    auditFromContext: vi.fn(async () => undefined),
  };
});

vi.mock('../../src/modules/mytrionSchema/service.js', () => ({
  getMytrionSchema: vi.fn(async () => ({
    database: 'mytrion_test',
    fetchedAt: '2026-07-28T12:00:00.000Z',
    schemas: ['public'],
    tableCount: 1,
    columnCount: 2,
    tables: [
      {
        schema: 'public',
        name: 'kpi_workers',
        type: 'BASE TABLE',
        approxRows: 65,
        updateTime: '2026-07-28T11:00:00.000Z',
        createTime: null,
        comment: '',
        writeActivity: {
          inserts: 65,
          updates: 12,
          deletes: 0,
          totalWrites: 77,
          statsResetAt: '2026-07-20T00:00:00.000Z',
          writesPerDay: 9.625,
          frequency: 'Daily',
        },
        columns: [
          {
            name: 'id',
            type: 'text',
            dataType: 'text',
            nullable: false,
            key: 'PRI',
            default: null,
            extra: '',
            comment: '',
          },
          {
            name: 'tenant_id',
            type: 'text',
            dataType: 'text',
            nullable: false,
            key: '',
            default: null,
            extra: '',
            comment: '',
          },
        ],
      },
    ],
  })),
}));

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import { getMytrionSchema } from '../../src/modules/mytrionSchema/service.js';

const inspect = vi.mocked(getMytrionSchema);
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

async function token(profile: string): Promise<string> {
  return signAccessToken({
    userId: 'zoho:42',
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin',
    worker: { zohoUserId: '42', userName: 'Test Worker', profile },
  });
}

describe('Mytrion database metadata route', () => {
  it('rejects unauthenticated and non-admin reads', async () => {
    const unauthenticated = await app.inject({
      method: 'GET',
      url: '/v1/admin/mytrion-schema',
    });
    expect(unauthenticated.statusCode).toBe(401);

    const worker = await app.inject({
      method: 'GET',
      url: '/v1/admin/mytrion-schema',
      headers: { authorization: `Bearer ${await token('Billing Clerk')}` },
    });
    expect(worker.statusCode).toBe(403);
    expect(inspect).not.toHaveBeenCalled();
  });

  it('returns full metadata to a true Admin through the tenant-scoped service', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/mytrion-schema',
      headers: { authorization: `Bearer ${await token('Administrator')}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      database: 'mytrion_test',
      tableCount: 1,
      columnCount: 2,
    });
    expect(body.tables[0]).toMatchObject({
      name: 'kpi_workers',
      writeActivity: { frequency: 'Daily', totalWrites: 77 },
    });
    expect(body.tables[0].columns).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'id', dataType: 'text' })]),
    );
    expect(inspect).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: DEFAULT_TENANT_ID, audience: 'internal' }),
    );
  });
});
