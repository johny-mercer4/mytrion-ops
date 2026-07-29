/**
 * `filterVerificationClients` / `distinctValues` — the pure logic behind the roster's search and
 * filter chips. Worth testing directly: a wrong predicate here silently hides real carriers from a
 * compliance reviewer, which is a much worse failure than a crash.
 */
import { describe, expect, it } from 'vitest';
import type { VerificationClientRow } from '../../api/verificationClients';
import { distinctValues, filterVerificationClients, EMPTY_VERIFICATION_FILTERS } from './verificationData';

function row(overrides: Partial<VerificationClientRow> = {}): VerificationClientRow {
  return {
    carrierId: '1',
    companyName: 'Acme Trucking',
    companyType: 'DIRECT',
    paymentTerms: 'LOC',
    paymentDay: '15',
    minimumRequiredBalance: 500,
    billingCycleTag: 'Weekly',
    isDebtor: false,
    billingCycle: 'Weekly',
    creditLimit: 25000,
    creditScore: 720,
    isActive: true,
    ...overrides,
  };
}

describe('filterVerificationClients', () => {
  it('matches company name and carrier id, case-insensitively', () => {
    const rows = [row({ carrierId: '1001', companyName: 'Acme Trucking' }), row({ carrierId: '2002', companyName: 'Beta Freight' })];
    expect(filterVerificationClients(rows, { ...EMPTY_VERIFICATION_FILTERS, q: 'acme' })).toHaveLength(1);
    expect(filterVerificationClients(rows, { ...EMPTY_VERIFICATION_FILTERS, q: '2002' })).toHaveLength(1);
    expect(filterVerificationClients(rows, { ...EMPTY_VERIFICATION_FILTERS, q: 'zzz' })).toHaveLength(0);
  });

  it('"none" for payment terms means the field is genuinely blank, not literally the string "none"', () => {
    const rows = [row({ paymentTerms: 'LOC' }), row({ paymentTerms: '' })];
    const none = filterVerificationClients(rows, { ...EMPTY_VERIFICATION_FILTERS, paymentTerms: 'none' });
    expect(none).toHaveLength(1);
    expect(none[0]!.paymentTerms).toBe('');
  });

  it('filters by exact payment terms', () => {
    const rows = [row({ paymentTerms: 'LOC' }), row({ paymentTerms: 'Prepay' })];
    expect(filterVerificationClients(rows, { ...EMPTY_VERIFICATION_FILTERS, paymentTerms: 'LOC' })).toHaveLength(1);
  });

  it('debtor filter: debtors vs clear are mutually exclusive and cover all rows between them', () => {
    const rows = [row({ isDebtor: true }), row({ isDebtor: false })];
    expect(filterVerificationClients(rows, { ...EMPTY_VERIFICATION_FILTERS, debtor: 'debtors' })).toHaveLength(1);
    expect(filterVerificationClients(rows, { ...EMPTY_VERIFICATION_FILTERS, debtor: 'clear' })).toHaveLength(1);
    expect(filterVerificationClients(rows, { ...EMPTY_VERIFICATION_FILTERS, debtor: 'all' })).toHaveLength(2);
  });

  it('company type and billing cycle tag filters', () => {
    const rows = [
      row({ companyType: 'BANK', billingCycleTag: 'Monthly' }),
      row({ companyType: 'DIRECT', billingCycleTag: 'Weekly' }),
    ];
    expect(filterVerificationClients(rows, { ...EMPTY_VERIFICATION_FILTERS, companyType: 'BANK' })).toHaveLength(1);
    expect(
      filterVerificationClients(rows, { ...EMPTY_VERIFICATION_FILTERS, billingCycleTag: 'Weekly' }),
    ).toHaveLength(1);
  });

  it('combines every active filter with AND, not OR', () => {
    const rows = [
      row({ companyType: 'BANK', paymentTerms: 'LOC', isDebtor: true }),
      row({ companyType: 'BANK', paymentTerms: 'Prepay', isDebtor: true }),
      row({ companyType: 'DIRECT', paymentTerms: 'LOC', isDebtor: true }),
    ];
    const result = filterVerificationClients(rows, {
      ...EMPTY_VERIFICATION_FILTERS,
      companyType: 'BANK',
      paymentTerms: 'LOC',
      debtor: 'debtors',
    });
    expect(result).toHaveLength(1);
  });

  it('empty filters return every row', () => {
    const rows = [row(), row({ carrierId: '2' })];
    expect(filterVerificationClients(rows, EMPTY_VERIFICATION_FILTERS)).toHaveLength(2);
  });
});

describe('distinctValues', () => {
  it('derives sorted, deduplicated, non-empty values from the loaded rows', () => {
    const rows = [
      row({ companyType: 'DIRECT' }),
      row({ companyType: 'BANK' }),
      row({ companyType: 'DIRECT' }),
      row({ companyType: '' }),
    ];
    expect(distinctValues(rows, 'companyType')).toEqual(['BANK', 'DIRECT']);
  });

  it('a value that disappears from the data disappears from the chips too — no stale option', () => {
    expect(distinctValues([row({ companyType: 'ZELLE' })], 'companyType')).toEqual(['ZELLE']);
    expect(distinctValues([row({ companyType: 'BANK' })], 'companyType')).toEqual(['BANK']);
  });
});
