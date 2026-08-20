/**
 * PHASE 8 HAD NO PANE AND NO GATE. It fell through `PhaseBody`'s switch to the generic recorded-so-far
 * summary, so the phase the SOP gives eleven review items had nothing to review with, "Pass phase" was
 * enabled on a carrier nobody had looked at in Highway, and the underwriting summary's "Highway
 * findings" line — which `buildSummary` has always read off this phase — was blank on every case.
 */
import { describe, expect, it } from 'vitest';
import {
  cardsVsFleet,
  EMPTY_HIGHWAY_MARKS,
  HIGHWAY_CHECKS,
  highwayCanPass,
  highwayRuled,
  highwayTone,
  highwayValuesFrom,
  HIGHWAY_FIELDS,
} from './caseHighway';

const allRuled = Object.fromEntries(HIGHWAY_CHECKS.map((c) => [c.id, 'ok' as const]));

describe('highwayCanPass', () => {
  it('refuses an empty review', () => {
    expect(highwayCanPass(EMPTY_HIGHWAY_MARKS)).toBe(false);
  });

  it('needs every SOP item ruled on, not just the verdict', () => {
    expect(highwayCanPass({ checks: {}, verdict: 'consistent' })).toBe(false);
    const allButOne = { ...allRuled };
    delete allButOne[HIGHWAY_CHECKS[0]!.id];
    expect(highwayCanPass({ checks: allButOne, verdict: 'consistent' })).toBe(false);
  });

  it('passes on every item ruled plus a consistent verdict', () => {
    expect(highwayCanPass({ checks: allRuled, verdict: 'consistent' })).toBe(true);
  });

  /** The SOP's failure branch is Manager Review, so a discrepancy must not pass the phase. */
  it('never passes on a suspicious discrepancy', () => {
    expect(highwayCanPass({ checks: allRuled, verdict: 'discrepancy' })).toBe(false);
  });

  /**
   * `Not shown` does NOT block. Highway genuinely not carrying a figure is a state the reviewer
   * established, and the SOP's failure branch is a suspicious discrepancy — not an absence.
   */
  it('lets a not-shown item pass, because an absence is not a discrepancy', () => {
    const withMissing = { ...allRuled, [HIGHWAY_CHECKS[0]!.id]: 'missing' as const };
    expect(highwayCanPass({ checks: withMissing, verdict: 'consistent' })).toBe(true);
  });

  it('counts only ruled items toward progress', () => {
    expect(highwayRuled(EMPTY_HIGHWAY_MARKS)).toBe(0);
    expect(highwayRuled({ checks: allRuled, verdict: null })).toBe(HIGHWAY_CHECKS.length);
  });
});

/**
 * THE SOP'S CAVEAT, and the thing most likely to be built wrongly: "Fleet size and requested cards are
 * risk indicators, but do not automatically cap the LOC for legitimate non-carrier or financially
 * strong applicants." So this reads, and it must never gate.
 */
describe('cardsVsFleet', () => {
  it('reads cards against the fleet Highway observed', () => {
    const out = cardsVsFleet(12, '4');
    expect(out).toMatchObject({ cards: 12, units: 4, excess: 8 });
    expect(out?.note).toMatch(/more cards than trucks/i);
    expect(out?.note).toMatch(/not a cap/i);
  });

  it('says so plainly when the request sits inside the fleet', () => {
    expect(cardsVsFleet(3, '10')?.excess).toBe(-7);
    expect(cardsVsFleet(3, '10')?.note).toMatch(/within the fleet/i);
  });

  /** A ratio against an unrecorded fleet is not a finding, so there is nothing to show. */
  it('is null until both sides are known', () => {
    expect(cardsVsFleet(null, '4')).toBeNull();
    expect(cardsVsFleet(12, '')).toBeNull();
    expect(cardsVsFleet(12, undefined)).toBeNull();
  });

  it('takes no part in the pass gate', () => {
    // Ten cards against one truck, every item ruled, consistent — still passes. That is the SOP.
    expect(highwayCanPass({ checks: allRuled, verdict: 'consistent' })).toBe(true);
  });
});

describe('seeding and tones', () => {
  it('renders an absent figure as an empty field rather than 0', () => {
    const values = highwayValuesFrom({ observedPowerUnits: 4, connectedTrucks: null });
    expect(values.observedPowerUnits).toBe('4');
    expect(values.connectedTrucks).toBe('');
  });

  it('seeds every field from an absent review', () => {
    const values = highwayValuesFrom(null);
    expect(Object.keys(values)).toHaveLength(HIGHWAY_FIELDS.length);
    expect(Object.values(values).every((v) => v === '')).toBe(true);
  });

  /** Only the three tones `.va-id-check[data-mark]` styles — an unlisted value renders no edge. */
  it('maps every mark onto a styled tone', () => {
    expect(highwayTone('ok')).toBe('ok');
    expect(highwayTone('concern')).toBe('inconsistent');
    expect(highwayTone('missing')).toBe('missing');
    expect(highwayTone(undefined)).toBe('unset');
  });
});
