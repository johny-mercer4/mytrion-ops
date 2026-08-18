import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

vi.mock('../../src/repos/recruitRepo.js', () => ({
  recruitRepo: {
    listJobs: vi.fn(async () => []),
    getJob: vi.fn(),
    createJob: vi.fn(),
    updateJob: vi.fn(),
    deleteJob: vi.fn(),
    listCandidates: vi.fn(async () => []),
    getCandidate: vi.fn(),
    createCandidate: vi.fn(),
    updateCandidate: vi.fn(),
    deleteCandidate: vi.fn(),
    convertCandidate: vi.fn(),
    getSettings: vi.fn(async () => ({
      id: 'rcs_1',
      tenantId: 'octane',
      defaultLocation: null,
      employeeIdPrefix: 'EMP',
      defaultEmployeeStatus: 'Active',
      createdAt: new Date('2026-07-30T00:00:00.000Z'),
      updatedAt: new Date('2026-07-30T00:00:00.000Z'),
    })),
    updateSettings: vi.fn(),
  },
}));

vi.mock('../../src/modules/audit/auditLogger.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/modules/audit/auditLogger.js')>();
  return {
    ...original,
    audit: vi.fn(async () => undefined),
    auditFromContext: vi.fn(async () => undefined),
  };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import { recruitRepo } from '../../src/repos/recruitRepo.js';

const repo = vi.mocked(recruitRepo);
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
  repo.listJobs.mockResolvedValue([]);
  repo.listCandidates.mockResolvedValue([]);
});

async function workerToken(profile: string, zohoUserId: string): Promise<string> {
  return signAccessToken({
    userId: `zoho:${zohoUserId}`,
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin',
    worker: { zohoUserId, userName: 'Recruit Test', profile },
  });
}

const bearer = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
});

describe('Recruit workspace routes', () => {
  it('refuses unauthenticated reads', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/recruit/jobs' });
    expect(response.statusCode).toBe(401);
    expect(repo.listJobs).not.toHaveBeenCalled();
  });

  it('refuses a worker without Recruit access', async () => {
    const token = await workerToken('Sales Agent', 'recruit-outsider');
    const response = await app.inject({
      method: 'GET',
      url: '/v1/recruit/jobs',
      headers: bearer(token),
    });
    expect(response.statusCode).toBe(403);
    expect(repo.listJobs).not.toHaveBeenCalled();
  });

  it('allows the Recruiter profile to read the workspace', async () => {
    const token = await workerToken('Recruiter', 'recruit-reader');
    const response = await app.inject({
      method: 'GET',
      url: '/v1/recruit/jobs',
      headers: bearer(token),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [] });
  });

  it('gives HR full CRUD in the hiring workspace (co-owned with Recruiters)', async () => {
    const token = await workerToken('HR', 'recruit-hr');
    const read = await app.inject({
      method: 'GET',
      url: '/v1/recruit/jobs',
      headers: bearer(token),
    });
    expect(read.statusCode).toBe(200);

    repo.createJob.mockResolvedValueOnce({ id: 'rjo_hr' } as never);
    const write = await app.inject({
      method: 'POST',
      url: '/v1/recruit/jobs',
      headers: bearer(token),
      payload: { title: 'Backend Engineer', departmentId: 'hrd_1' },
    });
    // The write GUARD admitted HR — the point of this test — and their input reached the repo.
    expect(write.statusCode).not.toBe(403);
    expect(repo.createJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ title: 'Backend Engineer', departmentId: 'hrd_1' }),
    );
  });

  it('keeps candidate conversion admin-only', async () => {
    const token = await workerToken('Recruiter', 'recruit-convert-denied');
    const response = await app.inject({
      method: 'POST',
      url: '/v1/recruit/candidates/rca_1/convert',
      headers: bearer(token),
      payload: {},
    });
    expect(response.statusCode).toBe(403);
    expect(repo.convertCandidate).not.toHaveBeenCalled();
  });

  it('keeps Recruit settings admin-only', async () => {
    const token = await workerToken('Recruiter', 'recruit-settings-denied');
    const response = await app.inject({
      method: 'GET',
      url: '/v1/recruit/settings',
      headers: bearer(token),
    });
    expect(response.statusCode).toBe(403);
    expect(repo.getSettings).not.toHaveBeenCalled();
  });

  it('allows an Administrator to read Recruit settings', async () => {
    const token = await workerToken('Administrator', 'recruit-admin');
    const response = await app.inject({
      method: 'GET',
      url: '/v1/recruit/settings',
      headers: bearer(token),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      employeeIdPrefix: 'EMP',
      defaultEmployeeStatus: 'Active',
    });
  });
});
