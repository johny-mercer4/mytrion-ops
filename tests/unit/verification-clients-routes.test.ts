/**
 * Verification Mytrion "Existing clients" roster (`/v1/verification/roster*`) — RBAC gate + shape.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

vi.mock('../../src/modules/verification/verificationClients.js', () => ({
  listVerificationClients: vi.fn(async () => []),
  getVerificationClientDetail: vi.fn(async () => null),
}));

vi.mock('../../src/modules/verification/carrierAttachmentService.js', () => ({
  carrierAttachmentService: {
    list: vi.fn(async () => []),
    upload: vi.fn(),
    downloadUrl: vi.fn(),
    getBytes: vi.fn(),
    remove: vi.fn(),
  },
}));

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import { carrierAttachmentService } from '../../src/modules/verification/carrierAttachmentService.js';
import {
  getVerificationClientDetail,
  listVerificationClients,
  type VerificationClientRow,
} from '../../src/modules/verification/verificationClients.js';

const listMock = vi.mocked(listVerificationClients);
const detailMock = vi.mocked(getVerificationClientDetail);
const attachments = vi.mocked(carrierAttachmentService);

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
  listMock.mockResolvedValue([]);
  detailMock.mockResolvedValue(null);
});

async function workerToken(profile: string): Promise<string> {
  return signAccessToken({
    userId: 'zoho:42',
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin', // stale — re-derived from profile
    worker: { zohoUserId: '42', userName: 'Test Worker', profile },
  });
}

const bearer = (t: string): Record<string, string> => ({ authorization: `Bearer ${t}` });

function clientRow(overrides: Partial<VerificationClientRow> = {}): VerificationClientRow {
  return {
    carrierId: '1001',
    companyName: 'Acme Trucking',
    companyType: 'DIRECT',
    paymentTerms: 'LOC',
    paymentDay: '15',
    minimumRequiredBalance: 500,
    billingCycleTag: 'Weekly',
    isDebtor: false,
    billingCycle: 'Weekly',
    creditLimit: 25000,
    creditScore: 720,
    isActive: true,
    lastTransactionAt: null,
    ...overrides,
  };
}

describe('Verification roster — auth', () => {
  it('GET /verification/roster refuses unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/verification/roster' });
    expect(res.statusCode).toBe(401);
    expect(listMock).not.toHaveBeenCalled();
  });

  it('GET /verification/roster REFUSES a sales worker — this is a different audience than Sales', async () => {
    // Verification and Sales are gated on different departments on purpose (different data,
    // different reviewers); a Sales profile must not read the company-wide verification roster.
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/roster',
      headers: bearer(await workerToken('Sales Rep')),
    });
    expect(res.statusCode).toBe(403);
    expect(listMock).not.toHaveBeenCalled();
  });

  it('GET /verification/roster allows a worker holding the verification department', async () => {
    listMock.mockResolvedValue([clientRow()]);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/roster',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ total: 1, items: [{ carrierId: '1001', companyName: 'Acme Trucking' }] });
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it('GET /verification/roster/:carrierId refuses a non-verification worker', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/roster/1001',
      headers: bearer(await workerToken('Sales Rep')),
    });
    expect(res.statusCode).toBe(403);
    expect(detailMock).not.toHaveBeenCalled();
  });
});

describe('Verification roster — detail', () => {
  it('returns one carrier’s full profile', async () => {
    detailMock.mockResolvedValue({
      ...clientRow(),
      contact: 'Jane Doe',
      phone: '555-0100',
      email: 'jane@acme.test',
      agentName: 'Agent Smith',
      agentEmail: 'agent@octanefuel.com',
      dot: '123456',
      address: '123 Main St, Springfield, IL',
      city: 'Springfield',
      state: 'IL',
      moneyCode: 'MC01',
      insuranceCoverage: 'Yes',
      creditsafeGrade: 'A',
      firstSwipeAt: '2024-01-01',
      lastTransactionAt: '2026-07-01',
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/roster/1001',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ carrierId: '1001', contact: 'Jane Doe', agentName: 'Agent Smith' });
    expect(detailMock).toHaveBeenCalledWith('1001');
  });

  it('404s for an unknown carrier', async () => {
    detailMock.mockResolvedValue(null);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/roster/999999',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBe(404);
  });

  it('an admin (any profile) can read the roster', async () => {
    listMock.mockResolvedValue([clientRow()]);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/roster',
      headers: bearer(await workerToken('Administrator')),
    });
    expect(res.statusCode).toBe(200);
  });

  it('surfaces a DWH failure as a 502, not a 500', async () => {
    listMock.mockRejectedValue(new Error('connection terminated'));
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/roster',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBe(502);
  });
});

describe('Verification roster — carrier attachments', () => {
  it('lists attachments for a verification worker, keyed on carrier id', async () => {
    attachments.list.mockResolvedValue([
      {
        id: 'cat_abc',
        carrierId: '1001',
        fileName: 'COI.pdf',
        mime: 'application/pdf',
        sizeBytes: 1200,
        uploadedByName: 'Test Worker',
        createdAt: '2026-08-15T00:00:00.000Z',
      },
    ]);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/roster/1001/attachments',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ attachments: [{ id: 'cat_abc', carrierId: '1001' }] });
    expect(attachments.list).toHaveBeenCalledWith(expect.objectContaining({ tenantId: DEFAULT_TENANT_ID }), '1001');
  });

  it('refuses a sales worker — attachments inherit the roster audience', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/roster/1001/attachments',
      headers: bearer(await workerToken('Sales Rep')),
    });
    expect(res.statusCode).toBe(403);
    expect(attachments.list).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric carrier id so files cannot be keyed on an arbitrary path', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/roster/not-a-carrier/attachments',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBe(400);
    expect(attachments.list).not.toHaveBeenCalled();
  });
});
