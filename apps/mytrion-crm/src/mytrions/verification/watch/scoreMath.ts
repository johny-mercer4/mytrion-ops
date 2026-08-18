/**
 * The score, derived step by step from the numbers the model actually shipped.
 *
 * WHY THIS EXISTS. Mytrion Watch renders a credit score, a band and a list of risk drivers, and a
 * reviewer who has to defend a limit decision on the back of it needs to be able to say HOW the
 * number was reached. Until now the desk showed the output and the drivers but never the arithmetic
 * between them, so the score was something to trust rather than something to check.
 *
 * The scorecard, verbatim from `src/modules/mytrionWatch/scoring.ts`:
 *
 *   logit  = intercept + Σ (woe_f × coef_f)          ← one term per feature
 *   PD     = 1 / (1 + e^−logit)                       ← logistic link
 *   factor = pdo / ln 2                                ← points per doubling of the odds
 *   score  = baseScore − factor·ln(baseOdds) − factor·logit
 *
 * Every input is on the wire (`WatchModel` + `WatchScoreRow`), so nothing here is estimated: this
 * module re-states the server's own arithmetic with the server's own numbers, and
 * `scoreMath.test.ts` checks the re-statement lands on the score the server sent.
 *
 * The sign matters and is the thing people get wrong: the scale is monotonically DECREASING. A
 * positive contribution raises the logit, raises PD, and therefore LOWERS the score.
 */
import type { WatchModel, WatchScoreRow } from '@/api/mytrionWatch';

export interface DerivationStep {
  /** What this line is, in the desk's words. */
  label: string;
  /** The arithmetic, with the real numbers substituted — readable left to right. */
  working: string | null;
  value: string;
  /** `sum` draws a rule above it (a running total); `result` is the answer. */
  kind: 'term' | 'sum' | 'result';
  /** Which way this line pushes the score. Paired with the words, never colour alone. */
  direction: 'worse' | 'better' | 'neutral';
}

function round(value: number, places: number): number {
  const p = 10 ** places;
  return Math.round(value * p) / p;
}

function signed(value: number, places = 3): string {
  const n = round(value, places);
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(places)}`;
}

/** Points per doubling of the odds — the only derived constant in the scorecard. */
export function scoreFactor(model: WatchModel): number {
  return model.pdo / Math.LN2;
}

/**
 * The five lines that take a carrier from the model's baseline to its score.
 *
 * Returns null when the model has not been loaded, because a derivation with a guessed intercept
 * would be worse than no derivation at all.
 */
export function deriveScore(
  score: Pick<WatchScoreRow, 'sumContribution' | 'logit' | 'pdScore' | 'creditScore'>,
  model: WatchModel | null,
): DerivationStep[] | null {
  if (!model) return null;
  const factor = scoreFactor(model);
  const offset = model.baseScore - factor * Math.log(model.baseOdds);

  return [
    {
      label: 'Model baseline',
      working: 'the average carrier before its own behaviour is read',
      value: signed(model.intercept),
      kind: 'term',
      direction: 'neutral',
    },
    {
      label: 'This carrier’s behaviour',
      working: `sum of ${'every measure below'} (weight × bucket)`,
      value: signed(score.sumContribution),
      kind: 'term',
      direction: score.sumContribution > 0 ? 'worse' : score.sumContribution < 0 ? 'better' : 'neutral',
    },
    {
      label: 'Risk index',
      working: `${signed(model.intercept)} ${score.sumContribution >= 0 ? '+' : '−'} ${Math.abs(round(score.sumContribution, 3)).toFixed(3)}`,
      value: signed(score.logit),
      kind: 'sum',
      direction: score.logit > 0 ? 'worse' : 'better',
    },
    {
      label: 'Chance of default',
      working: `1 ÷ (1 + e^${signed(-score.logit)})`,
      value: `${round(score.pdScore * 100, 1).toFixed(1)}%`,
      kind: 'term',
      direction: 'neutral',
    },
    {
      label: 'Credit score',
      // The scaling line with the numbers in it — the step that turns a probability into the 300–850
      // axis the desk actually reads.
      // "anchor" names the offset, because on a carrier whose risk index is near zero the offset
      // and the score are the same number and `487 − 28.85 × −0.010` otherwise reads as a typo.
      working: `anchor ${round(offset, 0)} − ${round(factor, 2)} × ${signed(score.logit)}`,
      value: String(Math.round(score.creditScore)),
      kind: 'result',
      direction: 'neutral',
    },
  ];
}

/**
 * One sentence naming the scale, so the direction is stated and not inferred.
 *
 * `pdo` is "points to double the odds": every `pdo` points the odds of default halve. Saying that
 * out loud is what makes the rest of the panel checkable.
 */
export function scaleSentence(model: WatchModel | null): string | null {
  if (!model) return null;
  return `Every ${model.pdo} points, the odds of default halve. ${model.baseScore} is the anchor, set at ${model.baseOdds}:1 good-to-bad.`;
}

/** Higher risk index = lower score. Stated once, where the arithmetic can be seen. */
export const DIRECTION_NOTE =
  'A positive number raises the risk index, so it LOWERS the score. Negative numbers protect it.';
