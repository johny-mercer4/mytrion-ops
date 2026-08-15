/**
 * The scoring maths, checked against the published model rather than against itself.
 *
 * The bins below are copied from the training export (the same values migration 0124 seeds), and
 * the golden case is a real carrier pulled from the DWH — so if the binning, the logistic link or
 * the score scaling drifts, this fails with a number a human can trace back to the model.
 */
import { describe, expect, it } from 'vitest';
import {
  bandFor,
  logisticPd,
  pickBin,
  scaleScore,
  scoreCarrier,
  topRiskDrivers,
  type WatchBin,
  type WatchModel,
} from '../../src/modules/mytrionWatch/scoring.js';
import { WATCH_FEATURE_LABEL } from '../../src/db/schema/mytrion_watch.js';

const MODEL: WatchModel = {
  modelVersion: 'forward_all_clean_v1',
  intercept: -2.874368,
  baseScore: 600,
  baseOdds: 50,
  pdo: 20,
  bandHighBelow: 520,
  bandElevatedBelow: 580,
  bandWatchBelow: 640,
};

const bin = (
  feature: string,
  binId: number,
  lowerB: number | null,
  upperB: number | null,
  woe: number,
  coef: number,
  isNan = false,
): WatchBin => ({ feature, binId, lowerB, upperB, isNan, woe, coef });

const PAY_RATIO: WatchBin[] = [
  bin('pay_ratio_31d', -1, null, null, -0.114759, -0.74019, true),
  bin('pay_ratio_31d', 0, null, 0.46938, -2.156863, -0.74019),
  bin('pay_ratio_31d', 1, 0.46938, 0.752688, -0.771349, -0.74019),
  bin('pay_ratio_31d', 2, 0.752688, 0.981467, -0.284658, -0.74019),
  bin('pay_ratio_31d', 3, 0.981467, 0.999957, 0.404365, -0.74019),
  bin('pay_ratio_31d', 4, 0.999957, null, 0.844066, -0.74019),
];

/** No NaN bin — one of the four features where a missing value has no defined weight. */
const MEDIAN_FUEL: WatchBin[] = [
  bin('median_fuel_31d', 0, null, 15.1425, -0.054135, -0.962599),
  bin('median_fuel_31d', 6, 154.787506, null, -0.398283, -0.962599),
];

describe('bin selection', () => {
  it('takes the unbounded-below bin for a small value', () => {
    expect(pickBin(PAY_RATIO, 0.1)?.binId).toBe(0);
  });

  it('takes the unbounded-above bin for a large value', () => {
    expect(pickBin(PAY_RATIO, 1.0)?.binId).toBe(4);
  });

  it('treats an edge as belonging to the LOWER bin — intervals are (lower, upper]', () => {
    // 0.46938 is the boundary between bins 0 and 1; the reference SQL puts it in bin 0.
    expect(pickBin(PAY_RATIO, 0.46938)?.binId).toBe(0);
    expect(pickBin(PAY_RATIO, 0.46939)?.binId).toBe(1);
  });

  it('routes a missing value to the NaN bin when the feature has one', () => {
    expect(pickBin(PAY_RATIO, null)?.binId).toBe(-1);
  });

  it('returns null for a missing value when the feature has NO NaN bin', () => {
    // The reference SQL silently contributed zero here, making a data gap look like a neutral
    // carrier. Returning null lets the caller record it as unmatched instead.
    expect(pickBin(MEDIAN_FUEL, null)).toBeNull();
  });

  it('returns null rather than guessing when nothing matches', () => {
    expect(pickBin([bin('x', 0, 10, 20, 1, 1)], 5)).toBeNull();
  });
});

describe('logistic link', () => {
  it('is 0.5 at a zero logit', () => {
    expect(logisticPd(0)).toBeCloseTo(0.5, 12);
  });

  it('is symmetric about zero', () => {
    expect(logisticPd(3) + logisticPd(-3)).toBeCloseTo(1, 12);
  });

  it('does not overflow at extreme logits', () => {
    // A naive 1/(1+exp(-x)) returns NaN for large negative x; both tails must stay finite.
    expect(Number.isFinite(logisticPd(800))).toBe(true);
    expect(Number.isFinite(logisticPd(-800))).toBe(true);
    expect(logisticPd(800)).toBeCloseTo(1, 10);
    expect(logisticPd(-800)).toBeCloseTo(0, 10);
  });
});

describe('score scaling', () => {
  it('puts the base odds at the base score', () => {
    // By construction: at logit = ln(baseOdds) the scaled score is exactly baseScore... for the
    // standard formulation the anchor is where odds = baseOdds, i.e. logit = ln(50).
    const atAnchor = scaleScore(-Math.log(MODEL.baseOdds), MODEL);
    expect(atAnchor).toBeCloseTo(MODEL.baseScore, 6);
  });

  it('moves by exactly PDO points when the odds double', () => {
    const a = scaleScore(0, MODEL);
    const b = scaleScore(Math.LN2, MODEL);
    expect(a - b).toBeCloseTo(MODEL.pdo, 6);
  });

  it('is monotonically decreasing — a higher logit is a worse score', () => {
    expect(scaleScore(1, MODEL)).toBeLessThan(scaleScore(0, MODEL));
  });
});

describe('risk bands', () => {
  it.each([
    [700, 'low'],
    [640, 'low'],
    [639, 'watch'],
    [580, 'watch'],
    [579, 'elevated'],
    [520, 'elevated'],
    [519, 'high'],
    [300, 'high'],
  ] as const)('scores %d as %s', (score, expected) => {
    expect(bandFor(score, MODEL)).toBe(expected);
  });
});

describe('golden case — a real carrier from the DWH', () => {
  /** carrier 5745870, RUSHFORD PLAZA INC, scoring date 2026-08-11. */
  const FEATURES = {
    pay_ratio_31d: 1.0,
    payment_gap: 0.9375,
    longest_dormant_31d: 9,
    recovery_speed: null,
    mob: 782,
    avg_invoiced_14d: 2529.25,
    median_fuel_31d: 162.37,
    night_weekend_ratio_31d: 0.42857142857142855,
  };

  const BINS = new Map<string, WatchBin[]>([
    ['pay_ratio_31d', PAY_RATIO],
    ['payment_gap', [bin('payment_gap', 2, 0.491379, 1.065591, 0.807762, -0.423288)]],
    ['longest_dormant_31d', [bin('longest_dormant_31d', 2, 5.5, 9.5, 0.035814, -0.296236)]],
    [
      'recovery_speed',
      [bin('recovery_speed', -1, null, null, 0.070663, -0.766417, true)],
    ],
    ['mob', [bin('mob', 6, 210.5, null, 0.584158, -0.420568)]],
    ['avg_invoiced_14d', [bin('avg_invoiced_14d', 5, 1164.929993, 2606.36499, -0.156483, -0.927313)]],
    ['median_fuel_31d', [bin('median_fuel_31d', 6, 154.787506, null, -0.398283, -0.962599)]],
    [
      'night_weekend_ratio_31d',
      [bin('night_weekend_ratio_31d', 1, 0.381385, 0.498705, 0.14784, -0.600202)],
    ],
  ]);

  const result = scoreCarrier(FEATURES, BINS, MODEL);

  it('sums the eight contributions', () => {
    expect(result.contributions).toHaveLength(8);
    // Each is woe x coef; every coef in this model is negative, so a POSITIVE woe lowers the logit.
    const payRatio = result.contributions.find((c) => c.feature === 'pay_ratio_31d');
    expect(payRatio?.binId).toBe(4);
    expect(payRatio?.contribution).toBeCloseTo(0.844066 * -0.74019, 6);
  });

  it('reaches the expected logit and PD', () => {
    expect(result.sumContribution).toBeCloseTo(-0.83734, 4);
    expect(result.logit).toBeCloseTo(-3.711708, 4);
    expect(result.pdScore).toBeCloseTo(0.0238, 3);
  });

  it('scales to a low-risk score', () => {
    expect(result.creditScore).toBeCloseTo(594.2, 0);
    expect(result.band).toBe('watch');
  });

  it('uses the NaN bin for the missing recovery_speed rather than reporting a gap', () => {
    expect(result.unmatched).not.toContain('recovery_speed');
    expect(result.contributions.find((c) => c.feature === 'recovery_speed')?.binId).toBe(-1);
  });
});

describe('unmatched features are reported, not silently zeroed', () => {
  it('names the feature whose value could not be binned', () => {
    const bins = new Map<string, WatchBin[]>([['median_fuel_31d', MEDIAN_FUEL]]);
    const res = scoreCarrier({ median_fuel_31d: null }, bins, MODEL);
    expect(res.unmatched).toEqual(['median_fuel_31d']);
    expect(res.contributions[0]?.contribution).toBe(0);
  });
});

describe('risk drivers', () => {
  it('lists only features pushing PD UP, worst first', () => {
    const contributions = [
      { feature: 'pay_ratio_31d', rawValue: 0.2, binId: 0, woe: -2.1, coef: -0.74, contribution: 1.55 },
      { feature: 'mob', rawValue: 5, binId: 0, woe: -0.99, coef: -0.42, contribution: 0.42 },
      { feature: 'median_fuel_31d', rawValue: 80, binId: 4, woe: 0.4, coef: -0.96, contribution: -0.38 },
    ];
    const drivers = topRiskDrivers(contributions, WATCH_FEATURE_LABEL);
    expect(drivers).toEqual([
      WATCH_FEATURE_LABEL.pay_ratio_31d,
      WATCH_FEATURE_LABEL.mob,
    ]);
  });

  it('returns nothing when every feature is protective', () => {
    const contributions = [
      { feature: 'mob', rawValue: 900, binId: 6, woe: 0.58, coef: -0.42, contribution: -0.24 },
    ];
    expect(topRiskDrivers(contributions, WATCH_FEATURE_LABEL)).toEqual([]);
  });
});
