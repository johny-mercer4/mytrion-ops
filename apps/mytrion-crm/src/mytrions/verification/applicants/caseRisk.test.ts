/**
 * PHASE 9 HAD NO GATE, AND THE PANE SENT THREE FIELDS OF NOTHING.
 *
 * `passReady` never mentioned the phase, so it could be passed with no assessment at all — and Phase 10
 * prices the approval off the recommended limit, which makes that an approval with no basis. The pane
 * also defaulted the tier to `strong` (the most generous factor in policy) and never sent
 * `businessAgeMonths`, `authorityAgeMonths` or `keyRisks`, all three of which the route accepts, the
 * table stores, and the SOP's underwriting summary lists.
 */
import { describe, expect, it } from 'vitest';
import type { VerificationDeskDetail } from '@/api/verificationFlow';
import {
  EMPTY_RISK_MARKS,
  capacityPreview,
  riskCanPass,
  riskInputsFor,
  riskInputsRead,
  riskReadTone,
  tierFromReads,
} from './caseRisk';

const carrierInputs = riskInputsFor('carrier');
const ownerInputs = riskInputsFor('owner_operator');
const allStrong = (type: string) =>
  Object.fromEntries(riskInputsFor(type).map((i) => [i.id, 'strong' as const]));

function detail(over: Record<string, unknown> = {}): VerificationDeskDetail {
  return {
    case: { applicantType: 'carrier', requestedLimit: null },
    banking: { recurringWeeklyIncome: '5000', recurringWeeklyExpenses: '3000', avgWeeklyFuelExpense: '800' },
    credit: { creditScore: 700 },
    policy: {
      strongFactor: 0.8,
      moderateFactor: null,
      weakFactor: null,
      tierPriceable: { strong: true, moderate: false, weak: false },
    },
    risk: null,
    ...over,
  } as unknown as VerificationDeskDetail;
}

describe('the SOP inputs', () => {
  /** "Authority age where applicable" and "Highway data where applicable" mean carrier-only. */
  it('drops the two carrier-only inputs for an owner-operator', () => {
    expect(carrierInputs).toHaveLength(6);
    expect(ownerInputs).toHaveLength(4);
    expect(ownerInputs.map((i) => i.id)).not.toContain('authority_age');
    expect(ownerInputs.map((i) => i.id)).not.toContain('highway');
  });

  it('maps every read onto a styled tone', () => {
    expect(riskReadTone('strong')).toBe('ok');
    expect(riskReadTone('moderate')).toBe('missing');
    expect(riskReadTone('weak')).toBe('inconsistent');
    expect(riskReadTone(undefined)).toBe('unset');
  });

  it('counts only inputs that apply', () => {
    const marks = { inputs: allStrong('carrier'), tier: null };
    expect(riskInputsRead(marks, 'carrier')).toBe(6);
    // The same marks on an owner-operator only count the four that apply to them.
    expect(riskInputsRead(marks, 'owner_operator')).toBe(4);
  });
});

describe('riskCanPass', () => {
  it('refuses an empty assessment', () => {
    expect(riskCanPass(EMPTY_RISK_MARKS, 'carrier')).toBe(false);
  });

  it('refuses a tier with no inputs read', () => {
    expect(riskCanPass({ inputs: {}, tier: 'strong' }, 'carrier')).toBe(false);
  });

  it('refuses inputs read with no tier assigned', () => {
    expect(riskCanPass({ inputs: allStrong('carrier'), tier: null }, 'carrier')).toBe(false);
  });

  it('passes on every applicable input read plus a tier', () => {
    expect(riskCanPass({ inputs: allStrong('carrier'), tier: 'strong' }, 'carrier')).toBe(true);
  });

  /**
   * A TIER WITH NO FACTOR STILL PASSES. The SOP leaves moderate and weak "subject to approved policy",
   * so requiring a recommended limit would make those two tiers unreachable on this desk.
   */
  it('passes a tier whose factor policy has not set', () => {
    expect(riskCanPass({ inputs: allStrong('carrier'), tier: 'weak' }, 'carrier')).toBe(true);
  });

  it('does not demand the carrier-only inputs from an owner-operator', () => {
    expect(riskCanPass({ inputs: allStrong('owner_operator'), tier: 'strong' }, 'owner_operator')).toBe(
      true,
    );
  });
});

/** A suggestion only — the SOP has a human assign the tier, and the rule is the conservative one. */
describe('tierFromReads', () => {
  it('is null until every applicable input is read', () => {
    expect(tierFromReads({ inputs: { credit: 'strong' }, tier: null }, 'carrier')).toBeNull();
  });

  it('cannot be better than the weakest input', () => {
    const marks = { inputs: { ...allStrong('carrier'), highway: 'weak' as const }, tier: null };
    expect(tierFromReads(marks, 'carrier')).toBe('weak');
  });

  it('reads moderate when the worst input is moderate', () => {
    const marks = { inputs: { ...allStrong('carrier'), banking: 'moderate' as const }, tier: null };
    expect(tierFromReads(marks, 'carrier')).toBe('moderate');
  });

  it('reads strong only when every input is strong', () => {
    expect(tierFromReads({ inputs: allStrong('carrier'), tier: null }, 'carrier')).toBe('strong');
  });
});

/**
 * THE THREE SOP FORMULAS, mirrored for preview. The server computes the stored answer from the same
 * figures; this is what the reviewer sees before committing to a tier.
 */
describe('capacityPreview', () => {
  it('runs the three steps: income − expenses, plus fuel, times the factor', () => {
    const out = capacityPreview(detail(), 'strong');
    expect(out).toMatchObject({
      netCashFlow: 2000, // 5000 − 3000
      adjustedCapacity: 2800, // + 800 fuel added BACK
      riskFactor: 0.8,
      recommendedLimit: 2240, // 2800 × 0.8
    });
  });

  /** The SOP leaves these unset, and the calculator must not guess — no factor, no limit. */
  it('recommends nothing for a tier with no approved factor', () => {
    const out = capacityPreview(detail(), 'weak');
    expect(out?.riskFactor).toBeNull();
    expect(out?.recommendedLimit).toBeNull();
    // The capacity itself is still known — only the pricing is not.
    expect(out?.adjustedCapacity).toBe(2800);
  });

  it('recommends nothing before a tier is chosen', () => {
    expect(capacityPreview(detail(), null)?.recommendedLimit).toBeNull();
  });

  /** "Avoid double-counting fuel" — fuel above total expenses means it was entered outside them. */
  it('flags fuel entered outside recurring expenses', () => {
    const bad = detail({
      banking: {
        recurringWeeklyIncome: '5000',
        recurringWeeklyExpenses: '500',
        avgWeeklyFuelExpense: '800',
      },
    });
    expect(capacityPreview(bad, 'strong')?.fuelDoubleCounted).toBe(true);
    expect(capacityPreview(detail(), 'strong')?.fuelDoubleCounted).toBe(false);
  });

  /** A non-positive capacity cannot support a line, and must never emit a negative "limit". */
  it('never recommends a negative limit', () => {
    const negative = detail({
      banking: {
        recurringWeeklyIncome: '1000',
        recurringWeeklyExpenses: '3000',
        avgWeeklyFuelExpense: '400',
      },
    });
    const out = capacityPreview(negative, 'strong');
    expect(out?.adjustedCapacity).toBeLessThan(0);
    expect(out?.recommendedLimit).toBe(0);
  });

  it('is null until the banking review carries all three figures', () => {
    expect(capacityPreview(detail({ banking: { recurringWeeklyIncome: '5000' } }), 'strong')).toBeNull();
    expect(capacityPreview(detail({ banking: null }), 'strong')).toBeNull();
  });
});
