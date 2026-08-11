import { describe, expect, it } from 'vitest';
import { overlayCmpCreditOnBilling } from '../../src/modules/sales/cmpClientBilling.js';

const base = {
  billingCycle: 'WEEKLY_MON_SUN',
  billingCycleTag: '1 Billing',
  paymentTerms: 'LOC',
  paymentDay: 'Monday',
  creditLimit: '2000',
  minimumRequiredBalance: '500',
};

describe('overlayCmpCreditOnBilling', () => {
  it('prefers live CMP creditLimit + payment terms and keeps DWH min balance', () => {
    const { billing, creditSource } = overlayCmpCreditOnBilling(base, {
      source: 'cmp',
      credit_limit: 2500,
      payment_terms: 'LOC',
      billing_cycle: 'SEMI_WEEKLY',
      billing_cycle_label: '2 Billing',
      payment_day: 'Tuesday Pays',
    });
    expect(creditSource).toBe('cmp');
    expect(billing.creditLimit).toBe('2500');
    expect(billing.paymentTerms).toBe('LOC');
    expect(billing.billingCycle).toBe('SEMI_WEEKLY');
    expect(billing.billingCycleTag).toBe('2 Billing');
    expect(billing.paymentDay).toBe('Tuesday Pays');
    expect(billing.minimumRequiredBalance).toBe('500');
  });

  it('keeps DWH when CMP payload is missing', () => {
    const { billing, creditSource } = overlayCmpCreditOnBilling(base, null);
    expect(creditSource).toBe('dwh');
    expect(billing).toEqual(base);
  });

  it('labels dwh_fallback honestly while still applying returned values', () => {
    const { billing, creditSource } = overlayCmpCreditOnBilling(base, {
      source: 'dwh_fallback',
      credit_limit: 1800,
      payment_terms: 'Prepay',
    });
    expect(creditSource).toBe('dwh');
    expect(billing.creditLimit).toBe('1800');
    expect(billing.paymentTerms).toBe('Prepay');
  });
});
