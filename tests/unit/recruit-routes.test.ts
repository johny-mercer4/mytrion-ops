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
    setCandidateResume: vi.fn(),
    clearCandidateResume: vi.fn(),
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

// Storage is mocked so tests never reach Dropbox; only the recruit-specific exports are overridden.
const { putMock, presignMock, deleteMock } = vi.hoisted(() => ({
  putMock: vi.fn(async () => undefined),
  presignMock: vi.fn(async () => ({
    url: 'https://dropbox.example/cv.pdf',
    expiresAt: new Date('2026-08-19T00:00:00.000Z'),
  })),
  deleteMock: vi.fn(async () => undefined),
}));

vi.mock('../../src/modules/files/storage/index.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/files/storage/index.js')>();
  return {
    ...mod,
    recruitStorageProvider: () => 'dropbox_recruit' as const,
    storageFor: () => ({ put: putMock, presignGet: presignMock, delete: deleteMock }),
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

function fakeCandidate(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-08-01T00:00:00.000Z');
  return {
    id: 'rca_1',
    tenantId: DEFAULT_TENANT_ID,
    jobOpeningId: 'rjo_1',
    jobTitle: 'Engineer',
    departmentId: 'hrd_1',
    departmentName: 'Engineering',
    firstName: 'Ada',
    lastName: 'Byron',
    email: null,
    phone: null,
    stage: 'new',
    source: null,
    currentCompany: null,
    currentTitle: null,
    notes: null,
    resumeFileKey: null,
    resumeFileName: null,
    resumeContentType: null,
    resumeStorageProvider: null,
    resumeUploadedAt: null,
    appliedAt: now,
    convertedEmployeeId: null,
    convertedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function multipartPdf(boundary: string): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="cv.pdf"\r\n` +
        'Content-Type: application/pdf\r\n\r\n',
    ),
    Buffer.from('%PDF-1.4 test resume'),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
}

describe('Recruit candidate resumes', () => {
  it('refuses a resume upload from a worker without Recruit access', async () => {
    const token = await workerToken('Sales Agent', 'resume-outsider');
    const boundary = '----recruitTest';
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recruit/candidates/rca_1/resume',
      headers: { ...bearer(token), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipartPdf(boundary),
    });
    expect(res.statusCode).toBe(403);
    expect(putMock).not.toHaveBeenCalled();
  });

  it('uploads a resume into a per-candidate Dropbox folder for a Recruiter', async () => {
    repo.getCandidate.mockResolvedValue(
      fakeCandidate({
        resumeFileKey: 'candidates/rca_1/cv.pdf',
        resumeFileName: 'cv.pdf',
        resumeContentType: 'application/pdf',
        resumeStorageProvider: 'dropbox_recruit',
        resumeUploadedAt: new Date('2026-08-02T00:00:00.000Z'),
      }) as never,
    );
    repo.setCandidateResume.mockResolvedValue(fakeCandidate({ resumeFileName: 'cv.pdf' }) as never);
    const token = await workerToken('Recruiter', 'resume-recruiter');
    const boundary = '----recruitTest';
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recruit/candidates/rca_1/resume',
      headers: { ...bearer(token), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipartPdf(boundary),
    });
    expect(res.statusCode).toBe(200);
    // New per-candidate folder key, and the bytes went through storage — never straight to Dropbox in a test.
    expect(putMock).toHaveBeenCalledWith('candidates/rca_1/cv.pdf', expect.any(Buffer), {
      contentType: 'application/pdf',
    });
    expect(res.json().resume).toMatchObject({ fileName: 'cv.pdf' });
  });

  it('mints a short-lived resume link for HR when one exists', async () => {
    repo.getCandidate.mockResolvedValue(
      fakeCandidate({
        resumeFileKey: 'candidates/rca_1/cv.pdf',
        resumeFileName: 'cv.pdf',
        resumeStorageProvider: 'dropbox_recruit',
      }) as never,
    );
    const token = await workerToken('HR', 'resume-hr');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/recruit/candidates/rca_1/resume/link',
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(200);
    expect(presignMock).toHaveBeenCalledWith('candidates/rca_1/cv.pdf', { filename: 'cv.pdf' });
    expect(res.json()).toMatchObject({ url: 'https://dropbox.example/cv.pdf' });
  });
});
