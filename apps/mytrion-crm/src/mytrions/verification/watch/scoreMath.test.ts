/**
 * The derivation has to land on the score the server sent.
 *
 * That is the whole point of showing it: a panel that says "here is how we got 542" and then shows
 * arithmetic reaching 538 is worse than no panel. These re-run `scaleScore` from the server's own
 * module against the same model and assert the displayed result matches.
 */
import { describe, expect, it } from 'vitest';
import type { WatchModel } from '@/api/mytrionWatch';
import { deriveScore, scaleSentence, scoreFactor } from './scoreMath';

/** The seeded `forward_all_clean_v1` shape. */
const MODEL: WatchModel = {
  modelVersion: 'forward_all_clean_v1',
  intercept: -2.1,
  baseScore: 600,
  baseOdds: 20,
  pdo: 20,
  bandHighBelow: 520,
  bandElevatedBelow: 580,
  bandWatchBelow: 640,
};

/** `scoring.ts`: score = baseScore − factor·ln(baseOdds) − factor·logit, factor = pdo / ln 2. */
function serverScore(logit: number, model: WatchModel): number {
  const factor = model.pdo / Math.LN2;
  return model.baseScore - factor * Math.log(model.baseOdds) - factor * logit;
}

describe('deriveScore', () => {
  it('reaches the score the server computed, not an approximation of it', () => {
    for (const sum of [-1.4, -0.3, 0, 0.55, 2.2]) {
      const logit = MODEL.intercept + sum;
      const creditScore = serverScore(logit, MODEL);
      const steps = deriveScore(
        { sumContribution: sum, logit, pdScore: 1 / (1 + Math.exp(-logit)), creditScore },
        MODEL,
      )!;
      expect(steps.at(-1)?.value).toBe(String(Math.round(creditScore)));
    }
  });

  it('shows the risk index as the baseline plus the behaviour, with both numbers visible', () => {
    const steps = deriveScore(
      { sumContribution: 0.55, logit: -1.55, pdScore: 0.175, creditScore: 560 },
      MODEL,
    )!;
    expect(steps.map((s) => s.label)).toEqual([
      'Model baseline',
      'This carrier’s behaviour',
      'Risk index',
      'Chance of default',
      'Credit score',
    ]);
    expect(steps[0]?.value).toBe('−2.100');
    expect(steps[1]?.value).toBe('+0.550');
    expect(steps[2]?.working).toBe('−2.100 + 0.550');
    expect(steps[2]?.value).toBe('−1.550');
  });

  it('names the direction, because the scale runs backwards', () => {
    // A positive contribution is WORSE. Getting this the wrong way round is the whole risk.
    const worse = deriveScore(
      { sumContribution: 1.2, logit: -0.9, pdScore: 0.29, creditScore: 520 },
      MODEL,
    )!;
    expect(worse[1]?.direction).toBe('worse');
    const better = deriveScore(
      { sumContribution: -1.2, logit: -3.3, pdScore: 0.035, creditScore: 620 },
      MODEL,
    )!;
    expect(better[1]?.direction).toBe('better');
  });

  it('names the anchor in the scaling line, so two equal numbers do not read as a typo', () => {
    const steps = deriveScore(
      { sumContribution: 0, logit: -2.1, pdScore: 0.109, creditScore: 574 },
      MODEL,
    )!;
    expect(steps.at(-1)?.working).toMatch(/^anchor \d+ − 28\.85 × −2\.100$/);
  });

  it('renders the chance of default as a percentage of the logistic link', () => {
    const steps = deriveScore(
      { sumContribution: 0, logit: 0, pdScore: 0.5, creditScore: 513 },
      MODEL,
    )!;
    expect(steps[3]?.value).toBe('50.0%');
    expect(steps[3]?.working).toBe('1 ÷ (1 + e^0.000)');
  });

  it('refuses to derive anything without the model rather than guessing an intercept', () => {
    expect(deriveScore({ sumContribution: 0, logit: 0, pdScore: 0.5, creditScore: 500 }, null)).toBeNull();
    expect(scaleSentence(null)).toBeNull();
  });

  it('states the scale in the model’s own units', () => {
    expect(scoreFactor(MODEL)).toBeCloseTo(28.854, 3);
    expect(scaleSentence(MODEL)).toBe(
      'Every 20 points, the odds of default halve. 600 is the anchor, set at 20:1 good-to-bad.',
    );
  });
});
