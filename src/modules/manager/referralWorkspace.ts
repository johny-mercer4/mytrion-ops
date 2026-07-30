/**
 * Manager Referrals workspace — one read model spanning Zoho relationships, MART volume, and the
 * local one-time-award ledger.
 *
 * The browser receives raw CRM fields for modal-level detail plus server-calculated previews. It
 * never reimplements money rules in React.
 */
import type {
  ReferralBonusRecipient,
  ReferralBonusStatus,
  ReferralBonusType,
} from '../../db/schema/index.js';
import {
  fetchReferralVolumeSets,
  type ReferralCarrierVolume,
} from '../../integrations/dwhReferralVolume.js';
import { logger } from '../../lib/logger.js';
import { referralBonusRepo } from '../../repos/referralBonusRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { computeReferralBonus, isClaimedStatus } from './referralBonusMath.js';
import { REFERRAL_BONUS_SPEC_BY_TYPE, type ReferralBonusSpec } from './referralBonusTypes.js';
import {
  fetchReferralCalculationRecords,
  type ReferralAssociations,
  type ReferralRecordsResult,
} from './referralRecords.js';
import {
  resolveReferralTargets,
  type ReferralChildSource,
  type ReferralDealSource,
  type ReferralParentSource,
} from './referralResolution.js';

export interface ReferralCalculationPreview {
  parentId: string;
  childId: string;
  dealId: string;
  carrierId: number;
  parentName: string | null;
  childName: string | null;
  dealName: string | null;
  calculation: string;
  bonusType: ReferralBonusType;
  label: string;
  recipientKind: ReferralBonusRecipient;
  recipientName: string | null;
  fuelCodes: readonly string[];
  recurring: boolean;
  rateUsd: number;
  thresholdGallons: number | null;
  periodGallons: number;
  periodSwipes: number;
  cumulativeGallons: number;
  amountUsd: string;
  payableAmountUsd: string;
  progressPct: number;
  state: 'tracking' | 'earned' | 'paid';
  ledgerStatus: ReferralBonusStatus | null;
}

export interface ReferralWorkspaceSummary {
  parents: number;
  configuredParents: number;
  children: number;
  relatedDeals: number;
  connectedCarriers: number;
  needsDealLink: number;
  needsCalculation: number;
  earned: number;
  tracking: number;
  paid: number;
  payableAmountUsd: string;
}

export interface ReferralWorkspaceResult {
  periodMonth: string;
  generatedAt: string;
  parents: ReferralRecordsResult;
  children: ReferralRecordsResult;
  associations: ReferralAssociations;
  previews: ReferralCalculationPreview[];
  unresolvedChildIds: string[];
  skippedNoCalculationChildIds: string[];
  summary: ReferralWorkspaceSummary;
}

type CrmRow = Record<string, unknown>;

const str = (value: unknown): string => (value == null ? '' : String(value).trim());
const strOrNull = (value: unknown): string | null => str(value) || null;
const bool = (value: unknown): boolean =>
  value === true || String(value).trim().toLowerCase() === 'true';
const lookupId = (value: unknown): string | null => {
  if (!value || typeof value !== 'object' || !('id' in value)) return null;
  return strOrNull((value as { id?: unknown }).id);
};
const carrierId = (value: unknown): number | null => {
  const raw = str(value);
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

function parentSource(row: CrmRow): ReferralParentSource {
  return {
    id: str(row.id),
    referrerId: str(row.ReferrerId),
    name: strOrNull(row.Name) ?? strOrNull(row.Company_Name),
    calculation: strOrNull(row.Calculation),
    dealId: lookupId(row.Deal_Id),
  };
}

function childSource(row: CrmRow): ReferralChildSource {
  return {
    id: str(row.id),
    referrerId: strOrNull(row.Referrer_ID),
    parentLookupId: lookupId(row.Parent_Referrer),
    name: strOrNull(row.Name) ?? strOrNull(row.Company_Name),
    calculation: strOrNull(row.Calculation),
    paid: bool(row.Paid),
    parentPaid: bool(row.Parent_Paid),
  };
}

function dealSource(row: CrmRow): ReferralDealSource {
  return {
    id: str(row.id),
    name: strOrNull(row.Deal_Name),
    carrierId: carrierId(row.Carrier_ID),
    parentLookupId: lookupId(row.Parent_Referrer),
    childLookupId: lookupId(row.Child_Referrer),
  };
}

function specKey(spec: ReferralBonusSpec): string {
  return [...spec.fuelCodes].sort().join(',');
}

async function loadVolumeBySpec(
  targets: ReturnType<typeof resolveReferralTargets>['targets'],
  periodMonth: string,
): Promise<Map<string, Map<number, ReferralCarrierVolume>>> {
  const carrierIds = [...new Set(targets.map((target) => target.carrierId))];
  const types = new Set(targets.map((target) => target.bonusType));
  const specs = new Map<string, ReferralBonusSpec>();
  for (const type of types) {
    const spec = REFERRAL_BONUS_SPEC_BY_TYPE[type];
    const key = specKey(spec);
    if (!specs.has(key)) specs.set(key, spec);
  }
  return fetchReferralVolumeSets(
    carrierIds,
    periodMonth,
    [...specs.entries()].map(([key, spec]) => ({ key, fuelCodes: spec.fuelCodes })),
  );
}

/** Build the complete card + modal payload for one calendar month. Read-only. */
async function computeReferralWorkspace(
  ctx: TenantContext,
  periodMonth: string,
  forceSources: boolean,
): Promise<ReferralWorkspaceResult> {
  const [records, priorClaims] = await Promise.all([
    fetchReferralCalculationRecords({ force: forceSources }),
    referralBonusRepo.listOneTimeClaims(ctx, periodMonth),
  ]);
  const { parents, children, associations } = records;
  const parentSources = parents.rows.map(parentSource);
  const childSources = children.rows.map(childSource);
  const dealSources = associations.deals.rows.map(dealSource);
  const resolution = resolveReferralTargets(parentSources, childSources, dealSources);
  const volumeBySpec = await loadVolumeBySpec(resolution.targets, periodMonth);

  const claimByCarrierType = new Map(
    priorClaims
      .filter((claim) => claim.carrierId !== null && isClaimedStatus(claim.status))
      .map((claim) => [`${claim.carrierId}:${claim.bonusType}`, claim]),
  );
  const claimByChildType = new Map(
    priorClaims
      .filter((claim) => isClaimedStatus(claim.status))
      .map((claim) => [`${claim.childReferralId}:${claim.bonusType}`, claim]),
  );
  const previews: ReferralCalculationPreview[] = resolution.targets.map((target) => {
    const spec = REFERRAL_BONUS_SPEC_BY_TYPE[target.bonusType];
    const volume = volumeBySpec.get(specKey(spec))?.get(target.carrierId) ?? {
      carrierId: target.carrierId,
      gallons: 0,
      swipes: 0,
      cumulativeGallons: 0,
    };
    const claim =
      claimByCarrierType.get(`${target.carrierId}:${target.bonusType}`) ??
      claimByChildType.get(`${target.child.id}:${target.bonusType}`);
    const claimed = target.alreadyPaidInZoho || claim !== undefined;
    const calculation = computeReferralBonus(spec, volume, claimed);
    const state =
      target.alreadyPaidInZoho || claim?.status === 'paid'
        ? 'paid'
        : claim
          ? 'earned'
          : calculation.state;
    return {
      parentId: target.parent.id,
      childId: target.child.id,
      dealId: target.deal.id,
      carrierId: target.carrierId,
      parentName: target.parent.name,
      childName: target.child.name,
      dealName: target.deal.name,
      calculation: target.calculation,
      bonusType: target.bonusType,
      label: spec.label,
      recipientKind: spec.recipient,
      recipientName: spec.recipient === 'parent' ? target.parent.name : target.child.name,
      fuelCodes: spec.fuelCodes,
      recurring: spec.recurring,
      rateUsd: spec.rateUsd,
      thresholdGallons: spec.thresholdGallons,
      periodGallons: volume.gallons,
      periodSwipes: volume.swipes,
      cumulativeGallons: volume.cumulativeGallons,
      amountUsd: calculation.amount.toFixed(2),
      payableAmountUsd: calculation.payableAmount.toFixed(2),
      progressPct: calculation.progressPct,
      state,
      ledgerStatus: claim?.status ?? null,
    };
  });

  const configuredParents = parentSources.filter(
    (parent) => parent.calculation && parent.calculation !== '-None-',
  ).length;
  const previewParentIds = new Set(previews.map((preview) => preview.parentId));
  const needsRelationship = parentSources.filter(
    (parent) =>
      parent.calculation && parent.calculation !== '-None-' && !previewParentIds.has(parent.id),
  ).length;
  const connectedCarriers = new Set(previews.map((preview) => preview.carrierId)).size;
  const payableAmount = previews.reduce(
    (sum, preview) => sum + Number(preview.payableAmountUsd),
    0,
  );

  return {
    periodMonth,
    generatedAt: new Date().toISOString(),
    parents,
    children,
    associations,
    previews,
    unresolvedChildIds: resolution.unresolvedChildIds,
    skippedNoCalculationChildIds: resolution.skippedNoCalculationChildIds,
    summary: {
      parents: parents.total,
      configuredParents,
      children: children.total,
      relatedDeals: associations.deals.total,
      connectedCarriers,
      needsDealLink: needsRelationship,
      needsCalculation: Math.max(0, parents.total - configuredParents),
      earned: previews.filter((preview) => preview.state === 'earned').length,
      tracking: previews.filter((preview) => preview.state === 'tracking').length,
      paid: previews.filter((preview) => preview.state === 'paid').length,
      payableAmountUsd: payableAmount.toFixed(2),
    },
  };
}

interface ReferralWorkspaceCacheEntry {
  value: ReferralWorkspaceResult;
  expiresAt: number;
  staleUntil: number;
}

const REFERRAL_WORKSPACE_TTL_MS = 5 * 60_000;
const REFERRAL_WORKSPACE_STALE_MS = 30 * 60_000;
const REFERRAL_WORKSPACE_CACHE_MAX = 12;
const workspaceCache = new Map<string, ReferralWorkspaceCacheEntry>();
const workspaceInFlight = new Map<string, Promise<ReferralWorkspaceResult>>();

function workspaceKey(ctx: TenantContext, periodMonth: string): string {
  return `${ctx.tenantId}:${periodMonth}`;
}

function writeWorkspaceCache(key: string, value: ReferralWorkspaceResult): void {
  if (workspaceCache.has(key)) workspaceCache.delete(key);
  const now = Date.now();
  workspaceCache.set(key, {
    value,
    expiresAt: now + REFERRAL_WORKSPACE_TTL_MS,
    staleUntil: now + REFERRAL_WORKSPACE_STALE_MS,
  });
  while (workspaceCache.size > REFERRAL_WORKSPACE_CACHE_MAX) {
    const oldest = workspaceCache.keys().next().value as string | undefined;
    if (!oldest) break;
    workspaceCache.delete(oldest);
  }
}

/**
 * Cached workspace read with in-flight de-duplication and a bounded stale fallback.
 *
 * The Zoho relationship roster changes far less often than managers revisit the screen. Sharing one
 * five-minute calculation turns reloads, React StrictMode, and concurrent managers into an immediate
 * response while `force` still gives the Refresh button a real recompute.
 */
export async function fetchReferralWorkspace(
  ctx: TenantContext,
  periodMonth: string,
  options: { force?: boolean } = {},
): Promise<ReferralWorkspaceResult> {
  const key = workspaceKey(ctx, periodMonth);
  const cached = workspaceCache.get(key);
  if (!options.force && cached && cached.expiresAt > Date.now()) return cached.value;

  const running = workspaceInFlight.get(key);
  if (running) return running;

  const computation = computeReferralWorkspace(ctx, periodMonth, options.force === true)
    .then((value) => {
      writeWorkspaceCache(key, value);
      return value;
    })
    .catch((error: unknown) => {
      if (cached && cached.staleUntil > Date.now()) {
        logger.warn(
          {
            err: error instanceof Error ? error.message : String(error),
            tenantId: ctx.tenantId,
            periodMonth,
          },
          'referral workspace refresh failed — serving recent snapshot',
        );
        return cached.value;
      }
      throw error;
    })
    .finally(() => workspaceInFlight.delete(key));
  workspaceInFlight.set(key, computation);
  return computation;
}

/** Test/shutdown helper — the cache contains no durable state. */
export function resetReferralWorkspaceCache(): void {
  workspaceCache.clear();
  workspaceInFlight.clear();
}
