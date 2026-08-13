/**
 * MARKETING'S POPULATION RULE — one predicate, shared by the board and the export.
 *
 * A carrier that transacted nothing in the tier-basis month is not a loyalty prospect; it is a
 * dormant account. Counting it as "No Tier" buries the population this workspace exists to move up
 * the tiers — the roster carries hundreds of them, so the No Tier tile dwarfs every earned tier and
 * the distribution bar says nothing.
 *
 * `basisActiveCards >= 1` is not a definition invented here: it is the loyalty program's own track
 * basis ("≥1 tx in the month that earns the tier"), the same window `resolveTierForRow` scores
 * against. So a carrier Marketing shows as No Tier is exactly one that WAS trading and has not earned
 * a tier.
 *
 * ONLY THE UNTIERED ARE DROPPED. A dormant carrier that still holds a tier keeps its badge and stays
 * in the population — losing an earned tier would hide a churn signal rather than clean up a number.
 *
 * It lives in its own module because the board (`LoyaltyCard`) and the export
 * (`loyaltyExportModel`) both need it and the export must not import a React component to get it. The
 * rule is easy to "simplify" into either of two wrong things — dropping every dormant carrier, or
 * dropping nobody — and both look reasonable in a diff, which is why it is pinned by
 * `marketingNoTier.test.ts`.
 *
 * SALES IS DELIBERATELY UNAFFECTED. `RecordsTab` and `ClientModal` read the shared `tierBucketOf`
 * directly; a rep looking at their own book must still see a dormant client at No Tier — that is the
 * account to call.
 */
import type { TierBucket } from '../../_shared/loyalty';

/**
 * Is this carrier part of the population Marketing scores?
 *
 * `basisActiveCards` is the transacting-card count for the month that earns the tier — the board's
 * `activeCardsPrevMonth`, the export's `basisActiveCards`. `undefined` is NOT evidence of activity:
 * treating an unmeasurable carrier as active would quietly restore the pre-filter behaviour.
 */
export function isMarketingPopulation(
  bucket: TierBucket,
  basisActiveCards: number | undefined,
): boolean {
  if (bucket !== 'idle') return true;
  return (basisActiveCards ?? 0) >= 1;
}
