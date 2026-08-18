/**
 * Single-referrer live calculation for the mobile API.
 *
 * Same money rules as the CRM workspace (first-use swipes, In Station gallons, parent/child
 * milestones). The Zoho relationship graph is the shared 10-minute cache — this path never
 * N+1s Zoho. MART is one fetch per overlapping month for THIS parent's carrier set, unless a
 * fresh workspace snapshot for the same range is already in memory.
 */
import { NotFoundError } from '../../lib/errors.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { bonusTypesForCalculation } from './referralBonusTypes.js';
import { fetchReferralCalculationRecords } from './referralRecords.js';
import type { ReferralTargetRole } from './referralResolution.js';
import {
  assertReferralPeriod,
  calculateReferralPreviews,
  childSource,
  dealSource,
  parentSource,
  peekReferralWorkspace,
  type ReferralCalculationPreview,
} from './referralWorkspace.js';

export interface ReferralLiveActivity {
  kind: 'swipes' | 'gallons';
  label: string;
  value: number;
}

export interface ReferralLiveRow {
  role: ReferralTargetRole;
  name: string | null;
  childId: string;
  childName: string | null;
  dealId: string;
  dealName: string | null;
  carrierId: number;
  bonusAmountUsd: string;
  payableAmountUsd: string;
  periodGallons: number;
  periodSwipes: number;
  cumulativeGallons: number;
  state: ReferralCalculationPreview['state'];
}

export interface ReferralLiveResult {
  referrerId: string;
  periodFrom: string;
  periodTo: string;
  generatedAt: string;
  calculation: string;
  calculationKey: ReferralCalculationPreview['bonusType'] | null;
  bonusAmountUsd: string;
  payableAmountUsd: string;
  recurring: boolean;
  rateUsd: number | null;
  thresholdGallons: number | null;
  activity: ReferralLiveActivity;
  parent: {
    id: string;
    referrerId: string;
    name: string | null;
    company: string | null;
  };
  children: Array<{ id: string; name: string | null; referrerId: string | null }>;
  rows: ReferralLiveRow[];
}

type CrmRow = Record<string, unknown>;

const str = (value: unknown): string => (value == null ? '' : String(value).trim());
const strOrNull = (value: unknown): string | null => str(value) || null;

function findParentRow(rows: readonly CrmRow[], referrerId: string): CrmRow | undefined {
  const needle = referrerId.trim();
  return rows.find((row) => str(row.ReferrerId) === needle);
}

function childBelongsToParent(row: CrmRow, parentId: string, referrerId: string): boolean {
  const child = childSource(row);
  return (
    child.parentLookupId === parentId ||
    (referrerId !== '' && child.referrerId === referrerId)
  );
}

function dealBelongsToParent(row: CrmRow, parentId: string, childIds: ReadonlySet<string>): boolean {
  const deal = dealSource(row);
  return deal.parentLookupId === parentId || Boolean(deal.childLookupId && childIds.has(deal.childLookupId));
}

function liveActivity(
  calculation: string,
  previews: readonly ReferralCalculationPreview[],
): ReferralLiveActivity {
  if (calculation === 'Swipes (Legacy)') {
    return {
      kind: 'swipes',
      label: 'New swipes',
      value: previews.reduce((sum, preview) => sum + preview.periodSwipes, 0),
    };
  }
  if (calculation === 'Gallons (Legacy)') {
    return {
      kind: 'gallons',
      label: 'In Station gallons',
      value: previews.reduce((sum, preview) => sum + preview.periodGallons, 0),
    };
  }
  if (calculation === 'Gallons (Parent)' || calculation === 'Gallons (Child)') {
    return {
      kind: 'gallons',
      label: 'Cumulative gallons',
      value: previews.reduce((sum, preview) => sum + preview.cumulativeGallons, 0),
    };
  }
  return { kind: 'gallons', label: 'Gallons', value: 0 };
}

function toLiveRow(preview: ReferralCalculationPreview): ReferralLiveRow {
  return {
    role: preview.role,
    name: preview.dealName || preview.childName,
    childId: preview.childId,
    childName: preview.childName,
    dealId: preview.dealId,
    dealName: preview.dealName,
    carrierId: preview.carrierId,
    bonusAmountUsd: preview.amountUsd,
    payableAmountUsd: preview.payableAmountUsd,
    periodGallons: preview.periodGallons,
    periodSwipes: preview.periodSwipes,
    cumulativeGallons: preview.cumulativeGallons,
    state: preview.state,
  };
}

function projectLiveResult(
  referrerId: string,
  periodFrom: string,
  periodTo: string,
  generatedAt: string,
  parentRow: CrmRow,
  childRows: readonly CrmRow[],
  previews: readonly ReferralCalculationPreview[],
): ReferralLiveResult {
  const parent = parentSource(parentRow);
  const calculation = parent.calculation && parent.calculation !== '-None-' ? parent.calculation : '';
  const scoped = previews.filter((preview) => preview.parentId === parent.id);
  const first = scoped[0];
  const bonusAmount = scoped.reduce((sum, preview) => sum + Number(preview.amountUsd), 0);
  const payableAmount = scoped.reduce((sum, preview) => sum + Number(preview.payableAmountUsd), 0);
  return {
    referrerId: parent.referrerId || referrerId.trim(),
    periodFrom,
    periodTo,
    generatedAt,
    calculation,
    calculationKey: bonusTypesForCalculation(calculation)[0] ?? null,
    bonusAmountUsd: bonusAmount.toFixed(2),
    payableAmountUsd: payableAmount.toFixed(2),
    recurring: first?.recurring ?? false,
    rateUsd: first?.rateUsd ?? null,
    thresholdGallons: first?.thresholdGallons ?? null,
    activity: liveActivity(calculation, scoped),
    parent: {
      id: parent.id,
      referrerId: parent.referrerId,
      name: parent.name,
      company: strOrNull(parentRow.Company_Name),
    },
    children: childRows.map((row) => {
      const child = childSource(row);
      return { id: child.id, name: child.name, referrerId: child.referrerId };
    }),
    rows: scoped.map(toLiveRow),
  };
}

/** Live bonus for one Zoho ReferrerId over an inclusive calendar-day range. */
export async function fetchReferralLiveByReferrer(
  ctx: TenantContext,
  referrerId: string,
  periodFrom: string,
  periodTo: string,
): Promise<ReferralLiveResult> {
  assertReferralPeriod(periodFrom, periodTo);
  const cached = peekReferralWorkspace(ctx, periodFrom, periodTo);
  if (cached) {
    const parentRow = findParentRow(cached.parents.rows, referrerId);
    if (!parentRow) {
      throw new NotFoundError(`Unknown referrer '${referrerId.trim()}'`);
    }
    const parent = parentSource(parentRow);
    const childRows = cached.children.rows.filter((row) =>
      childBelongsToParent(row, parent.id, parent.referrerId),
    );
    return projectLiveResult(
      referrerId,
      periodFrom,
      periodTo,
      cached.generatedAt,
      parentRow,
      childRows,
      cached.previews,
    );
  }

  const records = await fetchReferralCalculationRecords();
  const parentRow = findParentRow(records.parents.rows, referrerId);
  if (!parentRow) {
    throw new NotFoundError(`Unknown referrer '${referrerId.trim()}'`);
  }
  const parent = parentSource(parentRow);
  const childRows = records.children.rows.filter((row) =>
    childBelongsToParent(row, parent.id, parent.referrerId),
  );
  const childIds = new Set(childRows.map((row) => childSource(row).id));
  const dealRows = records.associations.deals.rows.filter((row) =>
    dealBelongsToParent(row, parent.id, childIds),
  );
  const { previews } = await calculateReferralPreviews(
    ctx,
    [parent],
    childRows.map(childSource),
    dealRows.map(dealSource),
    periodFrom,
    periodTo,
  );
  return projectLiveResult(
    referrerId,
    periodFrom,
    periodTo,
    new Date().toISOString(),
    parentRow,
    childRows,
    previews,
  );
}
