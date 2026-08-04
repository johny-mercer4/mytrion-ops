/**
 * reverseMapping — what actually comes back out of CMP when a payment is returned or unmapped.
 *
 * The case that matters: a mapped MX charge with NO stored cmp_ref (which is every mapped MX row in
 * Postgres — the portal auto-applied the payment and no ref was ever recorded). That used to return
 * a silent ok/'none', so a bounced payment stayed credited in CMP and the return read as "not
 * mapped". A return must now resolve the payment live; a manual unmap must still not delete a
 * genuine portal payment.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/integrations/serverCrm.js', () => ({
  serverCrm: { post: vi.fn(), get: vi.fn(), call: vi.fn() },
}));

import { serverCrm } from '../../src/integrations/serverCrm.js';
import { reverseMapping } from '../../src/modules/billing/cmpWrites.js';

const post = vi.mocked(serverCrm.post);
const call = vi.mocked(serverCrm.call);

/** Paths hit on servercrm, in order — the assertion that says what moved in CMP. */
const paths = (): string[] => [
  ...post.mock.calls.map((c) => String(c[0])),
  ...call.mock.calls.map((c) => String(c[1])),
];

const RESOLVE = '/api/billing/cmp/resolve-ref';
const REVERSE = '/api/billing/cmp/invoice-payment/reverse';

const mappedNoRef = {
  cmpRef: null,
  splitAllocations: null,
  carrierId: '5801437',
  amount: 720.34,
  chargedDay: '2026-07-02',
};

beforeEach(() => {
  vi.clearAllMocks();
  post.mockResolvedValue({} as never);
  call.mockResolvedValue({} as never);
});

describe('reverseMapping — mapped charge with no stored CMP ref', () => {
  it('resolves the payment in CMP and deletes it (return path)', async () => {
    const entries = [{ invoiceId: 'INV-1', paymentId: 'PAY-1', amount: 720.34 }];
    post.mockImplementation(async (path: string) =>
      (path === RESOLVE ? { status: 'success', entries } : {}) as never,
    );

    const res = await reverseMapping({ ...mappedNoRef, resolveMissingRef: true });

    expect(res).toMatchObject({ ok: true, kind: 'invoice', reversed: entries });
    expect(paths()).toEqual([RESOLVE, REVERSE]);
    expect(post.mock.calls[0]?.[1]).toMatchObject({ carrierId: '5801437', amount: 720.34, chargedDay: '2026-07-02' });
  });

  it('rejects a resolved payment whose amount does not match the charge — nothing is deleted', async () => {
    const entries = [{ invoiceId: 'INV-1', paymentId: 'PAY-1', amount: 99.99 }];
    post.mockImplementation(async (path: string) =>
      (path === RESOLVE ? { status: 'success', entries } : {}) as never,
    );

    const res = await reverseMapping({ ...mappedNoRef, resolveMissingRef: true });

    expect(res.ok).toBe(false);
    expect(res.message).toContain('reconcile manually');
    expect(paths()).toEqual([RESOLVE]); // never reaches REVERSE
  });

  it('forwards invoiceNumber on the no-ref path so the CMP lookup is scoped to one invoice', async () => {
    const entries = [{ invoiceId: 'INV-1', paymentId: 'PAY-1', amount: 720.34 }];
    post.mockImplementation(async (path: string) =>
      (path === RESOLVE ? { status: 'success', entries } : {}) as never,
    );

    await reverseMapping({ ...mappedNoRef, resolveMissingRef: true, invoiceNumber: 'INV-42' });

    expect(post.mock.calls[0]?.[1]).toMatchObject({ invoiceNumber: 'INV-42' });
  });

  it('refuses to reverse a payment already claimed by another transaction', async () => {
    const entries = [{ invoiceId: 'INV-1', paymentId: 'PAY-1', amount: 720.34 }];
    post.mockImplementation(async (path: string) =>
      (path === RESOLVE ? { status: 'success', entries } : {}) as never,
    );
    const isEntryClaimed = vi.fn().mockResolvedValue(true);

    const res = await reverseMapping({ ...mappedNoRef, resolveMissingRef: true, isEntryClaimed });

    expect(res.ok).toBe(false);
    expect(res.message).toContain('already attributed');
    expect(isEntryClaimed).toHaveBeenCalledWith(entries[0]);
    expect(paths()).toEqual([RESOLVE]); // never reaches REVERSE
  });

  it('dryRun: resolves and verifies but never calls REVERSE — nothing is deleted', async () => {
    const entries = [{ invoiceId: 'INV-1', paymentId: 'PAY-1', amount: 720.34 }];
    post.mockImplementation(async (path: string) =>
      (path === RESOLVE ? { status: 'success', entries } : {}) as never,
    );

    const res = await reverseMapping({ ...mappedNoRef, resolveMissingRef: true, dryRun: true });

    expect(res).toMatchObject({ ok: true, kind: 'invoice', reversed: entries });
    expect(paths()).toEqual([RESOLVE]); // RESOLVE only — REVERSE is never called
  });

  it('fails loudly when CMP cannot be resolved — nothing is deleted', async () => {
    post.mockImplementation(async (path: string) =>
      (path === RESOLVE ? { status: 'error', message: 'no unambiguous payment' } : {}) as never,
    );

    const res = await reverseMapping({ ...mappedNoRef, resolveMissingRef: true });

    expect(res.ok).toBe(false);
    expect(res.message).toContain('no unambiguous payment');
    expect(paths()).toEqual([RESOLVE]);
  });

  it('an ambiguous resolve that returns no entries is a failure, not a no-op', async () => {
    post.mockImplementation(async (path: string) => (path === RESOLVE ? { status: 'success', entries: [] } : {}) as never);

    const res = await reverseMapping({ ...mappedNoRef, resolveMissingRef: true });

    expect(res.ok).toBe(false);
    expect(res.message).toContain('reconcile manually');
    expect(paths()).toEqual([RESOLVE]);
  });

  it('NEVER touches CMP on the unmap path (no resolveMissingRef)', async () => {
    const res = await reverseMapping(mappedNoRef);

    expect(res).toMatchObject({ ok: true, kind: 'none', reversed: [] });
    expect(paths()).toEqual([]);
  });

  it('refuses to guess for a CRM-Sync mapping — flags it for a human', async () => {
    const res = await reverseMapping({ ...mappedNoRef, resolveMissingRef: true, mappingType: 'CRM-Sync (Invoice)' });

    expect(res.ok).toBe(false);
    expect(res.message).toContain('CRM-Sync');
    expect(paths()).toEqual([]);
  });

  it('cannot look up a payment without a carrier — says so instead of succeeding', async () => {
    const res = await reverseMapping({ ...mappedNoRef, carrierId: null, resolveMissingRef: true });

    expect(res.ok).toBe(false);
    expect(res.message).toContain('reconcile manually');
    expect(paths()).toEqual([]);
  });
});

describe('reverseMapping — stored refs still take the direct path', () => {
  it('deletes the stored invoice payment without a lookup', async () => {
    const res = await reverseMapping({
      cmpRef: { kind: 'invoice', invoiceId: 'INV-9', paymentId: 'PAY-9' },
      resolveMissingRef: true,
    });

    expect(res).toMatchObject({ ok: true, kind: 'invoice' });
    expect(paths()).toEqual([REVERSE]);
  });

  it('decrements the prepay balance by the mapped amount', async () => {
    const res = await reverseMapping({
      cmpRef: { kind: 'prepay', companyId: 'CO-1', amount: 500 },
      resolveMissingRef: true,
    });

    expect(res).toMatchObject({ ok: true, kind: 'prepay' });
    expect(paths()).toEqual(['/api/billing/cmp/company-balance']);
    expect(call.mock.calls[0]?.[2]).toMatchObject({ body: { companyId: 'CO-1', amount: -500 } });
  });

  it('an invoice ref missing its paymentId is resolved, then reversed', async () => {
    const entries = [{ invoiceId: 'INV-3', paymentId: 'PAY-3', amount: 100 }];
    post.mockImplementation(async (path: string) =>
      (path === RESOLVE ? { status: 'success', entries } : {}) as never,
    );

    const res = await reverseMapping({
      cmpRef: { kind: 'invoice', invoiceNumber: 'OCT-123' },
      carrierId: '5801437',
      amount: 100,
      resolveMissingRef: true,
    });

    expect(res).toMatchObject({ ok: true, kind: 'invoice', reversed: entries });
    expect(paths()).toEqual([RESOLVE, REVERSE]);
    expect(post.mock.calls[0]?.[1]).toMatchObject({ invoiceNumber: 'OCT-123' });
  });
});
