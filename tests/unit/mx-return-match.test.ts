/**
 * resolveMxReturnMatch — the MX twin of stripe-dispute-match.test.ts. Matches by an EXACT reference
 * key (trace number / MX payment id, not fuzzy search), then reuses the same two branches the
 * manual match route runs: a real stored cmp_ref reverses directly; otherwise it delegates to
 * resolveReturnCmpReversal (carrier-known lookup, or CMP-by-name discovery, or nothing to go on).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reverseMappingMock, findByReturnReferenceMock, resolveReturnCmpReversalMock } = vi.hoisted(() => ({
  reverseMappingMock: vi.fn(),
  findByReturnReferenceMock: vi.fn(),
  resolveReturnCmpReversalMock: vi.fn(),
}));
vi.mock('../../src/modules/billing/cmpWrites.js', () => ({ reverseMapping: reverseMappingMock }));
vi.mock('../../src/modules/billing/returnsCmpReversal.js', () => ({
  resolveReturnCmpReversal: resolveReturnCmpReversalMock,
}));
vi.mock('../../src/repos/paymentTransactionRepo.js', () => ({
  paymentTransactionRepo: { findByReturnReference: findByReturnReferenceMock },
}));

import type { PaymentTransaction } from '../../src/db/schema/index.js';
import { resolveMxReturnMatch } from '../../src/modules/billing/mxReturnMatch.js';

function makeTx(overrides: Partial<PaymentTransaction> = {}): PaymentTransaction {
  return {
    id: 900,
    source: 'mx',
    sourceModule: 'Mx_Merchant_Transactions',
    sourceRecordId: '4000000125656914',
    carrierId: '5834597',
    amount: '3948.68',
    currency: 'USD',
    occurredAt: new Date('2026-08-03T21:25:35Z'),
    name: 'ROGERS ENERGY TRANSPORT',
    status: null,
    txnType: null,
    externalTxnId: '06DG800TUAUA',
    senderName: 'ROGERS ENERGY TRANSPORT',
    memo: null,
    description: null,
    email: null,
    cardBrand: null,
    cardLast4: null,
    customerRef: null,
    receiptUrl: null,
    isInvoiceMapped: true,
    mappingType: 'Auto-Mapped (CMP)',
    mappedBy: 'CMP auto-map (ingest)',
    mappedAt: new Date(),
    cmpRef: null,
    splitAllocations: null,
    proposedCarrierIds: null,
    isReturned: false,
    returnedAt: null,
    raw: null,
    syncedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as PaymentTransaction;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveMxReturnMatch — no signal to link on', () => {
  it('no reference at all: unlinked, never queries the DB', async () => {
    const res = await resolveMxReturnMatch({ amount: 100 });
    expect(res).toEqual({ outcome: 'unlinked', isReversed: false, detail: {} });
    expect(findByReturnReferenceMock).not.toHaveBeenCalled();
  });

  it('a blank reference is treated the same as absent', async () => {
    const res = await resolveMxReturnMatch({ referenceNumber: '   ', amount: 100 });
    expect(res.outcome).toBe('unlinked');
    expect(findByReturnReferenceMock).not.toHaveBeenCalled();
  });

  it('reference given but no matching transaction: unlinked', async () => {
    findByReturnReferenceMock.mockResolvedValue(undefined);
    const res = await resolveMxReturnMatch({ referenceNumber: '06DGHOST', amount: 100 });
    expect(res.outcome).toBe('unlinked');
    expect(reverseMappingMock).not.toHaveBeenCalled();
    expect(resolveReturnCmpReversalMock).not.toHaveBeenCalled();
  });
});

describe('resolveMxReturnMatch — guards before any CMP call', () => {
  it('transaction already flagged returned: flagged, no CMP call', async () => {
    findByReturnReferenceMock.mockResolvedValue(makeTx({ isReturned: true }));
    const res = await resolveMxReturnMatch({ referenceNumber: '06DG800TUAUA', amount: 3948.68 });
    expect(res.outcome).toBe('flagged');
    expect(res.originalTransactionId).toBe(900);
    expect(res.matchNote).toContain('already flagged returned');
    expect(reverseMappingMock).not.toHaveBeenCalled();
    expect(resolveReturnCmpReversalMock).not.toHaveBeenCalled();
  });

  it('partial-amount mismatch: flagged, no CMP call', async () => {
    findByReturnReferenceMock.mockResolvedValue(makeTx({ amount: '3948.68' }));
    const res = await resolveMxReturnMatch({ referenceNumber: '06DG800TUAUA', amount: 500 });
    expect(res.outcome).toBe('flagged');
    expect(res.matchNote).toContain('does not match transaction amount');
    expect(reverseMappingMock).not.toHaveBeenCalled();
    expect(resolveReturnCmpReversalMock).not.toHaveBeenCalled();
  });
});

describe('resolveMxReturnMatch — real stored cmp_ref reverses directly', () => {
  it('reverses via the stored ref, never calls the CMP lookup path, never the fallback', async () => {
    findByReturnReferenceMock.mockResolvedValue(
      makeTx({ cmpRef: { kind: 'invoice', invoiceId: '75023', paymentId: '51132', amount: 3948.68 } }),
    );
    reverseMappingMock.mockResolvedValue({ ok: true, kind: 'invoice', reversed: [{ invoiceId: '75023', paymentId: '51132' }] });

    const res = await resolveMxReturnMatch({ referenceNumber: '06DG800TUAUA', amount: 3948.68 });

    expect(res.outcome).toBe('reversed');
    expect(res.isReversed).toBe(true);
    expect(res.matchNote).toBe('Reversal(s) applied to CMP');
    expect(reverseMappingMock).toHaveBeenCalledWith(expect.objectContaining({ allowCmpLookup: false }));
    expect(resolveReturnCmpReversalMock).not.toHaveBeenCalled();
  });

  it('a stored-ref reversal failure surfaces as flagged, not thrown', async () => {
    findByReturnReferenceMock.mockResolvedValue(
      makeTx({ cmpRef: { kind: 'invoice', invoiceId: '75023', paymentId: '51132', amount: 3948.68 } }),
    );
    reverseMappingMock.mockResolvedValue({ ok: false, kind: 'invoice', reversed: [], message: 'servercrm 503' });

    const res = await resolveMxReturnMatch({ referenceNumber: '06DG800TUAUA', amount: 3948.68 });

    expect(res.outcome).toBe('flagged');
    expect(res.isReversed).toBe(false);
    expect(res.matchNote).toContain('servercrm 503');
  });
});

describe('resolveMxReturnMatch — no ref: delegates to resolveReturnCmpReversal', () => {
  it('a successful fallback reversal is reported as reversed, carries the mappingPatch through', async () => {
    findByReturnReferenceMock.mockResolvedValue(makeTx({ isInvoiceMapped: false, carrierId: null, cmpRef: null }));
    resolveReturnCmpReversalMock.mockResolvedValue({
      matchNote: 'Reversal(s) applied to CMP',
      isReversed: true,
      wouldSucceed: true,
      mappingPatch: { carrierId: '5834597', mappingType: 'Auto-Mapped (return)' },
      detail: { attempted: true, carrierId: '5834597', carrierVia: 'name', reversedCount: 1 },
    });

    const res = await resolveMxReturnMatch({ referenceNumber: '06DG800TUAUA', amount: 3948.68 });

    expect(res.outcome).toBe('reversed');
    expect(res.isReversed).toBe(true);
    expect(res.mappingPatch).toEqual({ carrierId: '5834597', mappingType: 'Auto-Mapped (return)' });
    expect(reverseMappingMock).not.toHaveBeenCalled(); // the direct-ref path is skipped entirely
  });

  it('a resolver miss (not attempted at all) is unlinked, not flagged — avoids dead-end noise', async () => {
    findByReturnReferenceMock.mockResolvedValue(makeTx({ isInvoiceMapped: false, carrierId: null, senderName: null, name: '', cmpRef: null }));
    resolveReturnCmpReversalMock.mockResolvedValue({
      matchNote: 'not mapped — no CMP payment to reverse',
      isReversed: false,
      wouldSucceed: false,
      detail: { attempted: false },
    });

    const res = await resolveMxReturnMatch({ referenceNumber: '06DG800TUAUA', amount: 3948.68 });

    expect(res.outcome).toBe('unlinked');
  });

  it('an ambiguous fallback (candidates but no unique carrier) is flagged, not reversed', async () => {
    findByReturnReferenceMock.mockResolvedValue(makeTx({ isInvoiceMapped: false, carrierId: null, cmpRef: null }));
    resolveReturnCmpReversalMock.mockResolvedValue({
      matchNote: 'several CMP companies match the payer name (2 candidates) — pick the carrier manually',
      isReversed: false,
      wouldSucceed: false,
      detail: { attempted: true, candidateCount: 2 },
    });

    const res = await resolveMxReturnMatch({ referenceNumber: '06DG800TUAUA', amount: 3948.68 });

    expect(res.outcome).toBe('flagged');
    expect(res.isReversed).toBe(false);
  });
});
