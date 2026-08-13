import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

vi.mock('../../src/repos/mytrionAnnouncementRepo.js', () => ({
  mytrionAnnouncementRepo: {
    create: vi.fn(),
    listForManager: vi.fn(),
    listForReader: vi.fn(),
    markRead: vi.fn(),
    recordView: vi.fn(),
  },
}));

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import { mytrionAnnouncementRepo } from '../../src/repos/mytrionAnnouncementRepo.js';

const repo = vi.mocked(mytrionAnnouncementRepo);
const now = new Date('2026-08-13T12:00:00.000Z');

function announcement(overrides: Record<string, unknown> = {}) {
  return {
    id: 'man_1',
    tenantId: DEFAULT_TENANT_ID,
    title: 'Q3 Sales Target Update',
    body: 'Target raised to **12,000 gallons**.',
    targetDepartments: ['sales'],
    priority: 'normal',
    createdByUserId: 'zoho:42',
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function token(input: { profile: string; role?: 'admin' | 'worker' }) {
  return signAccessToken({
    userId: input.profile === 'Management' ? 'zoho:42' : 'zoho:77',
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: input.role ?? 'worker',
    worker: {
      zohoUserId: input.profile === 'Management' ? '42' : '77',
      userName: input.profile === 'Management' ? 'Robiya' : 'Sales Agent',
      profile: input.profile,
    },
  });
}

const bearer = (value: string) => ({ authorization: `Bearer ${value}` });
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => app.close());
beforeEach(() => {
  vi.clearAllMocks();
  repo.listForManager.mockResolvedValue([]);
  repo.listForReader.mockResolvedValue([]);
  repo.markRead.mockResolvedValue(true);
  repo.recordView.mockResolvedValue(true);
});

describe('manager announcements', () => {
  it('requires management access', async () => {
    const salesToken = await token({ profile: 'Sales Rep' });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/manager/announcements',
      headers: bearer(salesToken),
      payload: { title: 'Update', body: 'Details', targetDepartments: ['sales'] },
    });
    expect(response.statusCode).toBe(403);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('validates and publishes to explicit departments', async () => {
    repo.create.mockResolvedValue(announcement() as never);
    const managerToken = await token({ profile: 'Management', role: 'admin' });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/manager/announcements',
      headers: bearer(managerToken),
      payload: {
        title: '  Q3 Sales Target Update  ',
        body: 'Target raised to **12,000 gallons**.',
        targetDepartments: ['sales', 'sales'],
        priority: 'high',
      },
    });
    expect(response.statusCode).toBe(201);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: DEFAULT_TENANT_ID }),
      {
        title: 'Q3 Sales Target Update',
        body: 'Target raised to **12,000 gallons**.',
        targetDepartments: ['sales'],
        priority: 'high',
      },
    );
  });

  it('rejects a publish with no target departments', async () => {
    const managerToken = await token({ profile: 'Management', role: 'admin' });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/manager/announcements',
      headers: bearer(managerToken),
      payload: { title: 'Update', body: 'Details', targetDepartments: [] },
    });
    expect(response.statusCode).toBe(400);
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe('department announcement lifecycle', () => {
  it('lists the signed-in worker’s department feed with read state', async () => {
    repo.listForReader.mockResolvedValue([
      { ...announcement(), readAt: null },
      { ...announcement({ id: 'man_2' }), readAt: now },
    ] as never);
    const salesToken = await token({ profile: 'Sales Rep' });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/announcements',
      headers: bearer(salesToken),
    });
    expect(response.statusCode).toBe(200);
    expect(repo.listForReader).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'zoho:77' }),
      'zoho:77',
      ['sales'],
      100,
    );
    expect(response.json().announcements.map((row: { read: boolean }) => row.read)).toEqual([
      false,
      true,
    ]);
  });

  it('marks one targeted announcement read idempotently', async () => {
    const salesToken = await token({ profile: 'Sales Rep' });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/announcements/man_1/read',
      headers: bearer(salesToken),
    });
    expect(response.statusCode).toBe(200);
    expect(repo.markRead).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: DEFAULT_TENANT_ID }),
      'man_1',
      'zoho:77',
      ['sales'],
    );
  });

  it('records a unique view without marking the announcement read', async () => {
    const salesToken = await token({ profile: 'Sales Rep' });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/announcements/man_1/view',
      headers: bearer(salesToken),
    });
    expect(response.statusCode).toBe(200);
    expect(repo.recordView).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: DEFAULT_TENANT_ID }),
      'man_1',
      'zoho:77',
      ['sales'],
    );
    expect(repo.markRead).not.toHaveBeenCalled();
  });

  it('does not expose an announcement outside the reader audience', async () => {
    repo.markRead.mockResolvedValue(false);
    const salesToken = await token({ profile: 'Sales Rep' });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/announcements/man_billing/read',
      headers: bearer(salesToken),
    });
    expect(response.statusCode).toBe(404);
  });
});
