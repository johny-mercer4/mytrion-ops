/**
 * Amount parsing for the billing transactions search (`/billing/transactions/search`). The search
 * used to cover text fields + exact carrier id only, so searching by amount returned nothing;
 * these lock the money-query grammar the repo now recognises. Mirrored client-side in
 * apps/mytrion-crm/src/mytrions/billing/transactionModel.ts (parseTxSearch).
 */
import { describe, expect, it } from 'vitest';

import { parseAmountQuery } from '../../src/repos/paymentTransactionRepo.js';

describe('parseAmountQuery', () => {
  it('accepts cents amounts, plain and currency-formatted', () => {
    expect(parseAmountQuery('1234.56')).toEqual({ value: 1234.56, exact: true });
    expect(parseAmountQuery('$1,234.56')).toEqual({ value: 1234.56, exact: true });
    expect(parseAmountQuery('$ 500.5')).toEqual({ value: 500.5, exact: true });
  });

  it('marks whole-dollar queries inexact (they match the cents range)', () => {
    expect(parseAmountQuery('1234')).toEqual({ value: 1234, exact: false });
    expect(parseAmountQuery('1,234')).toEqual({ value: 1234, exact: false });
  });

  it('rejects anything that is not a money query', () => {
    for (const q of ['', 'acme', 'zl9911', '12.345', '1234.', '-500', '5 00']) {
      expect(parseAmountQuery(q), q).toBeNull();
    }
  });
});
