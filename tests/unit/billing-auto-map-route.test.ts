/**
 * /v1/billing/ingest/payment (existing) + /v1/billing/transactions/auto-map (new) + /v1/billing/
 * ingest/dispute (new) + /v1/billing/ingest/mx-return-match (new) — the shared-secret webhooks in
 * paymentsIngest.routes.ts. auto-map lets servercrm's ingest-time auto-map job stamp a carrier it
 * resolved from CMP directly; ingest/dispute is the Stripe-dispute twin of ingest/payment;
 * ingest/mx-return-match lets servercrm's return sync attempt a match+reversal the moment a new MX
 * ACH return/chargeback lands, instead of waiting on the legacy Zoho workflow.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const {
  applyAutoMapMock,
  applyMappingMock,
  upsertManyMock,
  markIngestMappedMock,
  setReturnedMock,
  auditMock,
  upsertDisputeUnlessMatchedMock,
  claimForMatchMock,
  recordCmpReversalMock,
  getReturnByIdMock,
  resolveStripeDisputeMatchMock,
  resolveMxReturnMatchMock,
} = vi.hoisted(() => ({
  applyAutoMapMock: vi.fn(),
  applyMappingMock: vi.fn(async () => undefined),
  upsertManyMock: vi.fn(async () => 1),
  markIngestMappedMock: vi.fn(async () => undefined),
  setReturnedMock: vi.fn(async () => undefined),
  auditMock: vi.fn(async (_input: { action: string; [k: string]: unknown }) => undefined),
  upsertDisputeUnlessMatchedMock: vi.fn(),
  claimForMatchMock: vi.fn(),
  recordCmpReversalMock: vi.fn(async () => undefined),
  getReturnByIdMock: vi.fn(),
  resolveStripeDisputeMatchMock: vi.fn(),
  resolveMxReturnMatchMock: vi.fn(),
}));
vi.mock('../../src/repos/paymentTransactionRepo.js', () => ({
  paymentTransactionRepo: {
    applyAutoMap: applyAutoMapMock,
    applyMapping: applyMappingMock,
    upsertMany: upsertManyMock,
    markIngestMapped: markIngestMappedMock,
    setReturned: setReturnedMock,
    money: (n: number) => n.toFixed(2),
  },
}));
vi.mock('../../src/repos/paymentReturnRepo.js', () => ({
  paymentReturnRepo: {
    upsertDisputeUnlessMatched: upsertDisputeUnlessMatchedMock,
    claimForMatch: claimForMatchMock,
    recordCmpReversal: recordCmpReversalMock,
    getById: getReturnByIdMock,
  },
}));
vi.mock('../../src/modules/billing/stripeDisputeMatch.js', () => ({
  resolveStripeDisputeMatch: resolveStripeDisputeMatchMock,
}));
vi.mock('../../src/modules/billing/mxReturnMatch.js', () => ({
  resolveMxReturnMatch: resolveMxReturnMatchMock,
}));
vi.mock('../../src/modules/audit/auditLogger.js', () => ({ audit: auditMock }));

import { buildApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';

const SECRET = env.BILLING_INGEST_SECRET;

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
});

// `null` means "send no x-ingest-secret header at all" — distinct from omitting the arg (which
// defaults to the real SECRET). A plain `undefined` default param would NOT distinguish these,
// since an explicitly-passed `undefined` also triggers the default.
function post(url: string, body: Record<string, unknown>, secret: string | null = SECRET) {
  return app.inject({
    method: 'POST',
    url,
    headers: secret !== null ? { 'x-ingest-secret': secret } : {},
    payload: body,
  });
}

describe('POST /v1/billing/transactions/auto-map', () => {
  it('401s with a missing or wrong secret — never touches the repo', async () => {
    const res = await post('/v1/billing/transactions/auto-map', { transactionId: 1, carrierId: '5801437' }, 'wrong-secret');
    expect(res.statusCode).toBe(401);
    expect(applyAutoMapMock).not.toHaveBeenCalled();

    const res2 = await post('/v1/billing/transactions/auto-map', { transactionId: 1, carrierId: '5801437' }, null);
    expect(res2.statusCode).toBe(401);
  });

  it('400s on a missing carrierId', async () => {
    const res = await post('/v1/billing/transactions/auto-map', { transactionId: 1 });
    expect(res.statusCode).toBe(400);
    expect(applyAutoMapMock).not.toHaveBeenCalled();
  });

  it('applies the mapping and audits as the synthetic system actor', async () => {
    applyAutoMapMock.mockResolvedValue({ id: 900, carrierId: '5823382' });

    const res = await post('/v1/billing/transactions/auto-map', {
      transactionId: 900,
      carrierId: '5823382',
      via: 'name',
      companyName: 'ROAD WARRIORS TRANS INC',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'success', transactionId: 900, applied: true });
    expect(applyAutoMapMock).toHaveBeenCalledWith(900, {
      carrierId: '5823382',
      mappingType: 'Auto-Mapped (CMP)',
      mappedBy: 'CMP auto-map (ingest)',
    });
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'billing.transactions.auto-map',
        userName: 'cmp-auto-map',
        resourceId: '900',
        detail: { carrierId: '5823382', via: 'name', companyName: 'ROAD WARRIORS TRANS INC' },
      }),
    );
  });

  it('a raced row (already mapped by something else) reports applied:false and never audits', async () => {
    applyAutoMapMock.mockResolvedValue(undefined);

    const res = await post('/v1/billing/transactions/auto-map', { transactionId: 900, carrierId: '5823382' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'success', transactionId: 900, applied: false });
    expect(auditMock).not.toHaveBeenCalled();
  });
});

describe('POST /v1/billing/ingest/payment — unchanged (regression pin)', () => {
  it('still requires the shared secret', async () => {
    const res = await post('/v1/billing/ingest/payment', { source: 'zelle', sourceRecordId: 'Z-1' }, 'wrong-secret');
    expect(res.statusCode).toBe(401);
    expect(upsertManyMock).not.toHaveBeenCalled();
  });

  it('still ingests a normal payment', async () => {
    const res = await post('/v1/billing/ingest/payment', { source: 'zelle', sourceRecordId: 'Z-1', amount: 500 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'success', mapped: false });
    expect(upsertManyMock).toHaveBeenCalledTimes(1);
    expect(markIngestMappedMock).not.toHaveBeenCalled();
  });
});

describe('POST /v1/billing/ingest/dispute', () => {
  const unmatchedReturn = { id: 700, matched: false };

  it('401s with a missing or wrong secret — never touches the repo', async () => {
    const res = await post('/v1/billing/ingest/dispute', { disputeId: 'du_1', amount: 1000 }, 'wrong-secret');
    expect(res.statusCode).toBe(401);
    expect(upsertDisputeUnlessMatchedMock).not.toHaveBeenCalled();
  });

  it('400s on a missing disputeId', async () => {
    const res = await post('/v1/billing/ingest/dispute', { amount: 1000 });
    expect(res.statusCode).toBe(400);
    expect(upsertDisputeUnlessMatchedMock).not.toHaveBeenCalled();
  });

  it('a non-creation lifecycle stage (e.g. "won") no-ops — 200, never touches the repo', async () => {
    const res = await post('/v1/billing/ingest/dispute', { disputeId: 'du_1', amount: 1000, stage: 'won' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'success', ignored: true });
    expect(upsertDisputeUnlessMatchedMock).not.toHaveBeenCalled();
  });

  it('an already-matched return is a benign 200, not a 409 — Zapier must not retry it forever', async () => {
    upsertDisputeUnlessMatchedMock.mockResolvedValue({ id: 700, matched: true });

    const res = await post('/v1/billing/ingest/dispute', { disputeId: 'du_1', amount: 1000 });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'success', disputeId: 'du_1', returnId: 700, matched: 'already' });
    expect(resolveStripeDisputeMatchMock).not.toHaveBeenCalled();
    expect(claimForMatchMock).not.toHaveBeenCalled();
  });

  it('converts the Stripe cents amount to dollars before storing/matching (1000 -> 10.00)', async () => {
    upsertDisputeUnlessMatchedMock.mockResolvedValue(unmatchedReturn);
    resolveStripeDisputeMatchMock.mockResolvedValue({ outcome: 'unlinked', isReversed: false, detail: {} });

    await post('/v1/billing/ingest/dispute', { disputeId: 'du_1', amount: 1000 });

    expect(upsertDisputeUnlessMatchedMock).toHaveBeenCalledWith(expect.objectContaining({ amount: '10.00' }));
    expect(resolveStripeDisputeMatchMock).toHaveBeenCalledWith(expect.objectContaining({ amount: 10 }));
  });

  it('no paymentIntentId parsed from the email: recorded unlinked, no claim, no CMP call', async () => {
    upsertDisputeUnlessMatchedMock.mockResolvedValue(unmatchedReturn);
    resolveStripeDisputeMatchMock.mockResolvedValue({ outcome: 'unlinked', isReversed: false, detail: {} });

    const res = await post('/v1/billing/ingest/dispute', { disputeId: 'du_1', amount: 1000 });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'success', returnId: 700, outcome: 'unlinked', isReversed: false });
    expect(claimForMatchMock).not.toHaveBeenCalled();
    expect(setReturnedMock).not.toHaveBeenCalled();
  });

  it('linked but flagged (e.g. a pre-mapped Stripe charge with no cmp_ref): claims, records the note, no reversal audit', async () => {
    upsertDisputeUnlessMatchedMock.mockResolvedValue(unmatchedReturn);
    resolveStripeDisputeMatchMock.mockResolvedValue({
      outcome: 'flagged',
      originalTransactionId: 900,
      matchNote: 'Stripe dispute on a charge with no CMP reference on file — reconcile manually in the CMP portal',
      isReversed: false,
      detail: { transactionId: 900 },
    });
    claimForMatchMock.mockResolvedValue({ id: 700 });

    const res = await post('/v1/billing/ingest/dispute', { disputeId: 'du_1', paymentIntentId: 'pi_abc', amount: 1000 });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'success', returnId: 700, outcome: 'flagged', isReversed: false });
    expect(claimForMatchMock).toHaveBeenCalledWith(700, { originalTransactionId: 900, matchedBy: 'zapier-ingest' });
    expect(recordCmpReversalMock).toHaveBeenCalledWith(700, expect.objectContaining({ isReversed: false }));
    expect(setReturnedMock).toHaveBeenCalledWith(900, expect.any(Date));
    const actions = auditMock.mock.calls.map((c) => c[0]?.action);
    expect(actions).toContain('billing.ingest.dispute');
    expect(actions).not.toContain('billing.returns.stripe-auto-reversal');
  });

  it('a real stored ref: claims, reverses, audits the auto-reversal distinctly', async () => {
    upsertDisputeUnlessMatchedMock.mockResolvedValue(unmatchedReturn);
    resolveStripeDisputeMatchMock.mockResolvedValue({
      outcome: 'reversed',
      originalTransactionId: 900,
      matchNote: 'Reversal(s) applied to CMP',
      isReversed: true,
      detail: { transactionId: 900, reversedCount: 1 },
    });
    claimForMatchMock.mockResolvedValue({ id: 700 });

    const res = await post('/v1/billing/ingest/dispute', { disputeId: 'du_1', paymentIntentId: 'pi_abc', amount: 1000 });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'success', returnId: 700, outcome: 'reversed', isReversed: true });
    const actions = auditMock.mock.calls.map((c) => c[0]?.action);
    expect(actions).toContain('billing.returns.stripe-auto-reversal');
  });

  it('losing the claim race (matched flipped between upsert and claim) skips the reversal note write', async () => {
    upsertDisputeUnlessMatchedMock.mockResolvedValue(unmatchedReturn);
    resolveStripeDisputeMatchMock.mockResolvedValue({
      outcome: 'reversed',
      originalTransactionId: 900,
      matchNote: 'Reversal(s) applied to CMP',
      isReversed: true,
      detail: {},
    });
    claimForMatchMock.mockResolvedValue(undefined); // lost the race

    const res = await post('/v1/billing/ingest/dispute', { disputeId: 'du_1', paymentIntentId: 'pi_abc', amount: 1000 });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ isReversed: false });
    expect(recordCmpReversalMock).not.toHaveBeenCalled();
    expect(setReturnedMock).not.toHaveBeenCalled();
  });
});

describe('POST /v1/billing/ingest/mx-return-match', () => {
  it('401s with a missing or wrong secret — never touches the repo', async () => {
    const res = await post('/v1/billing/ingest/mx-return-match', { returnId: 7344 }, 'wrong-secret');
    expect(res.statusCode).toBe(401);
    expect(getReturnByIdMock).not.toHaveBeenCalled();
  });

  it('400s on a missing returnId', async () => {
    const res = await post('/v1/billing/ingest/mx-return-match', {});
    expect(res.statusCode).toBe(400);
  });

  it("404s when the return doesn't exist (servercrm just inserted it — should never happen)", async () => {
    getReturnByIdMock.mockResolvedValue(undefined);
    const res = await post('/v1/billing/ingest/mx-return-match', { returnId: 9999 });
    expect(res.statusCode).toBe(404);
  });

  it('an already-matched return is a benign 200 — Zoho or a human got there first', async () => {
    getReturnByIdMock.mockResolvedValue({ id: 7344, matched: true });

    const res = await post('/v1/billing/ingest/mx-return-match', { returnId: 7344 });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'success', returnId: 7344, matched: 'already' });
    expect(resolveMxReturnMatchMock).not.toHaveBeenCalled();
    expect(claimForMatchMock).not.toHaveBeenCalled();
  });

  it('unlinked (no candidate found): recorded as-is, no claim, no CMP call', async () => {
    getReturnByIdMock.mockResolvedValue({ id: 7345, matched: false, referenceNumber: '06DGHOST', amount: '1000.00' });
    resolveMxReturnMatchMock.mockResolvedValue({ outcome: 'unlinked', isReversed: false, detail: {} });

    const res = await post('/v1/billing/ingest/mx-return-match', { returnId: 7345 });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ outcome: 'unlinked', isReversed: false });
    expect(claimForMatchMock).not.toHaveBeenCalled();
    expect(setReturnedMock).not.toHaveBeenCalled();
  });

  it('a real reversal: claims, reverses, applies any mappingPatch, audits the auto-reversal distinctly', async () => {
    getReturnByIdMock.mockResolvedValue({ id: 7347, matched: false, referenceNumber: '06DGA00ST12K', amount: '1813.95' });
    resolveMxReturnMatchMock.mockResolvedValue({
      outcome: 'reversed',
      originalTransactionId: 345258,
      matchNote: 'Reversal(s) applied to CMP',
      isReversed: true,
      mappingPatch: { carrierId: '5820111', mappingType: 'Auto-Mapped (return)' },
      detail: { transactionId: 345258, reversedCount: 1 },
    });
    claimForMatchMock.mockResolvedValue({ id: 7347 });

    const res = await post('/v1/billing/ingest/mx-return-match', { returnId: 7347 });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ returnId: 7347, outcome: 'reversed', isReversed: true });
    expect(claimForMatchMock).toHaveBeenCalledWith(7347, {
      originalTransactionId: 345258,
      matchedBy: 'mytrion-ops (ingest-time auto-match)',
    });
    expect(applyMappingMock).toHaveBeenCalledWith(
      345258,
      expect.objectContaining({ carrierId: '5820111', mappingType: 'Auto-Mapped (return)', isInvoiceMapped: true }),
    );
    expect(setReturnedMock).toHaveBeenCalledWith(345258, expect.any(Date));
    const actions = auditMock.mock.calls.map((c) => c[0]?.action);
    expect(actions).toContain('billing.ingest.mx-return-match');
    expect(actions).toContain('billing.returns.mx-auto-reversal');
  });

  it('flagged (e.g. amount mismatch or resolver ambiguity): claims and records the note, no reversal audit', async () => {
    getReturnByIdMock.mockResolvedValue({ id: 7348, matched: false, referenceNumber: '06DGB00X', amount: '500.00' });
    resolveMxReturnMatchMock.mockResolvedValue({
      outcome: 'flagged',
      originalTransactionId: 901,
      matchNote: 'return amount 500 does not match transaction amount 2000 (possible partial return) — reconcile manually',
      isReversed: false,
      detail: { transactionId: 901 },
    });
    claimForMatchMock.mockResolvedValue({ id: 7348 });

    const res = await post('/v1/billing/ingest/mx-return-match', { returnId: 7348 });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ outcome: 'flagged', isReversed: false });
    expect(recordCmpReversalMock).toHaveBeenCalledWith(7348, expect.objectContaining({ isReversed: false }));
    expect(setReturnedMock).toHaveBeenCalledWith(901, expect.any(Date));
    const actions = auditMock.mock.calls.map((c) => c[0]?.action);
    expect(actions).not.toContain('billing.returns.mx-auto-reversal');
  });

  it('losing the claim race skips the reversal note write entirely', async () => {
    getReturnByIdMock.mockResolvedValue({ id: 7349, matched: false, referenceNumber: '06DGC00Y', amount: '1000.00' });
    resolveMxReturnMatchMock.mockResolvedValue({
      outcome: 'reversed',
      originalTransactionId: 902,
      matchNote: 'Reversal(s) applied to CMP',
      isReversed: true,
      detail: {},
    });
    claimForMatchMock.mockResolvedValue(undefined); // lost the race

    const res = await post('/v1/billing/ingest/mx-return-match', { returnId: 7349 });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ isReversed: false });
    expect(recordCmpReversalMock).not.toHaveBeenCalled();
    expect(setReturnedMock).not.toHaveBeenCalled();
  });
});
