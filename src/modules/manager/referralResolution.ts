import type { ReferralBonusType } from '../../db/schema/index.js';
import { bonusTypesForCalculation } from './referralBonusTypes.js';

export interface ReferralLookup {
  id: string;
  name?: string | null;
}

export interface ReferralParentSource {
  id: string;
  referrerId: string;
  name: string | null;
  calculation: string | null;
  dealId: string | null;
}

export interface ReferralChildSource {
  id: string;
  referrerId: string | null;
  parentLookupId: string | null;
  name: string | null;
  calculation: string | null;
  paid: boolean;
  parentPaid: boolean;
}

export interface ReferralDealSource {
  id: string;
  name: string | null;
  carrierId: number | null;
  parentLookupId: string | null;
  childLookupId: string | null;
}

export interface ResolvedReferralTarget {
  parent: ReferralParentSource;
  child: ReferralChildSource;
  deal: ReferralDealSource;
  carrierId: number;
  calculation: string;
  bonusType: ReferralBonusType;
  alreadyPaidInZoho: boolean;
}

export interface ReferralResolutionResult {
  targets: ResolvedReferralTarget[];
  skippedNoCalculationChildIds: string[];
  unresolvedChildIds: string[];
}

function pushToMap<T>(map: Map<string, T[]>, key: string | null, value: T): void {
  if (!key) return;
  const bucket = map.get(key);
  if (bucket) bucket.push(value);
  else map.set(key, [value]);
}

/**
 * Resolve PDF calculation targets strictly through Zoho relationships:
 *
 * Child Referral -> related Deal -> Deal.Carrier_ID -> MART.
 *
 * The Parent's single Deal_Id and its related-Deals list are accepted only when that parent has one
 * child, because assigning one parent-level Deal across several children would choose the Type 4
 * recipient arbitrarily. The text Carrier_ID fields on the referral modules are deliberately not a
 * fallback: the requested audit chain is the related Deal.
 */
export function resolveReferralTargets(
  parents: readonly ReferralParentSource[],
  children: readonly ReferralChildSource[],
  deals: readonly ReferralDealSource[],
): ReferralResolutionResult {
  const parentById = new Map(parents.map((parent) => [parent.id, parent]));
  const parentByCode = new Map(
    parents.filter((parent) => parent.referrerId).map((parent) => [parent.referrerId, parent]),
  );
  const dealById = new Map(deals.map((deal) => [deal.id, deal]));
  const dealsByChild = new Map<string, ReferralDealSource[]>();
  const dealsByParent = new Map<string, ReferralDealSource[]>();
  for (const deal of deals) {
    pushToMap(dealsByChild, deal.childLookupId, deal);
    pushToMap(dealsByParent, deal.parentLookupId, deal);
  }

  const parentForChild = new Map<string, ReferralParentSource>();
  const childCountByParent = new Map<string, number>();
  for (const child of children) {
    const parent =
      (child.parentLookupId ? parentById.get(child.parentLookupId) : undefined) ??
      (child.referrerId ? parentByCode.get(child.referrerId) : undefined);
    if (!parent) continue;
    parentForChild.set(child.id, parent);
    childCountByParent.set(parent.id, (childCountByParent.get(parent.id) ?? 0) + 1);
  }

  const targets: ResolvedReferralTarget[] = [];
  const skippedNoCalculationChildIds: string[] = [];
  const unresolvedChildIds: string[] = [];
  const claimed = new Set<string>();

  for (const child of [...children].sort((a, b) => a.id.localeCompare(b.id))) {
    const parent = parentForChild.get(child.id);
    const calculation = child.calculation ?? parent?.calculation ?? null;
    const bonusTypes = bonusTypesForCalculation(calculation);
    if (bonusTypes.length === 0) {
      skippedNoCalculationChildIds.push(child.id);
      continue;
    }
    if (!parent) {
      unresolvedChildIds.push(child.id);
      continue;
    }

    let relatedDeals = dealsByChild.get(child.id) ?? [];
    if (relatedDeals.length === 0 && (childCountByParent.get(parent.id) ?? 0) === 1) {
      const directDeal = parent.dealId ? dealById.get(parent.dealId) : undefined;
      relatedDeals = directDeal ? [directDeal] : (dealsByParent.get(parent.id) ?? []);
    }
    const measurable = relatedDeals.filter(
      (deal): deal is ReferralDealSource & { carrierId: number } => deal.carrierId !== null,
    );
    if (measurable.length === 0) {
      unresolvedChildIds.push(child.id);
      continue;
    }

    for (const deal of measurable) {
      for (const bonusType of bonusTypes) {
        // A Deal may appear through both a direct lookup and a related list. One carrier/type under a
        // parent is one economic target, regardless of how many Zoho paths point at it.
        const key = `${parent.id}:${deal.carrierId}:${bonusType}`;
        if (claimed.has(key)) continue;
        claimed.add(key);
        targets.push({
          parent,
          child,
          deal,
          carrierId: deal.carrierId,
          calculation: calculation as string,
          bonusType,
          alreadyPaidInZoho:
            bonusType === 'gallons_parent'
              ? child.parentPaid
              : bonusType === 'gallons_child'
                ? child.paid
                : false,
        });
      }
    }
  }

  return { targets, skippedNoCalculationChildIds, unresolvedChildIds };
}
