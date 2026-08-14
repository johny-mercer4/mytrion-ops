/**
 * Sales application intake (`/v1/verification/applications*`) — department RBAC and the gate rules.
 *
 * The boundary asserted here is the inverse of `verification-cases-routes.test.ts`: these routes are
 * SALES-gated, so a Verification-only worker must be refused. Two desks, two doors, one row.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

vi.mock('../../src/modules/verificationFlow/applicationService.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../src/modules/verificationFlow/applicationService.js')
  >('../../src/modules/verificationFlow/applicationService.js');
  return {
    ...actual,
    applicationService: {
      create: vi.fn(),
      get: vi.fn(),
      patch: vi.fn(),
      submit: vi.fn(),
      addPrincipal: vi.fn(),
      removePrincipal: vi.fn(),
      listForAgent: vi.fn(),
      assertSalesMayEdit: vi.fn(),
    },
  };
});

vi.mock('../../src/modules/verificationFlow/documentService.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../src/modules/verificationFlow/documentService.js')
  >('../../src/modules/verificationFlow/documentService.js');
  return {
    ...actual,
    documentService: {
      list: vi.fn(),
      upload: vi.fn(),
      request: vi.fn(),
      downloadUrl: vi.fn(),
      remove: vi.fn(),
    },
  };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { AppError } from '../../src/lib/errors.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import { applicationService } from '../../src/modules/verificationFlow/applicationService.js';

const createMock = vi.mocked(applicationService.create);
const getMock = vi.mocked(applicationService.get);
const patchMock = vi.mocked(applicationService.patch);
const submitMock = vi.mocked(applicationService.submit);
const listMock = vi.mocked(applicationService.listForAgent);

const detail = {
  case: {
    id: 'vc_1',
    companyName: 'Kaiser Freight LLC',
    applicantType: 'carrier',
    verificationProcess: false,
    statusCode: 'intake_incomplete',
    phaseCode: 'p1_intake',
    fuelCardsRequested: 12,
    trucksCount: 14,
  },
  principals: [],
  documents: [],
  intake: { complete: false, missing: [{ field: 'ein', label: 'EIN', section: 'business' }] },
  underwritingRoute: 'octane_internal',
  reviewOrder: 'banking_first',
} as unknown as Awaited<ReturnType<typeof applicationService.get>>;

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
  createMock.mockResolvedValue(detail);
  getMock.mockResolvedValue(detail);
  patchMock.mockResolvedValue(detail);
  submitMock.mockResolvedValue(detail);
  listMock.mockResolvedValue({ items: [], total: 0 });
});

async function workerToken(profile: string): Promise<string> {
  return signAccessToken({
    userId: 'zoho:42',
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin',
    worker: { zohoUserId: '42', userName: 'Test Worker', profile },
  });
}

const bearer = (t: string): Record<string, string> => ({ authorization: `Bearer ${t}` });

describe('auth boundary', () => {
  it('refuses unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/verification/applications' });
    expect(res.statusCode).toBe(401);
    expect(listMock).not.toHaveBeenCalled();
  });

  it('REFUSES a verification-only worker — intake belongs to Sales', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/applications',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBe(403);
    expect(listMock).not.toHaveBeenCalled();
  });

  it('admits a sales worker', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/applications',
      headers: bearer(await workerToken('Sales Rep')),
    });
    expect(res.statusCode).toBe(200);
    expect(listMock).toHaveBeenCalled();
  });

  it('guards every write route against a verification-only worker', async () => {
    const token = bearer(await workerToken('Verification'));
    const writes: Array<[string, string]> = [
      ['POST', '/v1/verification/applications'],
      ['POST', '/v1/verification/applications/vc_1'],
      ['POST', '/v1/verification/applications/vc_1/submit'],
      ['POST', '/v1/verification/applications/vc_1/principals'],
    ];
    for (const [method, url] of writes) {
      const res = await app.inject({ method: method as 'POST', url, headers: token, payload: {} });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
  });
});

describe('route wiring', () => {
  it('is not shadowed by the /verification/cases/:id route', async () => {
    // Registration order matters: `applications` would otherwise be read as a case id.
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/applications',
      headers: bearer(await workerToken('Sales Rep')),
    });
    expect(res.statusCode).toBe(200);
    expect(listMock).toHaveBeenCalled();
  });

  it('creates a draft and returns 201 with the red gate', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verification/applications',
      headers: bearer(await workerToken('Sales Rep')),
      payload: { applicantType: 'carrier' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().case.verificationProcess).toBe(false);
    expect(createMock).toHaveBeenCalled();
  });

  it('rejects an unknown applicant type rather than storing it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verification/applications',
      headers: bearer(await workerToken('Sales Rep')),
      payload: { applicantType: 'sole_trader' },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric SSN last 4', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verification/applications/vc_1',
      headers: bearer(await workerToken('Sales Rep')),
      payload: { ssnLast4: 'abcd' },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(patchMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed email', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verification/applications/vc_1',
      headers: bearer(await workerToken('Sales Rep')),
      payload: { email: 'not-an-email' },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('accepts an empty string as an explicit clear', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verification/applications/vc_1',
      headers: bearer(await workerToken('Sales Rep')),
      payload: { mc: '' },
    });
    expect(res.statusCode).toBe(200);
    expect(patchMock).toHaveBeenCalledWith(expect.anything(), 'vc_1', { mc: null });
  });

  it('surfaces the outstanding list when submit refuses', async () => {
    submitMock.mockRejectedValue(
      new AppError('This application is missing 1 item(s): EIN.', {
        statusCode: 422,
        code: 'VERIFICATION_INTAKE_INCOMPLETE',
        expose: true,
      }),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verification/applications/vc_1/submit',
      headers: bearer(await workerToken('Sales Rep')),
      payload: {},
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error?.message ?? res.json().message).toMatch(/EIN/);
  });
});
