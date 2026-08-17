/**
 * `filterVerificationClients` / `distinctValues` — the pure logic behind the roster's search and
 * filter chips. Worth testing directly: a wrong predicate here silently hides real carriers from a
 * compliance reviewer, which is a much worse failure than a crash.
 */
import { describe, expect, it } from 'vitest';
import type { VerificationClientRow } from '../../api/verificationClients';
import {
  distinctValues,
  filterVerificationClients,
  filtersAreActive,
  isActiveWithin,
  sortVerificationClients,
  EMPTY_VERIFICATION_FILTERS,
} from './verificationData';
import { hasCreditScore, isCreditworthy, isPrepayTerms } from './verificationFormat';

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
    lastTransactionAt: null,
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

  it('activity windows use lastTransactionAt and exclude carriers with no swipe', () => {
    const now = new Date(2026, 7, 14); // 14 Aug 2026 local
    const rows = [
      row({ carrierId: '1', lastTransactionAt: '2026-08-01' }),
      row({ carrierId: '2', lastTransactionAt: '2026-06-01' }),
      row({ carrierId: '3', lastTransactionAt: null }),
    ];
    expect(filterVerificationClients(rows, { ...EMPTY_VERIFICATION_FILTERS, activity: '30' }, now).map((c) => c.carrierId)).toEqual(['1']);
    expect(filterVerificationClients(rows, { ...EMPTY_VERIFICATION_FILTERS, activity: '90' }, now).map((c) => c.carrierId)).toEqual(['1', '2']);
    expect(filterVerificationClients(rows, { ...EMPTY_VERIFICATION_FILTERS, activity: 'all' }, now)).toHaveLength(3);
  });
});

describe('sortVerificationClients', () => {
  it('default creditworthy sort puts scored non-debtors first, then other clear, then debtors', () => {
    const rows = [
      row({ carrierId: 'd', companyName: 'Debtor Co', isDebtor: true, creditScore: 800 }),
      row({ carrierId: 'u', companyName: 'Unscored Co', isDebtor: false, creditScore: null }),
      row({ carrierId: 'z', companyName: 'Zero Co', isDebtor: false, creditScore: 0 }),
      row({ carrierId: 'b', companyName: 'Beta Scored', isDebtor: false, creditScore: 640 }),
      row({ carrierId: 'a', companyName: 'Alpha Scored', isDebtor: false, creditScore: 810 }),
    ];
    expect(sortVerificationClients(rows, 'creditworthy').map((c) => c.carrierId)).toEqual(['a', 'b', 'u', 'z', 'd']);
  });

  it('name sort is alphabetical and ignores creditworthy rank', () => {
    const rows = [
      row({ carrierId: '2', companyName: 'Zed', isDebtor: false, creditScore: 900 }),
      row({ carrierId: '1', companyName: 'Ann', isDebtor: true, creditScore: null }),
    ];
    expect(sortVerificationClients(rows, 'name').map((c) => c.companyName)).toEqual(['Ann', 'Zed']);
  });
});

describe('activity date math', () => {
  it('treats last-transaction on the cutoff day as in-window', () => {
    const now = new Date(2026, 7, 14);
    expect(isActiveWithin('2026-07-15', 30, now)).toBe(true);
    expect(isActiveWithin('2026-07-14', 30, now)).toBe(false);
    expect(isActiveWithin(null, 30, now)).toBe(false);
  });
});

describe('prepay and score predicates', () => {
  it('treats Prepay case-insensitively and a 0 score as unscored', () => {
    expect(isPrepayTerms('Prepay')).toBe(true);
    expect(isPrepayTerms('prepay')).toBe(true);
    expect(isPrepayTerms('LOC')).toBe(false);
    expect(hasCreditScore(0)).toBe(false);
    expect(hasCreditScore(null)).toBe(false);
    expect(hasCreditScore(640)).toBe(true);
    expect(isCreditworthy({ isDebtor: false, creditScore: 640 })).toBe(true);
    expect(isCreditworthy({ isDebtor: true, creditScore: 640 })).toBe(false);
  });
});

describe('filtersAreActive', () => {
  it('is false for the empty default and true once any chip or search is set', () => {
    expect(filtersAreActive(EMPTY_VERIFICATION_FILTERS)).toBe(false);
    expect(filtersAreActive({ ...EMPTY_VERIFICATION_FILTERS, activity: '30' })).toBe(true);
    expect(filtersAreActive({ ...EMPTY_VERIFICATION_FILTERS, q: 'acme' })).toBe(true);
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
