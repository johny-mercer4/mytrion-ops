/**
 * The Array placement queue — what is ready to file, what is blocked, and on which field.
 *
 * This is the half of the Array story the module never had a screen for. `array_reports` is the
 * OUTPUT (what was filed); the work sits in front of it, and two columns that already exist on
 * the snapshot — `excluded_reason` and `validation_errors` — were never rendered anywhere, so a
 * tradeline could drop out of a monthly filing with nothing in the UI to say it had.
 *
 * The join is on `carrier_id`, which is the key both sides already share: `collection_cases` is
 * UNIQUE on it and `array_reports` is UNIQUE on (carrier_id, report_period).
 */
import { and, desc, eq, ilike, inArray, or, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { arrayReports, collectionCases, type CollectionCase } from '../db/schema/collection.js';
import { DESK_POLICY, isAgencyDue } from '../modules/collection/deskPolicy.js';
import type { TenantContext } from '../types/tenantContext.js';
import { canReadCollectionSnapshot } from './collectionAccess.js';
import { normalizePagination } from './util.js';

export const PLACEMENT_SCAN_CAP = 1000;
export const PLACEMENT_MAX_LIMIT = 100;

/** In render order — the dots column reads left to right in exactly this sequence. */
export const METRO2_FIELDS = ['dateOfBirth', 'address', 'mcDot', 'firstDelinquency'] as const;
export type Metro2Field = (typeof METRO2_FIELDS)[number];

export type PlacementState = 'ready' | 'blocked' | 'error' | 'hold' | 'filed';

export interface PlacementRow {
  caseId: string;
  carrierId: string;
  name: string;
  mcDot: string | null;
  remaining: string;
  daysPastDue: number;
  stage: string;
  state: PlacementState;
  /** Present/absent per Metro 2 field, in METRO2_FIELDS order. */
  readiness: Record<Metro2Field, boolean>;
  /** Which fields are missing — the words beside the dots, never the dots alone. */
  missing: Metro2Field[];
  /** Why it cannot go on this file. Null when `state` is 'ready'. */
  blocking: string | null;
  reportPeriod: string | null;
  accountStatus: string | null;
  agencyName: string | null;
  placementDate: string | null;
}

export interface PlacementResult {
  items: PlacementRow[];
  total: number;
  counts: { ready: number; blocked: number; error: number; hold: number; filed: number };
  readyAmount: string;
  scanTruncated: boolean;
}

interface LatestReport {
  reportPeriod: string;
  accountStatus: string | null;
  agencyName: string | null;
  hasAgency: boolean | null;
  dateOfBirth: string | null;
  excludedReason: string | null;
  validationErrors: string | null;
}

function searchClause(term: string | undefined): SQL | undefined {
  const q = term?.trim();
  if (!q) return undefined;
  const like = `%${q}%`;
  return or(
    ilike(collectionCases.displayName, like),
    ilike(collectionCases.debtorCompanyName, like),
    ilike(collectionCases.carrierId, like),
    ilike(collectionCases.debtorMcDot, like),
  );
}

function caseName(row: CollectionCase): string {
  return (
    row.debtorCompanyName?.trim() ||
    row.displayName?.trim() ||
    row.debtorFullName?.trim() ||
    `Carrier ${row.carrierId}`
  );
}

/**
 * Which of the four Metro 2 fields this carrier can supply.
 *
 * Date of birth may come from either side — the Array snapshot carries one the case row does not,
 * which is exactly the `needs_dob_lookup` workflow — so a case is only short of a DOB when
 * NEITHER has it.
 */
export function readinessOf(row: CollectionCase, report: LatestReport | undefined): Record<Metro2Field, boolean> {
  return {
    dateOfBirth: Boolean(row.debtorDateOfBirth ?? report?.dateOfBirth),
    address: Boolean(row.debtorAddress && row.debtorCity && row.debtorState && row.debtorZipCode),
    mcDot: Boolean(row.debtorMcDot),
    firstDelinquency: Boolean(row.firstDelinquentDate),
  };
}

const FIELD_LABEL: Record<Metro2Field, string> = {
  dateOfBirth: 'Date of birth',
  address: 'Address',
  mcDot: 'MC / DOT',
  firstDelinquency: 'Date of first delinquency',
};

/** One line naming the single thing standing in the way, in the operator's words. */
function blockingText(state: PlacementState, missing: Metro2Field[], row: CollectionCase, report: LatestReport | undefined): string | null {
  if (state === 'ready') return null;
  if (state === 'filed') {
    return report?.reportPeriod ? `Filed on the ${report.reportPeriod} file` : 'Already placed';
  }
  if (state === 'error') {
    return report?.validationErrors ?? report?.excludedReason ?? 'Excluded from the last file';
  }
  if (state === 'blocked') {
    return missing.map((f) => FIELD_LABEL[f]).join(' and ') + ' missing';
  }
  const remaining = Number(row.totalDebtAmount);
  if (Number.isFinite(remaining) && remaining < DESK_POLICY.agencyMinRemaining) {
    return `Below the $${DESK_POLICY.agencyMinRemaining.toLocaleString('en-US')} placement floor`;
  }
  const toGo = DESK_POLICY.agencyMinDaysPastDue - row.daysPastDue;
  return `Under ${DESK_POLICY.agencyMinDaysPastDue} days — eligible in ${toGo} day${toGo === 1 ? '' : 's'}`;
}

export const collectionPlacementRepo = {
  async queue(
    ctx: TenantContext,
    filter: { state?: PlacementState | undefined; search?: string | undefined; limit?: number | undefined; offset?: number | undefined } = {},
  ): Promise<PlacementResult> {
    const empty: PlacementResult = {
      items: [],
      total: 0,
      counts: { ready: 0, blocked: 0, error: 0, hold: 0, filed: 0 },
      readyAmount: '0',
      scanTruncated: false,
    };
    if (!canReadCollectionSnapshot(ctx)) return empty;

    const rows = await db
      .select()
      .from(collectionCases)
      .where(and(eq(collectionCases.status, 'open'), searchClause(filter.search)))
      .orderBy(desc(collectionCases.totalDebtAmount), desc(collectionCases.id))
      .limit(PLACEMENT_SCAN_CAP + 1);
    const scanTruncated = rows.length > PLACEMENT_SCAN_CAP;
    const open = scanTruncated ? rows.slice(0, PLACEMENT_SCAN_CAP) : rows;
    if (open.length === 0) return { ...empty, scanTruncated };

    const reports = await latestReports(open.map((r) => r.carrierId));

    const counts = { ready: 0, blocked: 0, error: 0, hold: 0, filed: 0 };
    let readyTotal = 0;
    const items: PlacementRow[] = [];
    for (const row of open) {
      const report = reports.get(row.carrierId);
      const readiness = readinessOf(row, report);
      const missing = METRO2_FIELDS.filter((f) => !readiness[f]);
      const remaining = Number(row.totalDebtAmount);
      const eligible = isAgencyDue({
        daysPastDue: row.daysPastDue,
        remaining: Number.isFinite(remaining) ? remaining : 0,
        stage: row.collectionStage,
      });
      const filed = row.placementDate !== null || report?.hasAgency === true;
      const errored = Boolean(report?.validationErrors ?? report?.excludedReason);

      const state: PlacementState = filed
        ? 'filed'
        : errored
          ? 'error'
          : !eligible
            ? 'hold'
            : missing.length > 0
              ? 'blocked'
              : 'ready';
      counts[state] += 1;
      if (state === 'ready' && Number.isFinite(remaining)) readyTotal += remaining;
      if (filter.state && filter.state !== state) continue;
      items.push({
        caseId: row.id,
        carrierId: row.carrierId,
        name: caseName(row),
        mcDot: row.debtorMcDot,
        remaining: row.totalDebtAmount,
        daysPastDue: row.daysPastDue,
        stage: row.collectionStage,
        state,
        readiness,
        missing: [...missing],
        blocking: blockingText(state, [...missing], row, report),
        reportPeriod: report?.reportPeriod ?? null,
        accountStatus: report?.accountStatus ?? null,
        agencyName: report?.agencyName ?? null,
        placementDate: row.placementDate ? row.placementDate.slice(0, 10) : null,
      });
    }

    // Ready first, then the ones a person can unblock, then everything else — same order as the
    // work itself. Within a state, biggest debt first.
    const rank: Record<PlacementState, number> = { ready: 0, blocked: 1, error: 2, hold: 3, filed: 4 };
    items.sort(
      (a, b) => rank[a.state] - rank[b.state] || Number(b.remaining) - Number(a.remaining),
    );
    const { limit, offset } = normalizePagination(filter, PLACEMENT_MAX_LIMIT);
    return {
      items: items.slice(offset, offset + limit),
      total: items.length,
      counts,
      readyAmount: readyTotal.toFixed(2),
      scanTruncated,
    };
  },

  /** The single carrier's latest filing — the case record's Array panel. */
  async latestForCarrier(ctx: TenantContext, carrierId: string): Promise<LatestReport | null> {
    if (!canReadCollectionSnapshot(ctx)) return null;
    const map = await latestReports([carrierId]);
    return map.get(carrierId) ?? null;
  },
};

/** Newest filing per carrier. DISTINCT ON, bounded by the caller's carrier list. */
async function latestReports(carrierIds: readonly string[]): Promise<Map<string, LatestReport>> {
  const out = new Map<string, LatestReport>();
  if (carrierIds.length === 0) return out;
  const rows = await db
    .selectDistinctOn([arrayReports.carrierId], {
      carrierId: arrayReports.carrierId,
      reportPeriod: arrayReports.reportPeriod,
      accountStatus: arrayReports.accountStatus,
      agencyName: arrayReports.agencyName,
      hasAgency: arrayReports.hasAgency,
      dateOfBirth: arrayReports.dateOfBirth,
      excludedReason: arrayReports.excludedReason,
      validationErrors: arrayReports.validationErrors,
    })
    .from(arrayReports)
    .where(inArray(arrayReports.carrierId, [...carrierIds]))
    .orderBy(arrayReports.carrierId, desc(arrayReports.reportPeriod));
  for (const row of rows) {
    out.set(row.carrierId, {
      reportPeriod: row.reportPeriod,
      accountStatus: row.accountStatus,
      agencyName: row.agencyName,
      hasAgency: row.hasAgency,
      dateOfBirth: row.dateOfBirth ? row.dateOfBirth.slice(0, 10) : null,
      excludedReason: row.excludedReason,
      validationErrors: row.validationErrors,
    });
  }
  return out;
}
