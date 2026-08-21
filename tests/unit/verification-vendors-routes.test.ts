/**
 * Data Center vendor routes. HTTP to iSoftPull / Plaid is mocked. Highway parse is local.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

const pullIsoftPullReport = vi.fn();
const createPlaidLinkToken = vi.fn();
const insertAttempt = vi.fn(async (_input: unknown) => undefined);
const resolveAttempt = vi.fn(async (_id: unknown, _status: unknown) => undefined);

vi.mock('../../src/integrations/isoftpullClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/integrations/isoftpullClient.js')>();
  return {
    ...actual,
    pullIsoftPullReport: (input: unknown) => pullIsoftPullReport(input),
  };
});
vi.mock('../../src/integrations/plaidClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/integrations/plaidClient.js')>();
  return {
    ...actual,
    createPlaidLinkToken: (input: unknown) => createPlaidLinkToken(input),
  };
});
vi.mock('../../src/repos/vendorSpendLedgerRepo.js', () => ({
  vendorSpendLedgerRepo: {
    insertAttempt: (input: unknown) => insertAttempt(input),
    resolveAttempt: (id: unknown, status: unknown) => resolveAttempt(id, status),
  },
}));
vi.mock('../../src/modules/audit/auditLogger.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/audit/auditLogger.js')>();
  return { ...mod, audit: vi.fn(async () => undefined), auditFromContext: vi.fn(async () => undefined) };
});

import { buildApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
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
beforeEach(() => {
  pullIsoftPullReport.mockReset();
  createPlaidLinkToken.mockReset();
  insertAttempt.mockReset();
  resolveAttempt.mockReset();
  insertAttempt.mockResolvedValue(undefined);
  resolveAttempt.mockResolvedValue(undefined);
  env.ISOFTPULL_LIVE_ENABLED = false;
  env.VERIFICATION_PAID_VENDORS_ENABLED = false;
  env.PLAID_LIVE_ENABLED = false;
  env.ISOFTPULL_BASE_URL = '';
  env.ISOFTPULL_EQUIFAX_API_KEY = '';
  env.ISOFTPULL_EQUIFAX_API_SECRET = '';
  env.PLAID_CLIENT_ID = '';
  env.PLAID_SECRET = '';
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

const pullBody = {
  confirm: true as const,
  bureau: 'equifax' as const,
  firstName: 'Ada',
  lastName: 'Cole',
  address: '1 Main',
  city: 'Austin',
  state: 'Texas',
  zip: '78701',
};

describe('POST /verification/flow/isoftpull/pull', () => {
  it('refuses unauthenticated', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verification/flow/isoftpull/pull',
      payload: pullBody,
    });
    expect(res.statusCode).toBe(401);
    expect(pullIsoftPullReport).not.toHaveBeenCalled();
  });

  it('refuses a sales-only worker', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verification/flow/isoftpull/pull',
      headers: bearer(await workerToken('Sales Rep')),
      payload: pullBody,
    });
    expect(res.statusCode).toBe(403);
    expect(pullIsoftPullReport).not.toHaveBeenCalled();
  });

  it('rejects a pull without confirm — no vendor HTTP', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verification/flow/isoftpull/pull',
      headers: bearer(await workerToken('Verification')),
      payload: { ...pullBody, confirm: false },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(pullIsoftPullReport).not.toHaveBeenCalled();
    expect(insertAttempt).not.toHaveBeenCalled();
  });

  it('returns killed when the live flag is off', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verification/flow/isoftpull/pull',
      headers: bearer(await workerToken('Verification')),
      payload: pullBody,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().available).toBe(false);
    expect(res.json().reason).toBe('killed');
    expect(pullIsoftPullReport).not.toHaveBeenCalled();
  });

  it('stays killed even when the live flag and keys are on — product switch wins', async () => {
    env.ISOFTPULL_LIVE_ENABLED = true;
    env.ISOFTPULL_BASE_URL = 'https://isoftpull.test/api/v2';
    env.ISOFTPULL_EQUIFAX_API_KEY = 'k';
    env.ISOFTPULL_EQUIFAX_API_SECRET = 's';
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verification/flow/isoftpull/pull',
      headers: bearer(await workerToken('Verification')),
      payload: pullBody,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ available: false, reason: 'killed' });
    expect(pullIsoftPullReport).not.toHaveBeenCalled();
    expect(insertAttempt).not.toHaveBeenCalled();
  });
});

describe('POST /verification/flow/plaid/link-token', () => {
  it('returns killed without calling Plaid, even when keys are set', async () => {
    env.PLAID_CLIENT_ID = 'cid';
    env.PLAID_SECRET = 'sec';
    env.PLAID_LIVE_ENABLED = true;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verification/flow/plaid/link-token',
      headers: bearer(await workerToken('Verification')),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ available: false, reason: 'killed' });
    expect(createPlaidLinkToken).not.toHaveBeenCalled();
  });
});

describe('POST /verification/flow/highway/parse', () => {
  it('returns killed and does not parse', async () => {
    const boundary = '----octane';
    const html = '<div>RIDGEVALE FREIGHT LLC</div><div>USDOT-3921884</div>';
    const payload =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="carrier.html"\r\n` +
      `Content-Type: text/html\r\n\r\n` +
      `${html}\r\n` +
      `--${boundary}--\r\n`;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verification/flow/highway/parse',
      headers: {
        ...bearer(await workerToken('Verification')),
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ available: false, reason: 'killed' });
    expect(insertAttempt).not.toHaveBeenCalled();
  });
});
