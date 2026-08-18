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
  fetchReferralParentCarriers,
  fetchReferralVolumeSets,
  type ReferralCarrierVolume,
} from '../../integrations/dwhReferralVolume.js';
import { ValidationError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { referralBonusRepo } from '../../repos/referralBonusRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { computeReferralBonus, isClaimedStatus } from './referralBonusMath.js';
import {
  clipReferralMonthWindow,
  enumerateReferralMonths,
  lastDayOfMonth,
  monthStartOf,
  REFERRAL_PERIOD_MAX_DAYS,
  REFERRAL_PERIOD_MAX_MONTHS,
  referralDaySpan,
  referralMonthSpan,
} from './referralPeriodRange.js';
import { REFERRAL_BONUS_SPEC_BY_TYPE, type ReferralBonusSpec } from './referralBonusTypes.js';
import {
  fetchReferralCalculationRecords,
  type ReferralAssociations,
  type ReferralRecordsResult,
} from './referralRecords.js';
import {
  appendSwipeParentCarrierTargets,
  resolveReferralTargets,
  type ReferralChildSource,
  type ReferralDealSource,
  type ReferralParentSource,
  type ReferralTargetRole,
} from './referralResolution.js';

export interface ReferralMonthPreview {
  periodMonth: string;
  periodGallons: number;
  periodSwipes: number;
  cumulativeGallons: number;
  amountUsd: string;
  payableAmountUsd: string;
}

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
  months: ReferralMonthPreview[];
  /** Child deal vs the parent's own fleet. Set by resolution, not by name matching. */
  role: ReferralTargetRole;
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
  periodFrom: string;
  periodTo: string;
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

export function parentSource(row: CrmRow): ReferralParentSource {
  return {
    id: str(row.id),
    referrerId: str(row.ReferrerId),
    name: strOrNull(row.Name) ?? strOrNull(row.Company_Name),
    calculation: strOrNull(row.Calculation),
    dealId: lookupId(row.Deal_Id),
  };
}

export function childSource(row: CrmRow): ReferralChildSource {
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

export function dealSource(row: CrmRow): ReferralDealSource {
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
  window: { from: string; to: string },
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
    window,
  );
}

function emptyVolume(carrierId: number): ReferralCarrierVolume {
  return { carrierId, gallons: 0, swipes: 0, cumulativeGallons: 0 };
}

export interface ReferralPreviewCalculation {
  previews: ReferralCalculationPreview[];
  unresolvedChildIds: string[];
  skippedNoCalculationChildIds: string[];
}

/**
 * Live previews for a parent/child/deal set. Shared by the CRM workspace and the single-referrer
 * mobile read so money rules cannot drift. One MART fetch per overlapping month for that set.
 */
export async function calculateReferralPreviews(
  ctx: TenantContext,
  parentSources: readonly ReferralParentSource[],
  childSources: readonly ReferralChildSource[],
  dealSources: readonly ReferralDealSource[],
  periodFrom: string,
  periodTo: string,
): Promise<ReferralPreviewCalculation> {
  const months = enumerateReferralMonths(periodFrom, periodTo);
  const resolved = resolveReferralTargets(parentSources, childSources, dealSources);
  const [parentCarriers, priorClaims] = await Promise.all([
    fetchReferralParentCarriers(
      resolved.targets
        .filter((target) => target.bonusType === 'swipes_legacy')
        .map((target) => target.parent.name)
        .filter((name): name is string => Boolean(name)),
    ),
    referralBonusRepo.listOneTimeClaims(ctx, periodTo),
  ]);
  const targets = appendSwipeParentCarrierTargets(resolved.targets, parentCarriers);
  const volumeByMonth: Array<Map<string, Map<number, ReferralCarrierVolume>>> = [];
  for (const month of months) {
    volumeByMonth.push(
      await loadVolumeBySpec(targets, month, clipReferralMonthWindow(month, periodFrom, periodTo)),
    );
  }

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
  const previews: ReferralCalculationPreview[] = targets.map((target) => {
    const spec = REFERRAL_BONUS_SPEC_BY_TYPE[target.bonusType];
    const claim =
      claimByCarrierType.get(`${target.carrierId}:${target.bonusType}`) ??
      claimByChildType.get(`${target.child.id}:${target.bonusType}`);
    const claimed = target.alreadyPaidInZoho || claim !== undefined;
    const monthRows = months.map((month, index) => {
      const volume =
        volumeByMonth[index]?.get(specKey(spec))?.get(target.carrierId) ??
        emptyVolume(target.carrierId);
      return { month, volume, calculation: computeReferralBonus(spec, volume, claimed) };
    });
    const last = monthRows[monthRows.length - 1] ?? {
      month: periodTo,
      volume: emptyVolume(target.carrierId),
      calculation: computeReferralBonus(spec, emptyVolume(target.carrierId), claimed),
    };
    const periodGallons = spec.recurring
      ? monthRows.reduce((sum, row) => sum + row.volume.gallons, 0)
      : last.volume.gallons;
    // volume.swipes is already first-use inside that month's clipped window. Summing the
    // selected months is the range payable — a card's first fuel lands in exactly one month.
    const periodSwipes = spec.recurring
      ? monthRows.reduce((sum, row) => sum + row.volume.swipes, 0)
      : last.volume.swipes;
    const amount = spec.recurring
      ? monthRows.reduce((sum, row) => sum + row.calculation.amount, 0)
      : last.calculation.amount;
    const payableAmount = spec.recurring
      ? monthRows.reduce((sum, row) => sum + row.calculation.payableAmount, 0)
      : last.calculation.payableAmount;
    const progressPct = spec.recurring
      ? amount > 0
        ? 100
        : 0
      : last.calculation.progressPct;
    const calcState = spec.recurring
      ? amount > 0
        ? 'earned'
        : 'tracking'
      : last.calculation.state;
    const state =
      target.alreadyPaidInZoho || claim?.status === 'paid'
        ? 'paid'
        : claim
          ? 'earned'
          : calcState;
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
      periodGallons,
      periodSwipes,
      cumulativeGallons: last.volume.cumulativeGallons,
      amountUsd: amount.toFixed(2),
      payableAmountUsd: payableAmount.toFixed(2),
      progressPct,
      state,
      ledgerStatus: claim?.status ?? null,
      role: target.role,
      months: monthRows.map((row) => ({
        periodMonth: row.month,
        periodGallons: row.volume.gallons,
        periodSwipes: row.volume.swipes,
        cumulativeGallons: row.volume.cumulativeGallons,
        amountUsd: spec.recurring
          ? row.calculation.amount.toFixed(2)
          : row.month === last.month
            ? last.calculation.amount.toFixed(2)
            : '0.00',
        payableAmountUsd: spec.recurring
          ? row.calculation.payableAmount.toFixed(2)
          : row.month === last.month
            ? last.calculation.payableAmount.toFixed(2)
            : '0.00',
      })),
    };
  });

  return {
    previews,
    unresolvedChildIds: resolved.unresolvedChildIds,
    skippedNoCalculationChildIds: resolved.skippedNoCalculationChildIds,
  };
}

export function assertReferralPeriod(periodFrom: string, periodTo: string): void {
  const monthSpan = referralMonthSpan(periodFrom, periodTo);
  const daySpan = referralDaySpan(periodFrom, periodTo);
  if (monthSpan <= 0 || daySpan <= 0) {
    throw new ValidationError('period_from must be on or before period_to');
  }
  if (monthSpan > REFERRAL_PERIOD_MAX_MONTHS || daySpan > REFERRAL_PERIOD_MAX_DAYS) {
    throw new ValidationError(
      `Referral range cannot exceed ${REFERRAL_PERIOD_MAX_MONTHS} months or ${REFERRAL_PERIOD_MAX_DAYS} days`,
    );
  }
}

/** Build the complete card + modal payload for an inclusive calendar-day range. Read-only. */
async function computeReferralWorkspace(
  ctx: TenantContext,
  periodFrom: string,
  periodTo: string,
  forceSources: boolean,
): Promise<ReferralWorkspaceResult> {
  assertReferralPeriod(periodFrom, periodTo);
  const records = await fetchReferralCalculationRecords({ force: forceSources });
  const { parents, children, associations } = records;
  const parentSources = parents.rows.map(parentSource);
  const childSources = children.rows.map(childSource);
  const dealSources = associations.deals.rows.map(dealSource);
  const { previews, unresolvedChildIds, skippedNoCalculationChildIds } =
    await calculateReferralPreviews(
      ctx,
      parentSources,
      childSources,
      dealSources,
      periodFrom,
      periodTo,
    );

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
    periodMonth: monthStartOf(periodTo),
    periodFrom,
    periodTo,
    generatedAt: new Date().toISOString(),
    parents,
    children,
    associations,
    previews,
    unresolvedChildIds,
    skippedNoCalculationChildIds,
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

function workspaceKey(ctx: TenantContext, periodFrom: string, periodTo: string): string {
  return `${ctx.tenantId}:${periodFrom}:${periodTo}`;
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
  options: { force?: boolean; periodTo?: string } = {},
): Promise<ReferralWorkspaceResult> {
  const periodFrom = periodMonth;
  const periodTo = options.periodTo ?? lastDayOfMonth(periodMonth);
  const key = workspaceKey(ctx, periodFrom, periodTo);
  const cached = workspaceCache.get(key);
  if (!options.force && cached && cached.expiresAt > Date.now()) return cached.value;

  const running = workspaceInFlight.get(key);
  if (running) return running;

  const computation = computeReferralWorkspace(ctx, periodFrom, periodTo, options.force === true)
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
            periodFrom,
            periodTo,
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

/** Fresh workspace snapshot for this tenant + range, or null when the cache has expired. */
export function peekReferralWorkspace(
  ctx: TenantContext,
  periodFrom: string,
  periodTo: string,
): ReferralWorkspaceResult | null {
  const cached = workspaceCache.get(workspaceKey(ctx, periodFrom, periodTo));
  if (!cached || cached.expiresAt <= Date.now()) return null;
  return cached.value;
}

/** Test/shutdown helper — the cache contains no durable state. */
export function resetReferralWorkspaceCache(): void {
  workspaceCache.clear();
  workspaceInFlight.clear();
}
