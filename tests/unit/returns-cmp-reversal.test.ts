/**
 * resolveReturnCmpReversal — the decision behind fixing "Matched · no CMP action" returns.
 *
 * Root cause: an MX Merchant charge is frequently paid straight through the CMP client portal and
 * auto-applied to an invoice there, independent of whether our system ever resolved a carrier for
 * the row. The live match route used to assume "never mapped in our system" meant "never touched
 * CMP" and gave up immediately. This module resolves the carrier — preferring `tx.carrierId` when
 * already known, otherwise searching CMP directly by company name (NOT the local
 * payment_carrier_memory/DWH fuzzy match, per an explicit user decision that local data is
 * unreliable for this task) — then reuses the same resolve-then-reverse plumbing already proven for
 * mapped transactions.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reverseMappingMock, discoverCarrierByNameMock, isCmpPaymentClaimedMock } = vi.hoisted(() => ({
  reverseMappingMock: vi.fn(),
  discoverCarrierByNameMock: vi.fn(),
  isCmpPaymentClaimedMock: vi.fn(),
}));
vi.mock('../../src/modules/billing/cmpWrites.js', () => ({ reverseMapping: reverseMappingMock }));
vi.mock('../../src/modules/billing/cmpCarrierDiscovery.js', () => ({ discoverCarrierByName: discoverCarrierByNameMock }));
vi.mock('../../src/repos/paymentTransactionRepo.js', () => ({
  paymentTransactionRepo: { isCmpPaymentClaimed: isCmpPaymentClaimedMock },
}));

import type { PaymentTransaction } from '../../src/db/schema/index.js';
import {
  AUTO_MAPPED_RETURN_TYPE,
  NOT_MAPPED_NOTE,
  REVERSED_NOTE,
  resolveReturnCmpReversal,
} from '../../src/modules/billing/returnsCmpReversal.js';

function makeTx(overrides: Partial<PaymentTransaction> = {}): PaymentTransaction {
  return {
    id: 1,
    source: 'mx',
    sourceModule: null,
    sourceRecordId: 'mx-1',
    carrierId: null,
    amount: '720.34',
    currency: 'USD',
    occurredAt: new Date('2026-07-27T19:08:20.277Z'),
    name: 'ROAD WARRIORS TRANS INC',
    status: null,
    txnType: null,
    externalTxnId: null,
    senderName: 'ROAD WARRIORS TRANS INC',
    memo: null,
    description: null,
    email: null,
    cardBrand: null,
    cardLast4: null,
    customerRef: null,
    receiptUrl: null,
    isInvoiceMapped: false,
    mappingType: null,
    mappedBy: null,
    mappedAt: null,
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
  isCmpPaymentClaimedMock.mockResolvedValue(false);
});

describe('resolveReturnCmpReversal — guards that skip entirely (no CMP call at all)', () => {
  it('non-MX source: never resolves a carrier for Zelle/Chase/Stripe', async () => {
    const res = await resolveReturnCmpReversal(makeTx({ source: 'zelle' }));
    expect(res).toEqual({ matchNote: NOT_MAPPED_NOTE, isReversed: false, wouldSucceed: false, detail: { attempted: false } });
    expect(discoverCarrierByNameMock).not.toHaveBeenCalled();
  });

  it('already carries a cmpRef: truly already resolved, never re-attempted', async () => {
    const res = await resolveReturnCmpReversal(makeTx({ cmpRef: { invoiceId: 'I', paymentId: 'P' } }));
    expect(res.detail.attempted).toBe(false);
    expect(discoverCarrierByNameMock).not.toHaveBeenCalled();
  });

  it('no amount: nothing to reverse regardless of carrier signal', async () => {
    const res = await resolveReturnCmpReversal(makeTx({ amount: null }));
    expect(res.detail.attempted).toBe(false);
    expect(discoverCarrierByNameMock).not.toHaveBeenCalled();
  });

  it('no name and no tx.carrierId: nothing to search CMP with', async () => {
    const res = await resolveReturnCmpReversal(makeTx({ senderName: null, name: '' }));
    expect(res.detail.attempted).toBe(false);
    expect(discoverCarrierByNameMock).not.toHaveBeenCalled();
  });
});

describe('resolveReturnCmpReversal — tx.carrierId already known', () => {
  it('uses it directly, never calls discovery, never guesses', async () => {
    reverseMappingMock.mockResolvedValue({ ok: true, kind: 'invoice', reversed: [{ invoiceId: 'I', paymentId: 'P' }] });

    const res = await resolveReturnCmpReversal(makeTx({ carrierId: '5801437' }));

    expect(discoverCarrierByNameMock).not.toHaveBeenCalled();
    expect(reverseMappingMock.mock.calls[0]?.[0]).toMatchObject({ carrierId: '5801437' });
    expect(res.matchNote).toBe(REVERSED_NOTE);
    expect(res.mappingPatch).toEqual({ carrierId: '5801437', mappingType: AUTO_MAPPED_RETURN_TYPE });
    expect(res.detail.carrierVia).toBe('tx');
  });

  // Regression pin: safe ONLY because this whole function already bails unless tx.source === 'mx'
  // (see the top-of-function gate tested elsewhere in this file) — allowCmpLookup must stay true
  // here specifically, never copy this pattern into a caller that hasn't gated the rail itself.
  it('passes allowCmpLookup:true to reverseMapping (safe here — this function is MX-gated)', async () => {
    reverseMappingMock.mockResolvedValue({ ok: true, kind: 'invoice', reversed: [{ invoiceId: 'I', paymentId: 'P' }] });

    await resolveReturnCmpReversal(makeTx({ carrierId: '5801437' }));

    expect(reverseMappingMock.mock.calls[0]?.[0]).toMatchObject({ allowCmpLookup: true });
  });
});

describe('resolveReturnCmpReversal — already mapped (carrierId known) but no cmpRef yet', () => {
  it('still attempts reversal via the known carrierId, but does NOT stamp a mappingPatch (mapping already correct)', async () => {
    reverseMappingMock.mockResolvedValue({ ok: true, kind: 'invoice', reversed: [{ invoiceId: 'I', paymentId: 'P' }] });

    const res = await resolveReturnCmpReversal(makeTx({ isInvoiceMapped: true, carrierId: '5823382', mappingType: 'Auto-Mapped (CMP)' }));

    expect(discoverCarrierByNameMock).not.toHaveBeenCalled();
    expect(reverseMappingMock.mock.calls[0]?.[0]).toMatchObject({ carrierId: '5823382' });
    expect(res.isReversed).toBe(true);
    expect(res.mappingPatch).toBeUndefined();
    expect(res.detail).toMatchObject({ attempted: true, carrierId: '5823382', carrierVia: 'tx' });
  });
});

describe('resolveReturnCmpReversal — CMP-by-name discovery (no tx.carrierId)', () => {
  it('resolves the CMP payment and returns a mapping patch to stamp on the transaction', async () => {
    discoverCarrierByNameMock.mockResolvedValue({ carrierId: '5823382', via: 'name', candidates: [] });
    reverseMappingMock.mockResolvedValue({ ok: true, kind: 'invoice', reversed: [{ invoiceId: 'I', paymentId: 'P' }] });

    const res = await resolveReturnCmpReversal(makeTx());

    expect(discoverCarrierByNameMock).toHaveBeenCalledWith({ companyName: 'ROAD WARRIORS TRANS INC', invoiceNumber: undefined });
    expect(res.matchNote).toBe(REVERSED_NOTE);
    expect(res.isReversed).toBe(true);
    expect(res.mappingPatch).toEqual({ carrierId: '5823382', mappingType: AUTO_MAPPED_RETURN_TYPE });
    expect(res.detail).toMatchObject({ attempted: true, carrierId: '5823382', carrierVia: 'name', reversedCount: 1 });
  });

  it('extracts the MX invoice number from raw.invoice and forwards it to discovery and to CMP', async () => {
    discoverCarrierByNameMock.mockResolvedValue({ carrierId: '5823382', via: 'name', candidates: [] });
    reverseMappingMock.mockResolvedValue({ ok: true, kind: 'invoice', reversed: [] });

    await resolveReturnCmpReversal(makeTx({ raw: { invoice: 'INV-777' } }));

    expect(discoverCarrierByNameMock).toHaveBeenCalledWith({ companyName: 'ROAD WARRIORS TRANS INC', invoiceNumber: 'INV-777' });
    expect(reverseMappingMock.mock.calls[0]?.[0]).toMatchObject({ invoiceNumber: 'INV-777' });
  });

  it('wires the claim-check to the transaction being reversed, excluding itself', async () => {
    discoverCarrierByNameMock.mockResolvedValue({ carrierId: '5823382', via: 'name', candidates: [] });
    reverseMappingMock.mockResolvedValue({ ok: true, kind: 'invoice', reversed: [] });

    await resolveReturnCmpReversal(makeTx({ id: 42 }));
    const isEntryClaimed = reverseMappingMock.mock.calls[0]?.[0]?.isEntryClaimed;
    await isEntryClaimed({ invoiceId: 'I', paymentId: 'P' });

    expect(isCmpPaymentClaimedMock).toHaveBeenCalledWith('I', 'P', 42);
  });

  it('a resolver miss (ambiguous / not found in CMP) reports "reconcile manually", nothing reversed', async () => {
    discoverCarrierByNameMock.mockResolvedValue({ carrierId: '5823382', via: 'name', candidates: [] });
    reverseMappingMock.mockResolvedValue({ ok: false, kind: 'invoice', reversed: [], message: 'no unambiguous payment' });

    const res = await resolveReturnCmpReversal(makeTx());

    expect(res.isReversed).toBe(false);
    expect(res.matchNote).toContain('reconcile manually');
    expect(res.matchNote).toContain('no unambiguous payment');
    expect(res.mappingPatch).toBeUndefined();
  });

  it('a servercrm/CMP hiccup during reversal degrades to a distinct "lookup failed" note — never throws', async () => {
    discoverCarrierByNameMock.mockResolvedValue({ carrierId: '5823382', via: 'name', candidates: [] });
    reverseMappingMock.mockRejectedValue(new Error('servercrm 503'));

    const res = await resolveReturnCmpReversal(makeTx());

    expect(res.isReversed).toBe(false);
    expect(res.matchNote).toBe('CMP lookup failed — reconcile manually');
    expect(res.detail.resolveMessage).toContain('servercrm 503');
  });

  it('discovery finding no carrier at all (zero candidates) falls back to the default note', async () => {
    discoverCarrierByNameMock.mockResolvedValue({ carrierId: null, candidates: [] });

    const res = await resolveReturnCmpReversal(makeTx());

    expect(res).toEqual({ matchNote: NOT_MAPPED_NOTE, isReversed: false, wouldSucceed: false, detail: { attempted: false } });
    expect(reverseMappingMock).not.toHaveBeenCalled();
  });

  it('discovery service throwing (servercrm/CMP outage) degrades to not-attempted, never throws', async () => {
    discoverCarrierByNameMock.mockRejectedValue(new Error('servercrm unreachable'));

    const res = await resolveReturnCmpReversal(makeTx());

    expect(res.detail.attempted).toBe(false);
    expect(reverseMappingMock).not.toHaveBeenCalled();
  });

  it('ambiguous discovery (multiple CMP candidates) produces a distinct, actionable note — never guesses', async () => {
    discoverCarrierByNameMock.mockResolvedValue({
      carrierId: null,
      candidates: [
        { carrierId: '5823382', companyName: 'ROAD WARRIORS TRANS INC' },
        { carrierId: '5999999', companyName: 'ROAD WARRIORS TRANS AND LOGISTICS' },
      ],
      message: '"ROAD WARRIORS TRANS INC" matches 2 distinct CMP carriers — pick one manually',
    });

    const res = await resolveReturnCmpReversal(makeTx());

    expect(reverseMappingMock).not.toHaveBeenCalled();
    expect(res.isReversed).toBe(false);
    expect(res.wouldSucceed).toBe(false);
    expect(res.mappingPatch).toBeUndefined();
    expect(res.detail.attempted).toBe(true);
    expect(res.detail.candidateCount).toBe(2);
    // Must NOT collapse into the generic "not mapped" note — this is actionable, not a dead end.
    expect(res.matchNote).not.toBe(NOT_MAPPED_NOTE);
    expect(res.matchNote).toMatch(/pick the carrier manually/i);
  });

  it('dryRun: forwards it to reverseMapping and never claims a real reversal, even on a resolver success', async () => {
    discoverCarrierByNameMock.mockResolvedValue({ carrierId: '5823382', via: 'name', candidates: [] });
    // Simulates cmpWrites.ts's own dryRun short-circuit: resolved, but NOT actually deleted.
    reverseMappingMock.mockResolvedValue({ ok: true, kind: 'invoice', reversed: [{ invoiceId: 'I', paymentId: 'P' }] });

    const res = await resolveReturnCmpReversal(makeTx(), { dryRun: true });

    expect(reverseMappingMock.mock.calls[0]?.[0]).toMatchObject({ dryRun: true });
    expect(res.isReversed).toBe(false); // nothing was actually deleted
    expect(res.wouldSucceed).toBe(true); // but the resolve+checks DID pass
    expect(res.mappingPatch).toEqual({ carrierId: '5823382', mappingType: AUTO_MAPPED_RETURN_TYPE });
    expect(res.matchNote).toBe(NOT_MAPPED_NOTE); // the DB is never touched in dry-run, so this is moot
  });
});
