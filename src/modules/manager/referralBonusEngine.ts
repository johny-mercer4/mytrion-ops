/**
 * Referral bonus calculation engine — computes one month of bonuses and persists the ledger.
 *
 * Runs on the 1st for the month just ended (see workers/referralBonusCalc.ts), so
 * `mytrion_referral_bonuses` accumulates permanent history rather than being re-derived on demand.
 *
 * Shape of a run:
 *   1. read `Parent_Referrers`, `Child_Referrals`, and their related `Deals` from Zoho (COQL)
 *   2. resolve child → parent from the lookup first, with the legacy ref-code pair as a fallback
 *   3. resolve Child Referral → related Deal → Deal.Carrier_ID; referral-module carrier text is not
 *      accepted as an audit substitute
 *   4. read one month of DWH volume for those carriers
 *   5. resolve each child's `Calculation` logic PARENT-FIRST (the parent copy is the populated one;
 *      a non-null child value overrides) and upsert the resulting rows
 *
 * Every run is bracketed by a `mytrion_referral_calc_runs` row, so a month can be audited and a bad
 * run can be reverted with `deleteForRun`.
 *
 * `Calculation` is live on the PARENT side as of the 2026-07-28 import (665 of 687 populated: 615
 * 'Swipes (Legacy)', 50 'Gallons (Legacy)'); it remains null on all `Child_Referrals`. A child whose
 * parent has no value is reported as `skippedNoCalculation`, not an error.
 */
import { zohoCrm } from '../../integrations/zohoCrm.js';
import {
  fetchReferralVolume,
  type ReferralCarrierVolume,
} from '../../integrations/dwhReferralVolume.js';
import { logger } from '../../lib/logger.js';
import { referralBonusRepo } from '../../repos/referralBonusRepo.js';
import type { ReferralBonusType } from '../../db/schema/index.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { REFERRAL_BONUS_SPEC_BY_TYPE, isOneTimeBonusType } from './referralBonusTypes.js';
import { computeReferralBonus, isClaimedStatus } from './referralBonusMath.js';
import {
  resolveReferralTargets,
  type ReferralChildSource,
  type ReferralDealSource,
  type ReferralParentSource,
} from './referralResolution.js';

export interface ReferralBonusRunSummary {
  runId: string;
  periodMonth: string;
  /** Child records read from Zoho. */
  children: number;
  /** Children skipped because `Calculation` is unset — expected until BA populates the picklist. */
  skippedNoCalculation: number;
  /** Children skipped because no carrier id could be resolved (nothing to measure volume against). */
  unresolved: number;
  /** Ledger rows written (a child with two logics writes two). */
  rowsWritten: number;
  amountTotalUsd: string;
}

/**
 * Rows per COQL page when loading the referral rosters. Zoho's own max (2000) is the cheapest per row
 * on the tiered credit scale, and these SELECTs are only 5-6 narrow columns, so there is no reason to
 * page smaller here — unlike the card's wide 25-column drain.
 */
const BONUS_COQL_PAGE_SIZE = 2000;

const str = (v: unknown): string => (v == null ? '' : String(v).trim());
const strOrNull = (v: unknown): string | null => str(v) || null;
const bool = (v: unknown): boolean => v === true || String(v).toLowerCase() === 'true';
const lookupId = (v: unknown): string | null => {
  if (!v || typeof v !== 'object' || !('id' in v)) return null;
  return strOrNull((v as { id?: unknown }).id);
};

/** Carrier ids arrive as text in Zoho; only a clean positive integer can join the mart. */
function carrierIdOf(v: unknown): number | null {
  const digits = str(v).replace(/\D+/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** First day of the month `date` falls in, as 'YYYY-MM-DD'. */
export function monthStart(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

/** First day of the month BEFORE `date` — what a run on the 1st should compute. */
export function previousMonthStart(date: Date): string {
  return monthStart(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1)));
}

async function loadParents(): Promise<ReferralParentSource[]> {
  // Drained, not one page: a parent missing from this map earns its referrer NOTHING, so a silent
  // cut-off is a money bug. Parents grew by 680 in a single import on 2026-07-28, and the old
  // hardcoded `limit 0, 2000` had no signal at all for overflow. `id desc` makes the offset paging
  // sound — Created_Time is not a total order in this module (one import shares a timestamp).
  const res = await zohoCrm.runCoqlAll(
    'select id, ReferrerId, Name, Company_Name, Calculation, Deal_Id from Parent_Referrers where id is not null order by id desc',
    { pageSize: BONUS_COQL_PAGE_SIZE },
  );
  if (res.truncated) {
    throw new Error(
      `[referral-bonus] parent referrer drain hit a pagination guard after ${res.rows.length} rows — refusing to calculate on a partial roster`,
    );
  }
  return res.rows.map((r) => ({
    id: str(r.id),
    referrerId: str(r.ReferrerId),
    name: strOrNull(r.Name) ?? strOrNull(r.Company_Name),
    calculation: strOrNull(r.Calculation),
    dealId: lookupId(r.Deal_Id),
  }));
}

async function loadChildren(): Promise<ReferralChildSource[]> {
  // Drained for the same reason as the parents: a child left out of this list is a bonus never paid.
  const res = await zohoCrm.runCoqlAll(
    'select id, Referrer_ID, Name, Company_Name, Calculation, Parent_Referrer, Paid, Parent_Paid from Child_Referrals where id is not null order by id desc',
    { pageSize: BONUS_COQL_PAGE_SIZE },
  );
  if (res.truncated) {
    throw new Error(
      `[referral-bonus] child referral drain hit a pagination guard after ${res.rows.length} rows — refusing to calculate on a partial roster`,
    );
  }
  return res.rows.map((r) => ({
    id: str(r.id),
    referrerId: strOrNull(r.Referrer_ID),
    parentLookupId: lookupId(r.Parent_Referrer),
    name: strOrNull(r.Name) ?? strOrNull(r.Company_Name),
    calculation: strOrNull(r.Calculation),
    paid: bool(r.Paid),
    parentPaid: bool(r.Parent_Paid),
  }));
}

async function loadDeals(): Promise<ReferralDealSource[]> {
  const res = await zohoCrm.runCoqlAll(
    'select id, Deal_Name, Carrier_ID, Parent_Referrer, Child_Referrer from Deals where Parent_Referrer is not null or Child_Referrer is not null order by id desc',
    { pageSize: BONUS_COQL_PAGE_SIZE },
  );
  if (res.truncated) {
    throw new Error(
      `[referral-bonus] related Deal drain hit a pagination guard after ${res.rows.length} rows — refusing to calculate on a partial relationship set`,
    );
  }
  return res.rows.map((r) => ({
    id: str(r.id),
    name: strOrNull(r.Deal_Name),
    carrierId: carrierIdOf(r.Carrier_ID),
    parentLookupId: lookupId(r.Parent_Referrer),
    childLookupId: lookupId(r.Child_Referrer),
  }));
}

/** Money as a fixed-2 string — never round-trip a payout through a float. */
function usd(n: number): string {
  return n.toFixed(2);
}

/**
 * Compute + persist one month of referral bonuses.
 *
 * `periodMonth` is 'YYYY-MM-01'. Safe to re-run: monthly rows upsert in place, while prior one-time
 * claims are skipped before any DWH award is written.
 */
export async function runReferralBonusCalculation(
  ctx: TenantContext,
  opts: { periodMonth: string; trigger?: 'scheduled' | 'manual'; triggeredBy?: string | null },
): Promise<ReferralBonusRunSummary> {
  const periodMonth = opts.periodMonth;
  const run = await referralBonusRepo.startRun(ctx, {
    periodMonth,
    trigger: opts.trigger ?? 'scheduled',
    triggeredBy: opts.triggeredBy ?? null,
  });

  const summary: ReferralBonusRunSummary = {
    runId: run.id,
    periodMonth,
    children: 0,
    skippedNoCalculation: 0,
    unresolved: 0,
    rowsWritten: 0,
    amountTotalUsd: '0.00',
  };

  try {
    const [parents, children, deals, priorClaims] = await Promise.all([
      loadParents(),
      loadChildren(),
      loadDeals(),
      referralBonusRepo.listOneTimeClaims(ctx),
    ]);
    summary.children = children.length;
    const resolution = resolveReferralTargets(parents, children, deals);
    summary.skippedNoCalculation = resolution.skippedNoCalculationChildIds.length;
    summary.unresolved = resolution.unresolvedChildIds.length;

    // Fuel-code sets differ per logic, so fetch volume once per DISTINCT set rather than per child.
    const carrierIds = [...new Set(resolution.targets.map((target) => target.carrierId))];
    const bySpecKey = new Map<string, Map<number, ReferralCarrierVolume>>();
    const specsInPlay = new Set<ReferralBonusType>(
      resolution.targets.map((target) => target.bonusType),
    );
    for (const type of specsInPlay) {
      const spec = REFERRAL_BONUS_SPEC_BY_TYPE[type];
      const key = [...spec.fuelCodes].sort().join(',');
      if (bySpecKey.has(key)) continue;
      bySpecKey.set(key, await fetchReferralVolume(carrierIds, periodMonth, spec.fuelCodes));
    }

    const claimedCarriers = new Set(
      priorClaims
        .filter((claim) => claim.carrierId !== null && isClaimedStatus(claim.status))
        .map((claim) => `${claim.carrierId}:${claim.bonusType}`),
    );
    const claimedChildren = new Set(
      priorClaims
        .filter((claim) => isClaimedStatus(claim.status))
        .map((claim) => `${claim.childReferralId}:${claim.bonusType}`),
    );
    let total = 0;

    for (const target of resolution.targets) {
      const spec = REFERRAL_BONUS_SPEC_BY_TYPE[target.bonusType];
      const carrierClaimKey = `${target.carrierId}:${target.bonusType}`;
      const childClaimKey = `${target.child.id}:${target.bonusType}`;
      if (
        isOneTimeBonusType(target.bonusType) &&
        (claimedCarriers.has(carrierClaimKey) || claimedChildren.has(childClaimKey))
      ) {
        continue;
      }

      const volumes = bySpecKey.get([...spec.fuelCodes].sort().join(','));
      const vol = volumes?.get(target.carrierId);
      if (!vol) continue;

      const computed = computeReferralBonus(spec, vol, target.alreadyPaidInZoho);
      if (computed.payableAmount <= 0) continue;

      const saved = await referralBonusRepo.upsert(ctx, {
        bonusType: target.bonusType,
        periodMonth,
        childReferralId: target.child.id,
        parentReferrerId: target.parent.id,
        childName: target.child.name,
        parentName: target.parent.name,
        carrierId: target.carrierId,
        zohoDealId: target.deal.id,
        resolution: 'deal_lookup',
        recipientKind: spec.recipient,
        recipientName: spec.recipient === 'parent' ? target.parent.name : target.child.name,
        qtyGallons: computed.qtyGallons != null ? computed.qtyGallons.toFixed(2) : null,
        qtyNewCards: computed.qtySwipes,
        cumulativeGallons: isOneTimeBonusType(target.bonusType)
          ? vol.cumulativeGallons.toFixed(2)
          : null,
        rate: spec.rateUsd.toFixed(4),
        amountUsd: usd(computed.payableAmount),
        calcRunId: run.id,
      });
      if (!saved) continue;
      if (isOneTimeBonusType(target.bonusType)) {
        claimedCarriers.add(carrierClaimKey);
        claimedChildren.add(childClaimKey);
      }
      summary.rowsWritten += 1;
      total += computed.payableAmount;
    }

    summary.amountTotalUsd = usd(total);
    await referralBonusRepo.finishRun(ctx, run.id, {
      status: 'succeeded',
      rowsWritten: summary.rowsWritten,
      amountTotalUsd: summary.amountTotalUsd,
      unresolvedCount: summary.unresolved,
    });
    logger.info({ ...summary }, 'referral bonus calculation completed');
    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await referralBonusRepo
      .finishRun(ctx, run.id, { status: 'failed', error: message })
      .catch(() => undefined);
    logger.error({ err: message, periodMonth }, 'referral bonus calculation failed');
    throw err;
  }
}
