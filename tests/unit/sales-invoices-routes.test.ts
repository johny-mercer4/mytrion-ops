/**
 * /v1/sales/invoices/:invoiceId/:type — the same-origin binary proxy behind the Automations
 * "Request Invoices" action, plus its signed-url sibling.
 *
 * The authorization surface is the point of this file. servercrm keys invoices by id alone with no
 * carrier scope, so the route has to prove BOTH that the caller owns the carrier and that the
 * invoice is part of it — otherwise naming a carrier you do own would unlock anyone's invoice id.
 * Coverage: unauthenticated, wrong department, missing carrierId, unowned carrier, carrier/invoice
 * mismatch, membership lookup failure, happy path, upstream 4xx vs 5xx, empty body, and the audit
 * trail on both success and upstream failure.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
  process.env.SERVER_CRM_URL = 'https://crm.example.com';
  process.env.SERVER_CRM_KEY = 'srv-key';
});

const { assertOwnedMock, serverCrmGetMock } = vi.hoisted(() => ({
  assertOwnedMock: vi.fn(),
  serverCrmGetMock: vi.fn(),
}));

vi.mock('../../src/modules/tools/serverCrmScope.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/tools/serverCrmScope.js')>();
  return { ...mod, assertCarrierOwned: assertOwnedMock };
});
vi.mock('../../src/integrations/serverCrm.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/integrations/serverCrm.js')>();
  return { ...mod, serverCrm: { ...mod.serverCrm, get: serverCrmGetMock } };
});
vi.mock('../../src/modules/audit/auditLogger.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/audit/auditLogger.js')>();
  return { ...mod, audit: vi.fn(async () => undefined), auditFromContext: vi.fn(async () => undefined) };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { auditFromContext } from '../../src/modules/audit/auditLogger.js';
import { RBACError } from '../../src/lib/errors.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';

const INVOICE = '900001';
const CARRIER = '999001';
const URL_PDF = `/v1/sales/invoices/${INVOICE}/pdf?carrierId=${CARRIER}`;

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

function tokenFor(profile: string): Promise<string> {
  return signAccessToken({
    userId: 'zoho:42',
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'worker',
    worker: { zohoUserId: '42', userName: 'Robiya', profile },
  });
}
const salesToken = (): Promise<string> => tokenFor('Sales Rep');

/** The carrier's invoice set — membership is what proves the caller may read THIS invoice. */
function invoiceList(ids: string[], moreRecords = false): { data: Array<Record<string, unknown>>; more_records: boolean } {
  return { data: ids.map((id) => ({ invoiceId: id, invoiceNumber: `INV-${id}` })), more_records: moreRecords };
}

/**
 * The route fetches the bytes with global fetch (not the serverCrm wrapper). One spy for the whole
 * file so "never reached the upstream" is assertable on every denial path.
 */
let upstream: ReturnType<typeof vi.fn>;
function stubUpstream(res: Response): void {
  upstream.mockResolvedValue(res);
}

beforeEach(() => {
  vi.clearAllMocks();
  upstream = vi.fn(async () => new Response('unexpected upstream call', { status: 500 }));
  vi.stubGlobal('fetch', upstream);
  assertOwnedMock.mockResolvedValue(undefined);
  serverCrmGetMock.mockResolvedValue(invoiceList([INVOICE]));
});

describe('GET /v1/sales/invoices/:invoiceId/:type — authorization', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await app.inject({ method: 'GET', url: URL_PDF });
    expect(res.statusCode).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('rejects a worker outside the sales department', async () => {
    const token = await tokenFor('Billing Rep');
    const res = await app.inject({ method: 'GET', url: URL_PDF, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(403);
    expect(serverCrmGetMock).not.toHaveBeenCalled();
  });

  it('rejects a request with no carrierId — the scope is not optional', async () => {
    const token = await salesToken();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/sales/invoices/${INVOICE}/pdf`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
    expect(assertOwnedMock).not.toHaveBeenCalled();
  });

  it('rejects a carrier outside the caller’s client list', async () => {
    assertOwnedMock.mockRejectedValue(new RBACError('Carrier 999001 is not in your client list'));
    const token = await salesToken();
    const res = await app.inject({ method: 'GET', url: URL_PDF, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(403);
    // Denied before any invoice lookup or upstream call.
    expect(serverCrmGetMock).not.toHaveBeenCalled();
  });

  it('rejects an invoice that belongs to a DIFFERENT carrier the caller happens to own', async () => {
    // This is the case a carrierId-only check would wave through.
    serverCrmGetMock.mockResolvedValue(invoiceList(['900777', '900888']));
    const token = await salesToken();
    const res = await app.inject({ method: 'GET', url: URL_PDF, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      error: { message: expect.stringContaining('does not belong') },
    });
    expect(upstream).not.toHaveBeenCalled();
  });

  it('continues through invoice pages before denying membership', async () => {
    serverCrmGetMock
      .mockResolvedValueOnce(invoiceList(['900777'], true))
      .mockResolvedValueOnce(invoiceList([INVOICE]));
    stubUpstream(new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { status: 200 }));
    const token = await salesToken();
    const res = await app.inject({ method: 'GET', url: URL_PDF, headers: { authorization: `Bearer ${token}` } });

    expect(res.statusCode).toBe(200);
    expect(serverCrmGetMock).toHaveBeenNthCalledWith(
      2,
      '/api/salesMytrion/fetchInvoices',
      expect.objectContaining({ carrierId: CARRIER, page: 2, limit: 5000 }),
    );
  });

  it('fails closed when the membership lookup itself is unavailable', async () => {
    serverCrmGetMock.mockRejectedValue(new Error('DWH down'));
    const token = await salesToken();
    const res = await app.inject({ method: 'GET', url: URL_PDF, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(502);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric invoice id before it can reach servercrm', async () => {
    const token = await salesToken();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/sales/invoices/..%2Fadmin/pdf?carrierId=${CARRIER}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /v1/sales/invoices/:invoiceId/:type — delivery', () => {
  it('streams the bytes as an attachment and audits the download', async () => {
    stubUpstream(new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
      status: 200,
      headers: { 'content-type': 'application/pdf' },
    }));
    const token = await salesToken();
    const res = await app.inject({ method: 'GET', url: URL_PDF, headers: { authorization: `Bearer ${token}` } });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toBe('attachment');
    expect(res.rawPayload.length).toBe(4);
    // ?download=1 is what makes CMP mark it an attachment upstream.
    expect(upstream.mock.calls[0]?.[0]).toContain(`/api/salesMytrion/invoices/${INVOICE}/pdf?download=1`);
    expect(auditFromContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'sales.invoice.download', status: 'ok', resourceId: INVOICE }),
    );
  });

  it('passes an upstream 404 through to the caller with its message', async () => {
    stubUpstream(new Response(JSON.stringify({ message: 'Invoice not found.' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    }));
    const token = await salesToken();
    const res = await app.inject({ method: 'GET', url: URL_PDF, headers: { authorization: `Bearer ${token}` } });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { message: 'Invoice not found.' } });
    expect(auditFromContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'sales.invoice.download', status: 'error' }),
    );
  });

  it('maps an upstream 5xx to 502 rather than blaming the caller', async () => {
    stubUpstream(new Response('boom', { status: 503 }));
    const token = await salesToken();
    const res = await app.inject({ method: 'GET', url: URL_PDF, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(502);
  });

  it('maps an upstream credential rejection to 502 so the client does not refresh its own bearer', async () => {
    stubUpstream(new Response(JSON.stringify({ message: 'Bad server key.' }), { status: 401 }));
    const token = await salesToken();
    const res = await app.inject({ method: 'GET', url: URL_PDF, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(502);
  });

  it('reports 502 when the invoice service is unreachable', async () => {
    upstream.mockRejectedValue(new Error('ECONNREFUSED'));
    const token = await salesToken();
    const res = await app.inject({ method: 'GET', url: URL_PDF, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(502);
  });

  it('passes an empty body straight through — the client turns 0 bytes into an error', async () => {
    stubUpstream(new Response(new Uint8Array([]), { status: 200, headers: { 'content-type': 'application/pdf' } }));
    const token = await salesToken();
    const res = await app.inject({ method: 'GET', url: URL_PDF, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.length).toBe(0);
  });
});

describe('GET /v1/sales/invoices/:invoiceId/:type/signed-url', () => {
  const url = `/v1/sales/invoices/${INVOICE}/pdf/signed-url?carrierId=${CARRIER}`;

  it('applies the same ownership gate as the binary route', async () => {
    serverCrmGetMock.mockResolvedValue(invoiceList(['900777']));
    const token = await salesToken();
    const res = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(403);
  });

  it('returns the short-lived url once ownership is proven', async () => {
    serverCrmGetMock
      .mockResolvedValueOnce(invoiceList([INVOICE]))
      .mockResolvedValueOnce({ url: 'https://crm.example.com/signed?token=abc', expiresIn: 120 });
    const token = await salesToken();
    const res = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ url: 'https://crm.example.com/signed?token=abc', expiresIn: 120 });
    expect(auditFromContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'sales.invoice.signed_url', status: 'ok' }),
    );
  });

  it('404s when servercrm has no link for that type', async () => {
    serverCrmGetMock.mockResolvedValueOnce(invoiceList([INVOICE])).mockResolvedValueOnce({});
    const token = await salesToken();
    const res = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(404);
  });
});
