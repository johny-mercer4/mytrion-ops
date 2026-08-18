import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Owner self-service feedback, 2026-08-07 — the two money bugs, at the module that produces both
 * figures.
 *
 *   #4 Balance Check was dead ("Couldn't load this") while Account Status rendered on the same
 *      account: /carrier-balance was failing where /carrier-overview was not.
 *   #2 "Available to draw" read $0.00 for prepay clients, because servercrm's money-code window is
 *      a percentage of the latest invoice and a prepay account has no invoices.
 */
vi.mock('../../src/wrappers/serverCrmWrapper.js', () => ({
  serverCrmWrapper: {
    getCarrierBalance: vi.fn(),
    getCarrierOverview: vi.fn(),
  },
}));

import { serverCrmWrapper } from '../../src/wrappers/serverCrmWrapper.js';
import {
  isPrepayCarrier,
  resolveCarrierBalance,
  withPrepayDrawWindow,
} from '../../src/modules/carrier/carrierBalance.js';

const crm = vi.mocked(serverCrmWrapper);

beforeEach(() => {
  vi.resetAllMocks();
});

describe('resolveCarrierBalance — Balance Check must not dead-end (feedback #4)', () => {
  it('returns the dedicated carrier-balance payload when it works', async () => {
    crm.getCarrierBalance.mockResolvedValueOnce({
      account_type: 'LOC',
      efs_balance: 4210.5,
      credit_limit: 9000,
      credit_remaining: 4210.5,
    });

    await expect(resolveCarrierBalance('5758544')).resolves.toMatchObject({
      account_type: 'LOC',
      efs_balance: 4210.5,
      credit_remaining: 4210.5,
    });
    expect(crm.getCarrierOverview).not.toHaveBeenCalled();
  });

  it('falls back to carrier-overview when carrier-balance fails — the reported bug', async () => {
    crm.getCarrierBalance.mockRejectedValueOnce(new Error('servercrm request failed'));
    crm.getCarrierOverview.mockResolvedValueOnce({
      company_name: 'Acme Transport LLC',
      account_type: 'Prepay',
      // servercrm sends money as a numeric STRING as often as a number.
      efs_balance: '1875.25',
      credit_limit: null,
    });

    await expect(resolveCarrierBalance('5758544')).resolves.toEqual({
      company_name: 'Acme Transport LLC',
      account_type: 'Prepay',
      payment_terms: null,
      efs_balance: 1875.25,
      credit_limit: null,
      efs_error: null,
    });
  });

  it('still fails when the overview is down too — a real outage keeps its retry affordance', async () => {
    crm.getCarrierBalance.mockRejectedValueOnce(new Error('carrier-balance 502'));
    crm.getCarrierOverview.mockRejectedValueOnce(new Error('carrier-overview 502'));

    await expect(resolveCarrierBalance('5758544')).rejects.toThrow('carrier-overview 502');
  });
});

describe('isPrepayCarrier', () => {
  it('treats Prepay and Deposit as prepaid, LOC and untyped as not', () => {
    expect(isPrepayCarrier({ account_type: 'Prepay' })).toBe(true);
    // 'Deposit' folds into Prepay — same rule as the Billing Ledger's normalizeClientType.
    expect(isPrepayCarrier({ account_type: 'deposit' })).toBe(true);
    // account_type is not always populated; payment_terms carries the same vocabulary.
    expect(isPrepayCarrier({ payment_terms: 'Prepay' })).toBe(true);
    expect(isPrepayCarrier({ account_type: 'LOC' })).toBe(false);
    expect(isPrepayCarrier({})).toBe(false);
  });
});

describe('withPrepayDrawWindow — money code for prepay accounts (feedback #2)', () => {
  const upstream = { eligible: false, available: 0, drawn: 0, moneycode_reasons: ['Fuel', 'Towing'] };

  it('draws a prepay account against its prepaid EFS balance, not the invoice window', async () => {
    crm.getCarrierBalance.mockResolvedValueOnce({ account_type: 'Prepay', efs_balance: 1875.25 });

    await expect(withPrepayDrawWindow('5758544', upstream)).resolves.toEqual({
      eligible: true,
      available: 1875.25,
      drawn: 0,
      moneycode_reasons: ['Fuel', 'Towing'],
      available_source: 'prepay_balance',
    });
  });

  it('leaves an LOC account entirely to servercrm', async () => {
    crm.getCarrierBalance.mockResolvedValueOnce({ account_type: 'LOC', efs_balance: 4210.5 });
    const loc = { eligible: true, available: 500, drawn: 100 };

    await expect(withPrepayDrawWindow('5758544', loc)).resolves.toEqual(loc);
  });

  it('does not read an EFS outage as "no prepaid money"', async () => {
    // efs_balance null + efs_error set = EFS unreachable. Asserting a $0 window we never measured
    // would tell a solvent prepay owner they are broke.
    crm.getCarrierBalance.mockResolvedValueOnce({
      account_type: 'Prepay',
      efs_balance: null,
      efs_error: 'EFS timeout',
    });

    await expect(withPrepayDrawWindow('5758544', upstream)).resolves.toEqual(upstream);
  });

  it('clamps an overdrawn prepay account to zero rather than a negative window', async () => {
    crm.getCarrierBalance.mockResolvedValueOnce({ account_type: 'Prepay', efs_balance: -42 });

    await expect(withPrepayDrawWindow('5758544', upstream)).resolves.toMatchObject({
      available: 0,
      eligible: false,
    });
  });

  it('keeps the upstream window when the balance cannot be resolved at all', async () => {
    crm.getCarrierBalance.mockRejectedValueOnce(new Error('down'));
    crm.getCarrierOverview.mockRejectedValueOnce(new Error('down'));

    await expect(withPrepayDrawWindow('5758544', upstream)).resolves.toEqual(upstream);
  });
});
