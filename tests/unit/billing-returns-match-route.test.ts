/**
 * POST /billing/returns/:id/match — route-level wiring for the "not mapped" CMP-reversal fix.
 *
 * The decision logic itself (fuzzy-resolve a carrier, then reverse in CMP) is unit-tested in
 * returns-cmp-reversal.test.ts; this file only pins that the ROUTE wires it correctly: calling it
 * for the unmapped branch, stamping the mapping patch on success, enriching the audit trail, and
 * leaving the already-mapped branch + the double-reversal 409 guard unchanged.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const { returnRepo, txRepo, resolveReturnCmpReversalMock, reverseMappingMock, auditFromContextMock } = vi.hoisted(
  () => ({
    returnRepo: { getById: vi.fn(), linkMatch: vi.fn() },
    txRepo: { getById: vi.fn(), applyMapping: vi.fn(), setReturned: vi.fn(), findReturnCandidates: vi.fn() },
    resolveReturnCmpReversalMock: vi.fn(),
    reverseMappingMock: vi.fn(),
    auditFromContextMock: vi.fn(async (_ctx: unknown, _fields: { action: string; [k: string]: unknown }) => undefined),
  }),
);
vi.mock('../../src/repos/paymentReturnRepo.js', () => ({ paymentReturnRepo: returnRepo }));
vi.mock('../../src/repos/paymentTransactionRepo.js', () => ({ paymentTransactionRepo: txRepo }));
vi.mock('../../src/modules/billing/returnsCmpReversal.js', () => ({
  resolveReturnCmpReversal: resolveReturnCmpReversalMock,
}));
vi.mock('../../src/modules/billing/cmpWrites.js', () => ({ reverseMapping: reverseMappingMock }));
vi.mock('../../src/modules/audit/auditLogger.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/audit/auditLogger.js')>();
  return { ...mod, audit: vi.fn(async () => undefined), auditFromContext: auditFromContextMock };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';

async function adminToken(): Promise<string> {
  return signAccessToken({
    userId: 'zoho:1',
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin',
    worker: { zohoUserId: '1', userName: 'Test Billing Admin', profile: 'Administrator' },
  });
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

const baseReturn = { id: 55, matched: false, matchedBy: null, source: 'mx-ach', amount: '250.00' };
const mxTx = { id: 900, source: 'mx', isReturned: false, isInvoiceMapped: false, amount: '250.00' };

beforeEach(() => {
  vi.clearAllMocks();
  returnRepo.getById.mockResolvedValue(baseReturn as never);
  txRepo.getById.mockResolvedValue(mxTx as never);
  returnRepo.linkMatch.mockResolvedValue({ id: 55 } as never);
  txRepo.setReturned.mockResolvedValue(undefined as never);
  txRepo.findReturnCandidates.mockResolvedValue({ rows: [], mode: 'suggest' } as never);
});

function matchReturn(id: number, transactionRecordId: number, token: string) {
  return app.inject({
    method: 'POST',
    url: `/v1/billing/returns/${id}/match`,
    headers: auth(token),
    payload: { transactionRecordId },
  });
}

describe('unmapped MX transaction — the fixed branch', () => {
  it('reverses via a fuzzy-resolved carrier and stamps the mapping patch on the transaction', async () => {
    resolveReturnCmpReversalMock.mockResolvedValue({
      matchNote: 'Reversal(s) applied to CMP',
      isReversed: true,
      mappingPatch: { carrierId: '5801437', mappingType: 'Auto-Mapped (return)' },
      detail: { attempted: true, carrierId: '5801437', carrierVia: 'name', reversedCount: 1 },
    });

    const res = await matchReturn(55, 900, await adminToken());

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'success', matchNote: 'Reversal(s) applied to CMP', isReversed: true });
    expect(resolveReturnCmpReversalMock).toHaveBeenCalledWith(mxTx);
    expect(txRepo.applyMapping).toHaveBeenCalledWith(
      900,
      expect.objectContaining({ carrierId: '5801437', mappingType: 'Auto-Mapped (return)', isInvoiceMapped: true }),
    );
    expect(returnRepo.linkMatch).toHaveBeenCalledWith(
      55,
      expect.objectContaining({ originalTransactionId: 900, matchNote: 'Reversal(s) applied to CMP', isReversed: true }),
    );
    expect(txRepo.setReturned).toHaveBeenCalledWith(900, expect.any(Date));

    // The audit trail carries the resolver's detail, plus a distinct row for a fuzzy-carrier reversal
    // (real money deleted on a guessed carrier — the case most worth being able to find later).
    const actions = auditFromContextMock.mock.calls.map((c) => c[1]?.action);
    expect(actions).toContain('billing.returns.match');
    expect(actions).toContain('billing.returns.match.fuzzy-reversal');
  });

  it('a resolver miss leaves the mapping untouched and does not add the fuzzy-reversal audit row', async () => {
    resolveReturnCmpReversalMock.mockResolvedValue({
      matchNote: 'CMP reverse failed — reconcile manually: no unambiguous payment',
      isReversed: false,
      detail: { attempted: true, carrierId: '5801437', carrierVia: 'name', resolveMessage: 'no unambiguous payment' },
    });

    const res = await matchReturn(55, 900, await adminToken());

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ isReversed: false });
    expect(txRepo.applyMapping).not.toHaveBeenCalled();
    const actions = auditFromContextMock.mock.calls.map((c) => c[1]?.action);
    expect(actions).not.toContain('billing.returns.match.fuzzy-reversal');
  });

  it('no signal at all: falls back to the original default note, matches the old behaviour exactly', async () => {
    resolveReturnCmpReversalMock.mockResolvedValue({
      matchNote: 'not mapped — no CMP payment to reverse',
      isReversed: false,
      detail: { attempted: false },
    });

    const res = await matchReturn(55, 900, await adminToken());

    expect(res.json()).toMatchObject({ matchNote: 'not mapped — no CMP payment to reverse', isReversed: false });
    expect(txRepo.applyMapping).not.toHaveBeenCalled();
  });
});

describe('already-mapped transaction — unchanged (regression pin)', () => {
  it('still goes through reverseMapping directly, never touches the fuzzy resolver', async () => {
    txRepo.getById.mockResolvedValue({ ...mxTx, isInvoiceMapped: true, carrierId: '5801437', mappingType: 'Invoice' } as never);
    reverseMappingMock.mockResolvedValue({ ok: true, kind: 'invoice', reversed: [{ invoiceId: 'I', paymentId: 'P' }] });

    const res = await matchReturn(55, 900, await adminToken());

    expect(res.json()).toMatchObject({ matchNote: 'Reversal(s) applied to CMP', isReversed: true });
    expect(reverseMappingMock).toHaveBeenCalledTimes(1);
    expect(resolveReturnCmpReversalMock).not.toHaveBeenCalled();
    expect(txRepo.applyMapping).not.toHaveBeenCalled(); // precedent: never re-stamps after a reversal
  });

  it('passes allowCmpLookup:true for an MX transaction (the only rail that lookup is safe for)', async () => {
    txRepo.getById.mockResolvedValue({ ...mxTx, isInvoiceMapped: true, carrierId: '5801437', mappingType: 'Invoice' } as never);
    reverseMappingMock.mockResolvedValue({ ok: true, kind: 'invoice', reversed: [{ invoiceId: 'I', paymentId: 'P' }] });

    await matchReturn(55, 900, await adminToken());

    expect(reverseMappingMock).toHaveBeenCalledWith(expect.objectContaining({ allowCmpLookup: true }));
  });

  it('passes allowCmpLookup:false for a non-MX transaction (closes the CMP-guess-delete hole)', async () => {
    // A stripe-dispute return matched to a stripe transaction — the rail-compatibility guard in
    // returnsMatch.ts refuses an mx-ach-return/stripe-transaction pairing outright, so both sides
    // must agree here to reach the CMP-write logic this test actually targets.
    returnRepo.getById.mockResolvedValue({ ...baseReturn, source: 'stripe-dispute' } as never);
    txRepo.getById.mockResolvedValue({
      ...mxTx,
      source: 'stripe',
      isInvoiceMapped: true,
      carrierId: '5801437',
      mappingType: 'Invoice',
    } as never);
    reverseMappingMock.mockResolvedValue({ ok: true, kind: 'invoice', reversed: [{ invoiceId: 'I', paymentId: 'P' }] });

    await matchReturn(55, 900, await adminToken());

    expect(reverseMappingMock).toHaveBeenCalledWith(expect.objectContaining({ allowCmpLookup: false }));
  });

  it('a mismatched amount (partial dispute) skips reverseMapping entirely — no CMP call', async () => {
    returnRepo.getById.mockResolvedValue({ ...baseReturn, amount: '500.00' } as never); // charge was 250.00
    txRepo.getById.mockResolvedValue({ ...mxTx, isInvoiceMapped: true, carrierId: '5801437', mappingType: 'Invoice' } as never);

    const res = await matchReturn(55, 900, await adminToken());

    expect(res.json()).toMatchObject({ isReversed: false });
    expect(res.json().matchNote).toContain('does not match transaction amount');
    expect(reverseMappingMock).not.toHaveBeenCalled();
    // Still links the return — only the CMP step is skipped.
    expect(returnRepo.linkMatch).toHaveBeenCalledWith(55, expect.objectContaining({ isReversed: false }));
  });
});

describe('guards unchanged', () => {
  it('409s a return that is already matched — never a second reversal', async () => {
    returnRepo.getById.mockResolvedValue({ id: 55, matched: true, matchedBy: 'Someone Else' } as never);

    const res = await matchReturn(55, 900, await adminToken());

    expect(res.statusCode).toBe(409);
    expect(resolveReturnCmpReversalMock).not.toHaveBeenCalled();
    expect(reverseMappingMock).not.toHaveBeenCalled();
  });

  it("404s when the transaction doesn't exist", async () => {
    txRepo.getById.mockResolvedValue(undefined as never);

    const res = await matchReturn(55, 900, await adminToken());

    expect(res.statusCode).toBe(404);
  });
});

describe('GET /billing/returns/candidates — rail derived server-side from returnId', () => {
  async function getCandidates(qs: string, token: string) {
    return app.inject({ method: 'GET', url: `/v1/billing/returns/candidates?${qs}`, headers: auth(token) });
  }

  it('no returnId: defaults to MX (backwards-compatible)', async () => {
    const res = await getCandidates('query=abc', await adminToken());

    expect(res.statusCode).toBe(200);
    expect(txRepo.findReturnCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ sources: ['mx'], windowDays: 7 }),
    );
  });

  it('returnId pointing at a stripe-dispute return: scopes candidates to source=stripe with a wider window', async () => {
    returnRepo.getById.mockResolvedValue({ id: 700, source: 'stripe-dispute' } as never);

    const res = await getCandidates('returnId=700&query=abc', await adminToken());

    expect(res.statusCode).toBe(200);
    expect(txRepo.findReturnCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ sources: ['stripe'], windowDays: 180 }),
    );
    // The client can never smuggle a rail in directly — only returnId is accepted, and the server
    // looks the return up itself rather than trusting a client-supplied source.
    const calledWith = txRepo.findReturnCandidates.mock.calls[0]?.[0];
    expect(calledWith).not.toHaveProperty('returnId');
  });

  it('returnId pointing at an mx-ach return: MX rail, standard 7-day window', async () => {
    returnRepo.getById.mockResolvedValue({ id: 701, source: 'mx-ach' } as never);

    await getCandidates('returnId=701', await adminToken());

    expect(txRepo.findReturnCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ sources: ['mx'], windowDays: 7 }),
    );
  });
});
