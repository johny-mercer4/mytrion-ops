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

/** How this target relates to the parent referrer — never inferred from company-name strings. */
export type ReferralTargetRole = 'child' | 'parent_itself';

export interface ResolvedReferralTarget {
  parent: ReferralParentSource;
  child: ReferralChildSource;
  deal: ReferralDealSource;
  carrierId: number;
  calculation: string;
  bonusType: ReferralBonusType;
  alreadyPaidInZoho: boolean;
  /** Child deal carrier vs the parent's own fleet (swipe-legacy rollup only). */
  role: ReferralTargetRole;
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
          role: 'child',
        });
      }
    }
  }

  return { targets, skippedNoCalculationChildIds, unresolvedChildIds };
}

/**
 * Swipe (Legacy) also measures the parent company's own fleet when dim_company has exactly one
 * carrier for that name. Gallons stay on related Deal carriers only — YILKI's 24,916 is the three
 * child deals, not YILKI LLC's own carrier. Billing's Al Aziz 8 is first-use on AL AZIZ EXPRESS INC
 * (5789458) plus Logixpress (5804841).
 */
export function appendSwipeParentCarrierTargets(
  targets: readonly ResolvedReferralTarget[],
  parentCarrierByName: ReadonlyMap<string, number>,
): ResolvedReferralTarget[] {
  if (parentCarrierByName.size === 0) return [...targets];
  const claimed = new Set(
    targets.map((target) => `${target.parent.id}:${target.carrierId}:${target.bonusType}`),
  );
  const extra: ResolvedReferralTarget[] = [];
  for (const target of targets) {
    if (target.bonusType !== 'swipes_legacy' || !target.parent.name) continue;
    const parentCarrierId = parentCarrierByName.get(target.parent.name);
    if (parentCarrierId === undefined) continue;
    const key = `${target.parent.id}:${parentCarrierId}:swipes_legacy`;
    if (claimed.has(key)) continue;
    claimed.add(key);
    extra.push({
      ...target,
      carrierId: parentCarrierId,
      role: 'parent_itself',
      deal: {
        ...target.deal,
        name: target.parent.name,
        carrierId: parentCarrierId,
      },
    });
  }
  return extra.length === 0 ? [...targets] : [...targets, ...extra];
}
