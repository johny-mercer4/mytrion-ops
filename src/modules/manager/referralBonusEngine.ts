/**
 * Referral bonus calculation engine — computes one month of bonuses and persists the ledger.
 *
 * Runs on the 1st for the month just ended (see workers/referralBonusCalc.ts), so
 * `mytrion_referral_bonuses` accumulates permanent history rather than being re-derived on demand.
 *
 * Shape of a run:
 *   1. read `Parent_Referrers` + `Child_Referrals` from Zoho (COQL)
 *   2. join child → parent on the REF CODE, not the lookup — `Child_Referrals.Parent_Referrer` is
 *      null across the entire org (verified 2026-07-28); the populated key is the text pair
 *      `Parent_Referrers.ReferrerId` ↔ `Child_Referrals.Referrer_ID`
 *   3. collapse children by `Carrier_ID` so shared volume is counted ONCE (several child records
 *      routinely point at the same carrier; paying per record would multiply the payout)
 *   4. read one month of DWH volume for those carriers
 *   5. apply each child's `Calculation` logic and upsert the resulting rows
 *
 * Every run is bracketed by a `mytrion_referral_calc_runs` row, so a month can be audited and a bad
 * run can be reverted with `deleteForRun`.
 *
 * NOT YET LIVE: `Calculation` is null on every Zoho record today, so a run legitimately computes
 * zero rows. That is reported as `skippedNoCalculation`, not treated as an error — the engine is
 * ready for the moment the picklist is populated.
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
import {
  REFERRAL_BONUS_SPEC_BY_TYPE,
  bonusTypesForCalculation,
  isOneTimeBonusType,
  type ReferralBonusSpec,
} from './referralBonusTypes.js';

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

interface ParentRow {
  id: string;
  referrerId: string;
  name: string | null;
}
interface ChildRow {
  id: string;
  referrerId: string | null;
  name: string | null;
  carrierId: number | null;
  calculation: string | null;
}

const str = (v: unknown): string => (v == null ? '' : String(v).trim());
const strOrNull = (v: unknown): string | null => str(v) || null;

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

async function loadParents(): Promise<Map<string, ParentRow>> {
  const res = await zohoCrm.runCoql(
    'select id, ReferrerId, Name, Company_Name from Parent_Referrers where id is not null limit 0, 2000',
  );
  const byCode = new Map<string, ParentRow>();
  for (const r of res.rows) {
    const code = str(r.ReferrerId);
    if (!code) continue;
    byCode.set(code, {
      id: str(r.id),
      referrerId: code,
      name: strOrNull(r.Name) ?? strOrNull(r.Company_Name),
    });
  }
  return byCode;
}

async function loadChildren(): Promise<ChildRow[]> {
  const res = await zohoCrm.runCoql(
    'select id, Referrer_ID, Name, Company_Name, Carrier_ID, Calculation from Child_Referrals where id is not null limit 0, 2000',
  );
  return res.rows.map((r) => ({
    id: str(r.id),
    referrerId: strOrNull(r.Referrer_ID),
    name: strOrNull(r.Name) ?? strOrNull(r.Company_Name),
    carrierId: carrierIdOf(r.Carrier_ID),
    calculation: strOrNull(r.Calculation),
  }));
}

/** Money as a fixed-2 string — never round-trip a payout through a float. */
function usd(n: number): string {
  return n.toFixed(2);
}

/**
 * The amount for one logic in one month, plus the quantities that justify it.
 *
 * One-time types return null below their threshold: no row is written at all, so the partial unique
 * index never sees a zero-value placeholder it would later have to reconcile against a real award.
 */
function computeAmount(
  spec: ReferralBonusSpec,
  vol: { gallons: number; newCards: number; cumulativeGallons: number },
): { amount: number; qtyGallons: number | null; qtyNewCards: number | null } | null {
  switch (spec.type) {
    case 'gallons_legacy': {
      if (vol.gallons <= 0) return null;
      return { amount: vol.gallons * spec.rateUsd, qtyGallons: vol.gallons, qtyNewCards: null };
    }
    case 'swipes_legacy': {
      if (vol.newCards <= 0) return null;
      return { amount: vol.newCards * spec.rateUsd, qtyGallons: null, qtyNewCards: vol.newCards };
    }
    default: {
      // One-time: award in the month the cumulative threshold is first crossed. The repo's partial
      // unique index is what actually guarantees "once" across re-runs.
      const threshold = spec.thresholdGallons ?? 0;
      if (vol.cumulativeGallons < threshold) return null;
      return { amount: spec.rateUsd, qtyGallons: vol.gallons, qtyNewCards: null };
    }
  }
}

/**
 * Compute + persist one month of referral bonuses.
 *
 * `periodMonth` is 'YYYY-MM-01'. Safe to re-run: the monthly rows upsert in place, and a one-time
 * award that would land in a different month raises loudly rather than double-paying (see the repo).
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
    const [parentsByCode, children] = await Promise.all([loadParents(), loadChildren()]);
    summary.children = children.length;

    // Only children with BOTH a logic and a carrier can be measured.
    const workable = children.filter((c) => {
      if (!c.calculation || bonusTypesForCalculation(c.calculation).length === 0) {
        summary.skippedNoCalculation += 1;
        return false;
      }
      if (c.carrierId == null) {
        summary.unresolved += 1;
        return false;
      }
      return true;
    });

    // Fuel-code sets differ per logic, so fetch volume once per DISTINCT set rather than per child.
    const carrierIds = [...new Set(workable.map((c) => c.carrierId as number))];
    const bySpecKey = new Map<string, Map<number, ReferralCarrierVolume>>();
    const specsInPlay = new Set<ReferralBonusType>();
    for (const c of workable) for (const t of bonusTypesForCalculation(c.calculation)) specsInPlay.add(t);
    for (const type of specsInPlay) {
      const spec = REFERRAL_BONUS_SPEC_BY_TYPE[type];
      const key = [...spec.fuelCodes].sort().join(',');
      if (bySpecKey.has(key)) continue;
      bySpecKey.set(key, await fetchReferralVolume(carrierIds, periodMonth, spec.fuelCodes));
    }

    /**
     * Carrier-level, not record-level. Several `Child_Referrals` legitimately share one carrier; the
     * volume belongs to the CARRIER, so only the first child per (carrier, type) is paid. Sorting by
     * record id keeps that choice deterministic across re-runs — otherwise a re-run could move the
     * award to a sibling record and trip the one-time index.
     */
    const claimed = new Set<string>();
    let total = 0;

    for (const child of [...workable].sort((a, b) => a.id.localeCompare(b.id))) {
      const parent = child.referrerId ? parentsByCode.get(child.referrerId) : undefined;
      for (const type of bonusTypesForCalculation(child.calculation)) {
        const spec = REFERRAL_BONUS_SPEC_BY_TYPE[type];
        const claimKey = `${child.carrierId}:${type}`;
        if (claimed.has(claimKey)) continue;

        const volumes = bySpecKey.get([...spec.fuelCodes].sort().join(','));
        const vol = volumes?.get(child.carrierId as number);
        if (!vol) continue;

        const computed = computeAmount(spec, vol);
        if (!computed) continue;

        // The parent is the payee for three of the four logics; a missing parent means we cannot say
        // who to pay, so the row is not written and the child counts as unresolved.
        if (spec.recipient === 'parent' && !parent) {
          summary.unresolved += 1;
          continue;
        }

        claimed.add(claimKey);
        await referralBonusRepo.upsert(ctx, {
          bonusType: type,
          periodMonth,
          childReferralId: child.id,
          parentReferrerId: parent?.id ?? null,
          childName: child.name,
          parentName: parent?.name ?? null,
          carrierId: child.carrierId,
          resolution: 'carrier_id',
          recipientKind: spec.recipient,
          recipientName: spec.recipient === 'parent' ? (parent?.name ?? null) : child.name,
          qtyGallons: computed.qtyGallons != null ? computed.qtyGallons.toFixed(2) : null,
          qtyNewCards: computed.qtyNewCards,
          cumulativeGallons: isOneTimeBonusType(type) ? vol.cumulativeGallons.toFixed(2) : null,
          rate: spec.rateUsd.toFixed(4),
          amountUsd: usd(computed.amount),
          calcRunId: run.id,
        });
        summary.rowsWritten += 1;
        total += computed.amount;
      }
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
