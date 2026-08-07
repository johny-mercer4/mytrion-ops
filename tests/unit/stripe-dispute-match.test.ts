/**
 * resolveStripeDisputeMatch — the Stripe twin of returns-cmp-reversal.test.ts, but far more
 * conservative: a Stripe row with no stored `cmp_ref` is ALWAYS flagged for a human, never quietly
 * dismissed as "nothing to reverse" — confirmed against prod that `mappingType`/`isInvoiceMapped`
 * do not reliably indicate whether CMP holds the money (see stripeDisputeMatch.ts's docblock).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reverseMappingMock, findBySourceRecordMock } = vi.hoisted(() => ({
  reverseMappingMock: vi.fn(),
  findBySourceRecordMock: vi.fn(),
}));
vi.mock('../../src/modules/billing/cmpWrites.js', () => ({ reverseMapping: reverseMappingMock }));
vi.mock('../../src/repos/paymentTransactionRepo.js', () => ({
  paymentTransactionRepo: { findBySourceRecord: findBySourceRecordMock },
}));

import type { PaymentTransaction } from '../../src/db/schema/index.js';
import { REVERSED_NOTE, resolveStripeDisputeMatch } from '../../src/modules/billing/stripeDisputeMatch.js';

function makeTx(overrides: Partial<PaymentTransaction> = {}): PaymentTransaction {
  return {
    id: 500,
    source: 'stripe',
    sourceModule: 'zapier',
    sourceRecordId: 'pi_abc123',
    carrierId: null,
    amount: '1000.00',
    currency: 'USD',
    occurredAt: new Date('2026-07-20T00:00:00Z'),
    name: 'ROAD WARRIORS TRANS INC',
    status: 'succeeded',
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
});

describe('resolveStripeDisputeMatch — no signal to link on', () => {
  it('no paymentIntentId at all: unlinked, never queries the DB', async () => {
    const res = await resolveStripeDisputeMatch({ amount: 1000 });
    expect(res).toEqual({ outcome: 'unlinked', isReversed: false, detail: {} });
    expect(findBySourceRecordMock).not.toHaveBeenCalled();
  });

  it('a blank paymentIntentId is treated the same as absent', async () => {
    const res = await resolveStripeDisputeMatch({ paymentIntentId: '   ', amount: 1000 });
    expect(res.outcome).toBe('unlinked');
    expect(findBySourceRecordMock).not.toHaveBeenCalled();
  });

  it('paymentIntentId given but no matching transaction: unlinked', async () => {
    findBySourceRecordMock.mockResolvedValue(undefined);
    const res = await resolveStripeDisputeMatch({ paymentIntentId: 'pi_ghost', amount: 1000 });
    expect(res.outcome).toBe('unlinked');
    expect(reverseMappingMock).not.toHaveBeenCalled();
  });
});

describe('resolveStripeDisputeMatch — linked but unsafe to auto-reverse', () => {
  it('transaction already flagged returned: flagged, no CMP call (double-reversal guard)', async () => {
    findBySourceRecordMock.mockResolvedValue(makeTx({ isReturned: true }));
    const res = await resolveStripeDisputeMatch({ paymentIntentId: 'pi_abc123', amount: 1000 });
    expect(res.outcome).toBe('flagged');
    expect(res.originalTransactionId).toBe(500);
    expect(res.matchNote).toContain('already flagged returned');
    expect(reverseMappingMock).not.toHaveBeenCalled();
  });

  it('partial dispute (amount does not match the charge): flagged, no CMP call', async () => {
    findBySourceRecordMock.mockResolvedValue(makeTx({ amount: '1000.00' }));
    const res = await resolveStripeDisputeMatch({ paymentIntentId: 'pi_abc123', amount: 400 });
    expect(res.outcome).toBe('flagged');
    expect(res.matchNote).toContain('does not match transaction amount');
    expect(res.matchNote).toContain('partial dispute');
    expect(reverseMappingMock).not.toHaveBeenCalled();
  });

  it('mapped via "Stripe (auto)" with no cmp_ref: ALWAYS flagged, never the quiet "not mapped" note', async () => {
    findBySourceRecordMock.mockResolvedValue(
      makeTx({ isInvoiceMapped: true, mappingType: 'Stripe (auto)', cmpRef: null }),
    );
    const res = await resolveStripeDisputeMatch({ paymentIntentId: 'pi_abc123', amount: 1000 });
    expect(res.outcome).toBe('flagged');
    expect(res.matchNote).toContain('reconcile manually');
    expect(res.matchNote).not.toContain('not mapped — no CMP payment to reverse');
    expect(reverseMappingMock).not.toHaveBeenCalled();
  });

  it('genuinely unmapped, no cmp_ref: still flagged, not quietly dismissed', async () => {
    findBySourceRecordMock.mockResolvedValue(makeTx({ isInvoiceMapped: false, mappingType: null, cmpRef: null }));
    const res = await resolveStripeDisputeMatch({ paymentIntentId: 'pi_abc123', amount: 1000 });
    expect(res.outcome).toBe('flagged');
    expect(res.matchNote).toContain('reconcile manually');
    expect(reverseMappingMock).not.toHaveBeenCalled();
  });

  it('a stored cmp_ref missing paymentId/invoiceId is treated as unusable — flagged, no CMP call', async () => {
    findBySourceRecordMock.mockResolvedValue(
      makeTx({ cmpRef: { kind: 'invoice', invoiceNumber: '175023' } }), // no paymentId/invoiceId
    );
    const res = await resolveStripeDisputeMatch({ paymentIntentId: 'pi_abc123', amount: 1000 });
    expect(res.outcome).toBe('flagged');
    expect(reverseMappingMock).not.toHaveBeenCalled();
  });
});

describe('resolveStripeDisputeMatch — the ONE safe auto-reversal condition', () => {
  const withRealRef = makeTx({
    isInvoiceMapped: true,
    mappingType: 'Invoice',
    carrierId: '5790329',
    cmpRef: { kind: 'invoice', invoiceId: '75023', paymentId: '51132', amount: 1000, invoiceNumber: '175023' },
  });

  it('a real stored cmp_ref we created: reverses, never via the CMP lookup path', async () => {
    findBySourceRecordMock.mockResolvedValue(withRealRef);
    reverseMappingMock.mockResolvedValue({ ok: true, kind: 'invoice', reversed: [{ invoiceId: '75023', paymentId: '51132' }] });

    const res = await resolveStripeDisputeMatch({ paymentIntentId: 'pi_abc123', amount: 1000 });

    expect(res.outcome).toBe('reversed');
    expect(res.isReversed).toBe(true);
    expect(res.matchNote).toBe(REVERSED_NOTE);
    expect(reverseMappingMock).toHaveBeenCalledWith(expect.objectContaining({ allowCmpLookup: false }));
  });

  it('CMP reverse failure surfaces as flagged, not thrown', async () => {
    findBySourceRecordMock.mockResolvedValue(withRealRef);
    reverseMappingMock.mockResolvedValue({ ok: false, kind: 'invoice', reversed: [], message: 'servercrm 503' });

    const res = await resolveStripeDisputeMatch({ paymentIntentId: 'pi_abc123', amount: 1000 });

    expect(res.outcome).toBe('flagged');
    expect(res.isReversed).toBe(false);
    expect(res.matchNote).toContain('servercrm 503');
  });
});
