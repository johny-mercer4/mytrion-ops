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
    txRepo: { getById: vi.fn(), applyMapping: vi.fn(), setReturned: vi.fn() },
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

const baseReturn = { id: 55, matched: false, matchedBy: null };
const mxTx = { id: 900, source: 'mx', isReturned: false, isInvoiceMapped: false };

beforeEach(() => {
  vi.clearAllMocks();
  returnRepo.getById.mockResolvedValue(baseReturn as never);
  txRepo.getById.mockResolvedValue(mxTx as never);
  returnRepo.linkMatch.mockResolvedValue({ id: 55 } as never);
  txRepo.setReturned.mockResolvedValue(undefined as never);
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
