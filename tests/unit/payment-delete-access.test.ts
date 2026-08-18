/**
 * canDeletePaymentTransaction / canDeleteChaseTransactionsFact — who may hard-delete a manually-
 * entered payment_transactions row beyond the base admin bypass.
 *
 * The one thing here that is easy to get wrong and invisible from a passing screen: ctx.userId is
 * `zoho:<id>` for a verified worker session, but grants are keyed on the bare id. Forgetting to
 * strip the prefix turns every real grant into a silent no-op — the frontend hint would show the
 * Delete button (it strips correctly), but the actual delete would 403 every single time.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/repos/paymentDeleteGrantRepo.js', () => ({
  paymentDeleteGrantRepo: { isGranted: vi.fn() },
}));

import { paymentDeleteGrantRepo } from '../../src/repos/paymentDeleteGrantRepo.js';
import {
  canDeleteChaseTransactionsFact,
  canDeletePaymentTransaction,
} from '../../src/modules/billing/paymentDeleteAccess.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

const repo = vi.mocked(paymentDeleteGrantRepo);

function ctx(over: Partial<TenantContext> = {}): TenantContext {
  return {
    tenantId: 'octane',
    userId: 'zoho:99',
    audience: 'internal',
    role: 'worker',
    scopes: [],
    departments: ['billing'],
    allDepartmentAccess: false,
    requestId: 'r1',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('canDeletePaymentTransaction', () => {
  it('admin bypasses the grant check entirely — never even queries it', async () => {
    const out = await canDeletePaymentTransaction(ctx({ role: 'admin' }), 'chase');
    expect(out).toBe(true);
    expect(repo.isGranted).not.toHaveBeenCalled();
  });

  it('allDepartmentAccess bypasses too, even with role "worker"', async () => {
    const out = await canDeletePaymentTransaction(ctx({ allDepartmentAccess: true }), 'chase');
    expect(out).toBe(true);
    expect(repo.isGranted).not.toHaveBeenCalled();
  });

  it('bypassRbac (break-glass) bypasses too', async () => {
    const out = await canDeletePaymentTransaction(ctx({ bypassRbac: true }), 'chase');
    expect(out).toBe(true);
    expect(repo.isGranted).not.toHaveBeenCalled();
  });

  it('a plain worker with no grant is refused', async () => {
    repo.isGranted.mockResolvedValue(false);
    const out = await canDeletePaymentTransaction(ctx(), 'chase');
    expect(out).toBe(false);
  });

  it('a plain worker WITH a grant is allowed', async () => {
    repo.isGranted.mockResolvedValue(true);
    const out = await canDeletePaymentTransaction(ctx(), 'chase');
    expect(out).toBe(true);
  });

  // Regression pin for the exact bug caught during review: the "zoho:" prefix must be stripped
  // before checking the grant table, or every real grant is a silent no-op.
  it('strips the "zoho:" prefix before checking the grant — the id passed to the repo is bare', async () => {
    repo.isGranted.mockResolvedValue(true);
    await canDeletePaymentTransaction(ctx({ userId: 'zoho:12345' }), 'chase');
    expect(repo.isGranted).toHaveBeenCalledWith('12345', 'chase');
  });

  it('is scoped by source — a chase grant does not imply a zelle grant', async () => {
    await canDeletePaymentTransaction(ctx({ userId: 'zoho:12345' }), 'zelle');
    expect(repo.isGranted).toHaveBeenCalledWith('12345', 'zelle');
  });
});

describe('canDeleteChaseTransactionsFact', () => {
  it('is a bare pass-through to the grant table for source=chase', async () => {
    repo.isGranted.mockResolvedValue(true);
    const out = await canDeleteChaseTransactionsFact('12345');
    expect(out).toBe(true);
    expect(repo.isGranted).toHaveBeenCalledWith('12345', 'chase');
  });

  it('fails CLOSED (false) on a repo error — never throws, /auth/me is on every page load', async () => {
    repo.isGranted.mockRejectedValue(new Error('db down'));
    const out = await canDeleteChaseTransactionsFact('12345');
    expect(out).toBe(false);
  });
});
