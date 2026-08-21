/**
 * The agency fee model, checked against the production figures it was fitted to.
 *
 * These cases are real rows from Zoho `Collection_Cases` on 2026-08-20. If a rate here ever has
 * to change, it should change because someone read a contract — not because a test was loosened.
 */
import { describe, expect, it } from 'vitest';
import {
  CAINE_WEINER_VOLUME_FLOOR_USD,
  agencyFee,
  agencyFeeRate,
  totalDebtWithFee,
} from '../../src/modules/collection/agencyFees.js';

describe('agencyFeeRate', () => {
  it('charges each agency what production shows it charging', () => {
    expect(agencyFeeRate('Trust Altus', 10_000)).toBe(0.15);
    expect(agencyFeeRate('Dustin', 10_000)).toBe(0.2);
    expect(agencyFeeRate('IC system', 10_000)).toBe(0.25);
    expect(agencyFeeRate('Freight Recovery', 10_000)).toBe(0.25);
  });

  it('drops Caine & Weiner to 20% at the volume floor, and not a cent below it', () => {
    expect(CAINE_WEINER_VOLUME_FLOOR_USD).toBe(5_000);
    expect(agencyFeeRate('Caine & Weiner', 4_999.99)).toBe(0.25);
    expect(agencyFeeRate('Caine & Weiner', 5_000)).toBe(0.2);
    expect(agencyFeeRate('Caine & Weiner', 12_058.08)).toBe(0.2);
  });

  it('returns null rather than guessing for an agency with no history', () => {
    // GG&R is in the picklist and has never held a case. A guessed rate gets quoted to a debtor.
    expect(agencyFeeRate('GG&R', 10_000)).toBeNull();
    expect(agencyFeeRate(null, 10_000)).toBeNull();
    expect(agencyFeeRate('', 10_000)).toBeNull();
    expect(agencyFeeRate('Some New Agency', 10_000)).toBeNull();
  });
});

describe('agencyFee', () => {
  it('reproduces real production rows to the cent', () => {
    // [agency, total_debt_amount, Agency_Fee as Zoho stores it]
    const rows: Array<[string, number, number]> = [
      ['Caine & Weiner', 5367.62, 1073.52],
      ['Caine & Weiner', 12058.08, 2411.62],
      ['Caine & Weiner', 1200.73, 300.18],
      ['Caine & Weiner', 4993.24, 1248.31],
      ['Caine & Weiner', 8552.85, 1710.57],
      ['Caine & Weiner', 683.09, 170.77],
    ];
    for (const [agency, debt, expected] of rows) {
      expect(agencyFee(agency, debt), `${agency} on ${debt}`).toBe(expected);
    }
  });

  it('is null when the rate is null, not zero — unknown is not free', () => {
    expect(agencyFee('GG&R', 10_000)).toBeNull();
    expect(agencyFee(null, 10_000)).toBeNull();
  });
});

describe('totalDebtWithFee', () => {
  it('is debt + fee, which is how Zoho reconciles all 338 rows that carry one', () => {
    expect(totalDebtWithFee('Trust Altus', 1_000)).toBe(1_150);
    expect(totalDebtWithFee('Caine & Weiner', 5367.62)).toBe(6441.14);
  });

  it('never inflates the quote with a guessed fee', () => {
    expect(totalDebtWithFee('GG&R', 1_000)).toBe(1_000);
    expect(totalDebtWithFee(null, 1_000)).toBe(1_000);
  });
});
