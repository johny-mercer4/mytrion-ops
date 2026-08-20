import { describe, expect, it } from 'vitest';
import {
  BANKING_CHECKS,
  BANKING_FIELDS,
  bankingValuesFrom,
  CREDIT_FIELDS,
  creditBankingCanPass,
  creditValuesFrom,
  filledCount,
  parseReviewField,
  reviewBody,
  weeklyNetCashFlow,
  creditPhaseOutcome,
  creditSidePass,
  missingBankingDocs,
} from './caseCreditBanking';

const allOk = Object.fromEntries(BANKING_CHECKS.map((c) => [c.id, 'ok' as const]));

describe('creditBankingCanPass', () => {
  it('passes only on strong/acceptable credit and no open missing banking rows', () => {
    expect(creditSidePass('strong')).toBe(true);
    expect(creditSidePass('acceptable')).toBe(true);
    expect(creditSidePass('borderline')).toBe(false);
    expect(creditSidePass('unacceptable')).toBe(false);
    expect(creditBankingCanPass({ credit: 'strong', banking: allOk })).toBe(true);
    expect(creditBankingCanPass({ credit: 'acceptable', banking: { ...allOk, deposits: 'concern' } })).toBe(
      true,
    );
    expect(creditBankingCanPass({ credit: 'strong', banking: { ...allOk, deposits: 'missing' } })).toBe(
      false,
    );
    expect(creditBankingCanPass({ credit: 'borderline', banking: allOk })).toBe(false);
    expect(creditBankingCanPass({ credit: 'unacceptable', banking: allOk })).toBe(false);
  });

  it('maps missing banking rows onto a bank-statement request', () => {
    expect(missingBankingDocs({ ownership: 'missing' })).toEqual([
      { docType: 'bank_statement', label: 'Bank statements (last 3 months)' },
    ]);
    expect(missingBankingDocs(allOk)).toEqual([]);
  });

  it('routes borderline to manager and unacceptable to deposit/prepaid', () => {
    expect(creditPhaseOutcome('borderline')).toBe('manager_review');
    expect(creditPhaseOutcome('unacceptable')).toBe('deposit_prepaid');
    expect(creditPhaseOutcome('strong')).toBeNull();
  });
});

/**
 * THE FIELDS, which did not exist before. Phase 6 held thirteen marks in React state and a dead
 * bullet list, while `verification_credit_reviews` / `verification_banking_reviews` carried a typed
 * column for every SOP line and Phase 7 / Phase 9 read them. These pin the parse rules, because a
 * number silently dropped on save is worse than a rejected form — the reviewer would believe it saved.
 */
describe('review field parsing', () => {
  it('reads a blank field as CLEARED, never as zero', () => {
    expect(parseReviewField('money', '')).toBeNull();
    expect(parseReviewField('count', '   ')).toBeNull();
    // A recorded zero is a real answer and must survive.
    expect(parseReviewField('count', '0')).toBe(0);
    expect(parseReviewField('money', '0')).toBe(0);
  });

  it('accepts money the way a reviewer types it, commas and dollar sign included', () => {
    expect(parseReviewField('money', '$12,500.50')).toBe(12500.5);
    expect(parseReviewField('money', ' 1 200 ')).toBe(1200);
  });

  /** Negative cash flow is the value Phase 7 exists for, so a minus sign must not be refused. */
  it('accepts a negative money value', () => {
    expect(parseReviewField('money', '-420.75')).toBe(-420.75);
  });

  it('refuses a fractional or negative count rather than rounding one', () => {
    expect(parseReviewField('count', '2.5')).toBeUndefined();
    expect(parseReviewField('count', '-1')).toBeUndefined();
    expect(parseReviewField('score', '700')).toBe(700);
  });

  it('refuses text, so it can be reported rather than sent as NaN', () => {
    expect(parseReviewField('money', 'about ten grand')).toBeUndefined();
  });

  /**
   * ONE BAD CELL MUST NOT COST THE FORM. The route validates the whole body, so sending NaN would
   * reject every other field the reviewer had just typed.
   */
  it('drops only the unparseable field and names it', () => {
    const { body, rejected } = reviewBody(CREDIT_FIELDS, {
      creditScore: '710',
      latePayments: 'two',
      collections: '0',
    });
    expect(body.creditScore).toBe(710);
    expect(body.collections).toBe(0);
    expect(body).not.toHaveProperty('latePayments');
    expect(rejected).toEqual(['Late payments']);
  });

  it('does not report a blank field as rejected', () => {
    const { rejected } = reviewBody(CREDIT_FIELDS, { creditScore: '', latePayments: '' });
    expect(rejected).toEqual([]);
  });
});

/**
 * THE PHASE 7 HARD STOP, computed live. The server derives it from exactly these two inputs and
 * refuses it from the client, so the pane showing it is the only way a reviewer learns the verdict
 * before saving.
 */
describe('weeklyNetCashFlow', () => {
  it('subtracts expenses from income', () => {
    expect(weeklyNetCashFlow({ recurringWeeklyIncome: '5000', recurringWeeklyExpenses: '3200' })).toBe(1800);
  });

  it('goes negative, which is the case that matters', () => {
    expect(weeklyNetCashFlow({ recurringWeeklyIncome: '2000', recurringWeeklyExpenses: '2600' })).toBe(-600);
  });

  /** A subtraction with one side blank is NOT a zero — zero would read as "hard stop fires". */
  it('is null until both sides are recorded', () => {
    expect(weeklyNetCashFlow({ recurringWeeklyIncome: '5000' })).toBeNull();
    expect(weeklyNetCashFlow({ recurringWeeklyExpenses: '3200' })).toBeNull();
    expect(weeklyNetCashFlow({})).toBeNull();
  });

  it('is null when either side is not a number, rather than guessing', () => {
    expect(weeklyNetCashFlow({ recurringWeeklyIncome: 'lots', recurringWeeklyExpenses: '10' })).toBeNull();
  });
});

describe('seeding from a stored review', () => {
  it('renders a missing figure as an empty field, not as 0', () => {
    const values = creditValuesFrom({ creditScore: 700, latePayments: null } as never);
    expect(values.creditScore).toBe('700');
    expect(values.latePayments).toBe('');
  });

  it('seeds every field from an absent review without inventing values', () => {
    const values = bankingValuesFrom(null);
    expect(Object.values(values).every((v) => v === '')).toBe(true);
    expect(Object.keys(values)).toHaveLength(BANKING_FIELDS.length);
  });

  it('counts a recorded zero as filled', () => {
    expect(filledCount(CREDIT_FIELDS, { creditScore: '0' })).toBe(1);
    expect(filledCount(CREDIT_FIELDS, { creditScore: '' })).toBe(0);
  });
});
