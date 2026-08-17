/**
 * The roster's presentation rules.
 *
 * Nearly all of these are about the difference between ABSENT and ZERO, which this table is full of:
 * a stored credit score of 0 means "never scored", a prepay carrier has no minimum balance, and a
 * non-LOC carrier has no credit limit. Rendering any of those as a number would put a figure on a
 * credit desk that nobody recorded.
 */
import { describe, expect, it } from 'vitest';
import type { VerificationClientRow } from '@/api/verificationClients';
import {
  activityText,
  addressText,
  inScope,
  limitText,
  minBalanceText,
  money,
  railStyle,
  rowEdge,
  scopeCounts,
  scoreText,
  scoreTone,
  termsIntent,
  termsLabel,
} from './clientsModel';

function client(over: Partial<VerificationClientRow> = {}): VerificationClientRow {
  return {
    carrierId: '5806493',
    companyName: 'Chesapeake Express LLC',
    companyType: 'BANK',
    paymentTerms: 'LOC',
    paymentDay: 'Monday',
    minimumRequiredBalance: 2500,
    billingCycleTag: '1 Billing (Mon-Sun)',
    isDebtor: false,
    billingCycle: 'Mon-Sun',
    creditLimit: 6000,
    creditScore: 812,
    isActive: true,
    lastTransactionAt: '2026-08-11',
    ...over,
  };
}

describe('absent is not zero', () => {
  it('reads a stored credit score of 0 as never scored', () => {
    // dim_company writes 0 for an unscored carrier; rendering it would look like a terrible score.
    expect(scoreText(client({ creditScore: 0 }))).toBe('—');
    expect(scoreTone(client({ creditScore: 0 }))).toBe('none');
    expect(scoreText(client({ creditScore: null }))).toBe('—');
    expect(scoreText(client({ creditScore: 812 }))).toBe('812');
  });

  it('has no minimum balance on prepay, where there is no balance to hold', () => {
    expect(minBalanceText(client({ paymentTerms: 'Prepay' }))).toBe('—');
    expect(minBalanceText(client({ paymentTerms: 'LOC' }))).toBe('$2,500');
    // A real zero minimum on non-prepay terms IS a figure and must render.
    expect(minBalanceText(client({ minimumRequiredBalance: 0 }))).toBe('$0');
  });

  it('has no credit limit unless the carrier is on a line of credit', () => {
    expect(limitText(client({ paymentTerms: 'Prepay' }))).toBe('—');
    expect(limitText(client({ paymentTerms: '' }))).toBe('—');
    expect(limitText(client({ paymentTerms: 'LOC' }))).toBe('$6,000');
  });

  it('says Never rather than a dash when a carrier has not swiped', () => {
    expect(activityText(null)).toBe('Never');
    expect(activityText('2026-08-11')).toMatch(/11/);
  });

  it('renders money without a country prefix', () => {
    expect(money(412_000)).toBe('$412,000');
    expect(money(null)).toBe('—');
  });
});

describe('address', () => {
  it('does not repeat a city or state the address line already carries', () => {
    // The live shape that produced "3570 e 7th ave, Hialeah, FL, Hialeah, FL".
    expect(
      addressText({ address: '3570 e 7th ave, Hialeah, FL', city: 'Hialeah', state: 'FL' }),
    ).toBe('3570 e 7th ave, Hialeah, FL');
  });

  it('appends what is genuinely missing', () => {
    expect(addressText({ address: '3570 e 7th ave', city: 'Hialeah', state: 'FL' })).toBe(
      '3570 e 7th ave, Hialeah, FL',
    );
    expect(addressText({ address: null, city: 'Hialeah', state: 'FL' })).toBe('Hialeah, FL');
  });

  it('renders an em dash when nothing is on file', () => {
    expect(addressText({ address: null, city: null, state: null })).toBe('—');
    expect(addressText({ address: '  ', city: '', state: null })).toBe('—');
  });
});

describe('score bands', () => {
  it('bands at the cut-points the desk already uses', () => {
    expect(scoreTone(client({ creditScore: 812 }))).toBe('good');
    expect(scoreTone(client({ creditScore: 800 }))).toBe('good');
    expect(scoreTone(client({ creditScore: 780 }))).toBe('plain');
    expect(scoreTone(client({ creditScore: 700 }))).toBe('warn');
  });
});

describe('billing rail', () => {
  it('names the four known rails with their own hue and glyph', () => {
    expect(railStyle('BANK')).toMatchObject({ label: 'Bank', icon: 'account_balance' });
    expect(railStyle('MERCHANT_CARD').label).toBe('Merchant card');
    expect(railStyle('ZELLE').label).toBe('Zelle');
  });

  it('humanises a rail it has not been taught rather than hiding it', () => {
    // A new CMP value must appear in the filter, not vanish from the roster.
    expect(railStyle('WIRE_TRANSFER').label).toBe('Wire transfer');
    expect(railStyle('WIRE_TRANSFER').tone).toBe('var(--tone-slate)');
    expect(railStyle('').label).toBe('Not set');
  });
});

describe('terms', () => {
  it('labels and tones the three states, and never leaves the label blank', () => {
    expect(termsLabel(client({ paymentTerms: '' }))).toBe('Not set');
    expect(termsIntent(client({ paymentTerms: 'LOC' }))).toBe('info');
    expect(termsIntent(client({ paymentTerms: 'Prepay' }))).toBe('warning');
    expect(termsIntent(client({ paymentTerms: '' }))).toBe('neutral');
  });
});

describe('scopes', () => {
  const rows = [
    client({ carrierId: '1' }),
    client({ carrierId: '2', isDebtor: true }),
    client({ carrierId: '3', isActive: false }),
    client({ carrierId: '4', isDebtor: true, isActive: false }),
  ];

  it('counts every scope off the same rows the tabs filter', () => {
    const counts = scopeCounts(rows);
    expect(counts).toEqual({ all: 4, clear: 2, debtors: 2, inactive: 2 });
    for (const scope of ['all', 'clear', 'debtors', 'inactive'] as const) {
      expect(rows.filter((r) => inScope(r, scope))).toHaveLength(counts[scope]);
    }
  });

  it('overlaps deliberately — a debtor can also be inactive', () => {
    // These are not a partition, and the counts must not pretend otherwise.
    expect(inScope(rows[3]!, 'debtors')).toBe(true);
    expect(inScope(rows[3]!, 'inactive')).toBe(true);
    expect(inScope(rows[3]!, 'clear')).toBe(false);
  });

  it('puts the debtor flag ahead of dormancy on the row edge', () => {
    expect(rowEdge(rows[0]!)).toBe('none');
    expect(rowEdge(rows[2]!)).toBe('inactive');
    expect(rowEdge(rows[3]!)).toBe('debtor');
  });
});
