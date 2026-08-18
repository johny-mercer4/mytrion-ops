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

const { resolveActAsMock, findBrokerMock } = vi.hoisted(() => ({
  resolveActAsMock: vi.fn(),
  findBrokerMock: vi.fn(),
}));

/** The warehouse is read through one function; stubbing it keeps the route under test. */
vi.mock('../../src/integrations/dwhBrokerSnapshot.js', async (importOriginal) => {
  const mod =
    await importOriginal<typeof import('../../src/integrations/dwhBrokerSnapshot.js')>();
  return { ...mod, findBrokerSnapshot: findBrokerMock };
});

/** The x-act-as-* headers are never trusted; the target's identity comes from this directory. */
vi.mock('../../src/modules/auth/actAsDirectory.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/auth/actAsDirectory.js')>();
  return { ...mod, resolveActAsTarget: resolveActAsMock };
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
      prefillInputs: vi.fn(),
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
      getBytes: vi.fn(),
      remove: vi.fn(),
    },
  };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { AppError } from '../../src/lib/errors.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import { applicationService } from '../../src/modules/verificationFlow/applicationService.js';
import { documentService } from '../../src/modules/verificationFlow/documentService.js';

const createMock = vi.mocked(applicationService.create);
const getMock = vi.mocked(applicationService.get);
const patchMock = vi.mocked(applicationService.patch);
const submitMock = vi.mocked(applicationService.submit);
const listMock = vi.mocked(applicationService.listForAgent);
/** The prefill route reads the case LEAN — it must not run the gate refresh to read a phone number. */
const prefillInputsMock = vi.mocked(applicationService.prefillInputs);
/** The inline-preview proxy — the only path that can SHOW a stored document rather than download it. */
const getBytesMock = vi.mocked(documentService.getBytes);

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
  resolveActAsMock.mockImplementation(async (id: string) =>
    id === '777'
      ? { zohoUserId: '777', name: 'Robert Toms', email: null, profile: 'Sales Rep', role: 'Agent' }
      : id === '888'
        ? { zohoUserId: '888', name: 'Dana Vale', email: null, profile: 'Recruiter', role: 'Agent' }
        : null,
  );
  createMock.mockResolvedValue(detail);
  getMock.mockResolvedValue(detail);
  patchMock.mockResolvedValue(detail);
  submitMock.mockResolvedValue(detail);
  listMock.mockResolvedValue({ items: [], total: 0 });
  prefillInputsMock.mockResolvedValue({ case: detail.case, principalCount: 0 });
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

/** A true admin session carries NO worker block — the worker profile is what resolves the role. */
async function adminToken(): Promise<string> {
  return signAccessToken({
    userId: 'admin-1',
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin',
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

/**
 * The list is OWNER-SCOPED, so it is the one route here where identity has to survive View-as.
 *
 * Without it the list ran as the admin doing the viewing — who owns no applications — so checking
 * an agent's Verification tab showed "No applications yet" while their cases sat in the desk queue
 * with their name on them. There is no other way for anyone to see what an agent sees.
 */
/**
 * Prefill is a SUGGESTION endpoint over half a million carrier records, so the shape that matters
 * is where the lookup keys come from: the case, never the request.
 */
describe('prefill from the warehouse', () => {
  const MATCH = {
    matchedOn: 'phone' as const,
    dotNumber: '3757749',
    ownerFullName: 'MARIA OKONKWO',
    physicalAddress: '1200 W LOOP S, HOUSTON, TX',
    phoneNumber: '6145550110',
    email: 'ops@bluehaul.test',
    powerUnits: 4,
    truckSize: null,
    operatingStatus: 'ACTIVE',
    authorityAddedOn: '2021-03-04',
  };

  it('looks up on the CASE’s own keys and ignores anything the caller passes', async () => {
    findBrokerMock.mockResolvedValue(MATCH);
    const res = await app.inject({
      method: 'GET',
      // A caller trying to use this as a free lookup over the warehouse.
      url: '/v1/verification/applications/vc_1/prefill?phone=2125550000&dot=9999999&email=someone@else.test',
      headers: bearer(await workerToken('Sales Rep')),
    });
    expect(res.statusCode).toBe(200);
    const keys = findBrokerMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(keys.dot ?? null).toBe(detail.case.dot ?? null);
    expect(keys.email ?? null).toBe(detail.case.email ?? null);
    expect(JSON.stringify(keys)).not.toContain('2125550000');
    expect(JSON.stringify(keys)).not.toContain('9999999');
    expect(JSON.stringify(keys)).not.toContain('someone@else.test');
  });

  it('returns the match and the fields it could fill', async () => {
    findBrokerMock.mockResolvedValue(MATCH);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/applications/vc_1/prefill',
      headers: bearer(await workerToken('Sales Rep')),
    });
    const body = res.json() as { match: unknown; suggestions: Array<{ field: string }> };
    expect(body.match).toMatchObject({ matchedOn: 'phone' });
    expect(body.suggestions.length).toBeGreaterThan(0);
  });

  it('is an ordinary empty answer when nothing matches — three in four cases do not', async () => {
    findBrokerMock.mockResolvedValue(null);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/applications/vc_1/prefill',
      headers: bearer(await workerToken('Sales Rep')),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ match: null, suggestions: [] });
  });

  /**
   * A read must not run a WRITE. `applicationService.get` re-derives the gate and persists the
   * verdict, so answering the prefill through it meant every open of an application issued the whole
   * six-statement refresh — and, on a case whose verdict had moved, an UPDATE — before the warehouse
   * scan even started, for a panel the form does not wait for.
   */
  it('reads the case lean rather than through the gate refresh', async () => {
    findBrokerMock.mockResolvedValue(MATCH);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/applications/vc_1/prefill',
      headers: bearer(await workerToken('Sales Rep')),
    });
    expect(res.statusCode).toBe(200);
    expect(prefillInputsMock).toHaveBeenCalledTimes(1);
    expect(getMock).not.toHaveBeenCalled();
  });

  it('reports a warehouse failure as 502, not a 500', async () => {
    findBrokerMock.mockRejectedValue(new Error('dbt rebuild lock'));
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/applications/vc_1/prefill',
      headers: bearer(await workerToken('Sales Rep')),
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: { code: 'DWH_ERROR' } });
  });

  it('REFUSES a verification-only worker — this is a Sales door', async () => {
    findBrokerMock.mockResolvedValue(MATCH);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/applications/vc_1/prefill',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBe(403);
    expect(findBrokerMock).not.toHaveBeenCalled();
  });
});

describe('View-as (owner-scoped list)', () => {
  it('scopes the list to the target agent, not the admin doing the viewing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/applications',
      headers: { ...bearer(await adminToken()), 'x-act-as-zoho-user-id': '777' },
    });
    expect(res.statusCode).toBe(200);
    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'zoho:777', impersonatorUserId: 'admin-1' }),
      expect.any(Object),
    );
  });

  it('leaves a plain session alone — no header, no identity change', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/applications',
      headers: bearer(await workerToken('Sales Rep')),
    });
    expect(res.statusCode).toBe(200);
    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'zoho:42' }),
      expect.any(Object),
    );
    expect(listMock.mock.calls[0]?.[0]).not.toHaveProperty('impersonatorUserId');
  });

  it('applies the impersonation BEFORE the Sales gate, so the target needs Sales access', async () => {
    // The ordering IS the security property: a target with no Sales access must not be readable
    // through this door just because an admin asked. `888` is a Recruiter.
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/applications',
      headers: { ...bearer(await adminToken()), 'x-act-as-zoho-user-id': '888' },
    });
    expect(res.statusCode).toBe(403);
    expect(listMock).not.toHaveBeenCalled();
  });

  it('refuses an unknown target rather than falling back to the admin', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/applications',
      headers: { ...bearer(await adminToken()), 'x-act-as-zoho-user-id': 'nobody' },
    });
    expect(res.statusCode).toBe(403);
    expect(listMock).not.toHaveBeenCalled();
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

  /**
   * Applications are created by the Zoho Deal poller, not by an agent. The manual route survives as
   * an admin backfill hatch — a Sales rep hitting it is the thing that must not work, because a
   * second creation path is how the two desks end up with divergent records.
   */
  it('refuses a Sales rep the manual create — the poller owns creation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verification/applications',
      headers: bearer(await workerToken('Sales Rep')),
      payload: { applicantType: 'carrier' },
    });
    expect(res.statusCode).toBe(403);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('still allows an admin to backfill one, red', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verification/applications',
      headers: bearer(await adminToken()),
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

/**
 * The INLINE PREVIEW proxy.
 *
 * `…/download` returns a Dropbox `get_temporary_link`, and Dropbox serves that link with
 * `Content-Disposition: attachment` and no CORS headers — so clicking a bank statement opened a blank
 * tab and downloaded the file. An underwriter could not look at the document they were underwriting.
 *
 * These assert the three headers that make the browser RENDER the bytes instead of saving them, and
 * that the route is gated like every other Sales door.
 */
describe('document bytes — inline preview', () => {
  const PDF = Buffer.from('%PDF-1.7 fake');

  beforeEach(() => {
    getBytesMock.mockResolvedValue({ fileName: 'feb-statement.pdf', mime: 'application/pdf', buffer: PDF });
  });

  it('serves the bytes with the row’s real MIME and Content-Disposition: inline', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/applications/vc_1/documents/doc_1/bytes',
      headers: bearer(await workerToken('Sales Rep')),
    });
    expect(res.statusCode).toBe(200);
    // The real MIME matters: `X-Content-Type-Options: nosniff` is set globally, so a wrong or absent
    // content type renders as a blank frame rather than as a PDF.
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toBe('inline; filename="feb-statement.pdf"');
    // Bank statements and identity documents must not sit in a shared cache.
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.rawPayload.equals(PDF)).toBe(true);
    expect(getBytesMock).toHaveBeenCalledWith(expect.anything(), 'vc_1', 'doc_1');
  });

  it('strips CR/LF and quotes out of the filename header', async () => {
    getBytesMock.mockResolvedValue({
      fileName: 'jan"\r\nstatement.pdf',
      mime: 'application/pdf',
      buffer: PDF,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/applications/vc_1/documents/doc_1/bytes',
      headers: bearer(await workerToken('Sales Rep')),
    });
    // A CR, an LF or a bare quote inside the value would split or terminate the header. The opening
    // quote around the whole filename is of course legitimate — only the value is sanitised.
    expect(res.headers['content-disposition']).toBe('inline; filename="jan___statement.pdf"');
  });

  it('REFUSES a verification-only worker on the Sales door', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/applications/vc_1/documents/doc_1/bytes',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBe(403);
    expect(getBytesMock).not.toHaveBeenCalled();
  });

  it('refuses unauthenticated — the bytes are never public', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/applications/vc_1/documents/doc_1/bytes',
    });
    expect(res.statusCode).toBe(401);
    expect(getBytesMock).not.toHaveBeenCalled();
  });

  /** A `requested` row carries no bytes; the service 409s and that must reach the client as a 409. */
  it('passes the service’s 409 through for a document that was asked for but never uploaded', async () => {
    getBytesMock.mockRejectedValue(
      new AppError('That document has been requested but not uploaded yet.', {
        statusCode: 409,
        code: 'VERIFICATION_DOC_NOT_UPLOADED',
        expose: true,
      }),
    );
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/applications/vc_1/documents/doc_1/bytes',
      headers: bearer(await workerToken('Sales Rep')),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'VERIFICATION_DOC_NOT_UPLOADED' } });
  });

  it('serves the desk door too, so both Mytrions resolve one document the same way', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/cases/vc_1/documents/doc_1/bytes',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('inline');
  });
});
