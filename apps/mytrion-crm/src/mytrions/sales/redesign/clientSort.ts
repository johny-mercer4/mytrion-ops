import { tierBucketOf, tierBucketRank, type TierResult } from '../../_shared/loyalty';

/** The fields the Clients ordering depends on — a subset of RecordVM, so this stays unit-testable. */
export interface SortableClient {
  name: string;
  owed: number;
  tier: TierResult;
}

/** A client counts as a debtor once they owe at least a dollar (matches the card's "Owed" figure). */
export function isDebtor(c: Pick<SortableClient, 'owed'>): boolean {
  return c.owed >= 1;
}

/**
 * Data Center → Clients ordering: **debtors first, then by tier** (Gold → Silver → Bronze → Building
 * → No cards).
 *
 * Money owed outranks loyalty deliberately: a Gold client who owes nothing needs no action today,
 * whereas any debtor does — so the list opens on the calls that matter. Tier then orders the rest,
 * which is why a Gold debtor still sits above a Bronze debtor.
 *
 * The last two keys exist for stability, not ranking. Bigger books come first so the highest-value
 * call in a rank is on top, and the name breaks any remaining tie — without a total order the grid
 * appears to shuffle itself on every SWR revalidate, since Array.prototype.sort is only guaranteed
 * stable for equal elements, and "equal" here would otherwise cover thousands of rows.
 */
export function compareClients(a: SortableClient, b: SortableClient): number {
  const debt = Number(isDebtor(b)) - Number(isDebtor(a));
  if (debt !== 0) return debt;
  const tier = tierBucketRank(tierBucketOf(b.tier)) - tierBucketRank(tierBucketOf(a.tier));
  if (tier !== 0) return tier;
  const gallons = b.tier.gallons - a.tier.gallons;
  if (gallons !== 0) return gallons;
  return a.name.localeCompare(b.name);
}
