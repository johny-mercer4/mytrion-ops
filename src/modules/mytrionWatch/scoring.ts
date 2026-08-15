/**
 * The scoring maths for Mytrion Watch — pure, so it can be proved against the reference SQL.
 *
 * Model: logistic regression on Weight-of-Evidence bins (`forward_all_clean_v1`).
 *
 *   contribution_f = woe(bin(x_f)) * coef_f
 *   logit          = intercept + Σ contribution_f
 *   PD             = 1 / (1 + e^-logit)
 *   score          = baseScore - factor*ln(baseOdds) - factor*logit,  factor = pdo / ln 2
 *
 * TWO THINGS HERE ARE DELIBERATELY NOT "TIDIED", because the model was trained with them and
 * changing either would silently invalidate every bin boundary:
 *
 *   1. `night_weekend_ratio_31d` DOUBLE-COUNTS a night-time weekend transaction — it appears in
 *      both the night term and the weekend term, so the ratio ranges over [0, 2], not [0, 1]. The
 *      published bins top out at 0.816986, which only makes sense on that scale. See featureSql.ts.
 *   2. Bin edges are half-open as `(lower, upper]` with the first bin unbounded below — the same
 *      comparison the reference SQL makes.
 */

/** A single model bin. `lowerB` null = -inf, `upperB` null = +inf. */
export interface WatchBin {
  feature: string;
  binId: number;
  lowerB: number | null;
  upperB: number | null;
  isNan: boolean;
  woe: number;
  coef: number;
}

export interface WatchModel {
  modelVersion: string;
  intercept: number;
  baseScore: number;
  baseOdds: number;
  pdo: number;
  bandHighBelow: number;
  bandElevatedBelow: number;
  bandWatchBelow: number;
}

export interface FeatureContribution {
  feature: string;
  rawValue: number | null;
  binId: number;
  woe: number;
  coef: number;
  contribution: number;
}

export interface ScoreResult {
  sumContribution: number;
  logit: number;
  pdScore: number;
  creditScore: number;
  band: 'low' | 'watch' | 'elevated' | 'high';
  contributions: FeatureContribution[];
  /** Features whose bin was not found in the model — a silent zero would hide a real gap. */
  unmatched: string[];
}

/**
 * Pick the bin for a raw value.
 *
 * A NULL value takes the feature's `is_nan` bin. FOUR of the eight features have no such bin
 * (`longest_dormant_31d`, `mob`, `median_fuel_31d`, `night_weekend_ratio_31d`) — for those a NULL
 * has no defined weight, and the reference SQL silently contributed zero. We return `null` instead
 * so the caller can record it as unmatched rather than pretend the feature was neutral.
 */
export function pickBin(bins: readonly WatchBin[], rawValue: number | null): WatchBin | null {
  if (rawValue === null || !Number.isFinite(rawValue)) {
    return bins.find((b) => b.isNan) ?? null;
  }
  // Half-open (lower, upper], first bin unbounded below — matches the reference SQL's comparison,
  // and `bin_id` order is what disambiguates a value sitting exactly on a shared edge.
  const ordered = bins.filter((b) => !b.isNan).sort((a, b) => a.binId - b.binId);
  for (const bin of ordered) {
    const aboveLower = bin.lowerB === null || rawValue > bin.lowerB;
    const withinUpper = bin.upperB === null || rawValue <= bin.upperB;
    if (aboveLower && withinUpper) return bin;
  }
  return null;
}

/** Scale a logit onto the credit-score axis. Monotonically DECREASING: higher logit = worse. */
export function scaleScore(logit: number, model: WatchModel): number {
  const factor = model.pdo / Math.LN2;
  const offset = model.baseScore - factor * Math.log(model.baseOdds);
  return offset - factor * logit;
}

export function bandFor(creditScore: number, model: WatchModel): ScoreResult['band'] {
  if (creditScore < model.bandHighBelow) return 'high';
  if (creditScore < model.bandElevatedBelow) return 'elevated';
  if (creditScore < model.bandWatchBelow) return 'watch';
  return 'low';
}

/** Logistic link. Guarded at the extremes so a large |logit| cannot produce NaN. */
export function logisticPd(logit: number): number {
  if (logit >= 0) {
    const z = Math.exp(-logit);
    return 1 / (1 + z);
  }
  const z = Math.exp(logit);
  return z / (1 + z);
}

/**
 * Score one carrier.
 *
 * `features` maps feature name → raw value (null when the feature could not be computed).
 * Contributions are returned for every feature so the desk can explain the number without
 * re-querying the warehouse.
 */
export function scoreCarrier(
  features: Readonly<Record<string, number | null>>,
  binsByFeature: ReadonlyMap<string, readonly WatchBin[]>,
  model: WatchModel,
): ScoreResult {
  const contributions: FeatureContribution[] = [];
  const unmatched: string[] = [];

  for (const [feature, bins] of binsByFeature) {
    const rawValue = features[feature] ?? null;
    const bin = pickBin(bins, rawValue);

    if (!bin) {
      // No defined weight. Contribute nothing, but SAY SO — the reference SQL's COALESCE(woe, 0)
      // made a missing feature indistinguishable from a genuinely neutral one.
      unmatched.push(feature);
      contributions.push({
        feature,
        rawValue,
        binId: -1,
        woe: 0,
        coef: bins[0]?.coef ?? 0,
        contribution: 0,
      });
      continue;
    }

    contributions.push({
      feature,
      rawValue,
      binId: bin.binId,
      woe: bin.woe,
      coef: bin.coef,
      contribution: bin.woe * bin.coef,
    });
  }

  const sumContribution = contributions.reduce((acc, c) => acc + c.contribution, 0);
  const logit = sumContribution + model.intercept;
  const pdScore = logisticPd(logit);
  const creditScore = scaleScore(logit, model);

  return {
    sumContribution,
    logit,
    pdScore,
    creditScore,
    band: bandFor(creditScore, model),
    contributions,
    unmatched,
  };
}

/**
 * The features pushing PD UP, worst first.
 *
 * A POSITIVE contribution raises the logit and therefore the probability of default. Every coef in
 * this model is negative, so a positive contribution means a negative WoE — the bin the carrier
 * landed in is worse than the population average.
 */
export function topRiskDrivers(
  contributions: readonly FeatureContribution[],
  labels: Readonly<Record<string, string>>,
  limit = 3,
): string[] {
  return contributions
    .filter((c) => c.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, limit)
    .map((c) => labels[c.feature] ?? c.feature);
}
