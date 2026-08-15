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
 * Say why one feature is pushing risk up, reading the direction off the BIN.
 *
 * The obvious implementation — a fixed phrase per feature — is wrong here, and was: these WoE
 * tables are not monotonic. `night_weekend_ratio_31d` is risky in its lowest bin, protective in the
 * next one and risky again two bins later, so "High night and weekend activity" was printed for
 * carriers sitting at the bottom of the range. The bin boundaries are the only honest source of
 * direction, and the NaN bin is not a behaviour at all — it means we have nothing on file.
 */
export function describeDriver(
  c: FeatureContribution,
  bins: readonly WatchBin[],
  nouns: Readonly<Record<string, string>>,
  missing: Readonly<Record<string, string>> = {},
): string {
  const noun = nouns[c.feature] ?? c.feature;
  const bin = bins.find((b) => b.binId === c.binId);
  if (!bin || bin.isNan) return missing[c.feature] ?? `No ${noun} on record`;

  // Unbounded ends are -Infinity / +Infinity, NOT "skip this comparison": treating a null bound as
  // a pass made every bin satisfy `highest`, because the top bin's open end matched everything.
  const real = bins.filter((b) => !b.isNan);
  const lowerOf = (b: WatchBin): number => b.lowerB ?? -Infinity;
  const upperOf = (b: WatchBin): number => b.upperB ?? Infinity;
  const lowest = real.every((b) => lowerOf(b) >= lowerOf(bin));
  const highest = real.every((b) => upperOf(b) <= upperOf(bin));
  // A feature with a single bin is both ends at once, so no direction can honestly be claimed.
  if (lowest && !highest) return `Very low ${noun}`;
  if (highest && !lowest) return `Very high ${noun}`;
  return `${noun.charAt(0).toUpperCase()}${noun.slice(1)} in a higher-risk range`;
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
  binsByFeature: ReadonlyMap<string, WatchBin[]>,
  nouns: Readonly<Record<string, string>>,
  missing: Readonly<Record<string, string>> = {},
  limit = 3,
): string[] {
  return contributions
    .filter((c) => c.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, limit)
    .map((c) => describeDriver(c, binsByFeature.get(c.feature) ?? [], nouns, missing));
}
