/**
 * Orchestration for `cs.applications.list` (kind: 'local' — see catalog/csDeluge.ts): builds/serves
 * the cached Applications+Deals snapshot (applicationsSnapshotCache.ts) and runs the pure
 * search/filter/sort/facet/paginate pipeline (applicationsListQuery.ts) over it. Replaces the
 * `mytrionGetApplications` Deluge dependency; that function stays deployed in Zoho untouched (the
 * legacy zoho-octane widget still calls it directly).
 */
import {
  drainApplications,
  drainDeals,
  matchDealsByName,
  resolveOwnerNames,
  type DealEnrichment,
  type RawApplicationRow,
} from '../../integrations/csApplicationsQuery.js';
import {
  getApplicationsSnapshot,
  invalidateApplicationsSnapshot,
  patchApplicationsSnapshotRow,
  type ApplicationsSnapshot,
} from '../../lib/applicationsSnapshotCache.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { queryApplications, type ApplicationsQueryParams } from './applicationsListQuery.js';

/**
 * The dispatcher already ran `paramsSchema.parse()` before calling this handler (see
 * dispatcher.ts) — every value here is already the right runtime type. `LocalTouchpoint.handler`'s
 * signature is `Record<string, unknown>` for every catalog entry regardless of that entry's own
 * schema, though, so this narrows explicitly rather than casting the whole object (matches the
 * per-field narrowing other `kind: 'local'` handlers use, e.g. retention.ts's `retention.my_cases`).
 */
export function toApplicationsQueryParams(params: Record<string, unknown>): ApplicationsQueryParams & { fresh: boolean } {
  return {
    tab: params.tab === 'clients' ? 'clients' : 'apps',
    search: typeof params.search === 'string' ? params.search : '',
    sortKey: params.sortKey === 'appId' || params.sortKey === 'carrierId' ? params.sortKey : 'date',
    sortDir: params.sortDir === 'asc' ? 'asc' : 'desc',
    company: typeof params.company === 'string' ? params.company : '',
    dateFrom: typeof params.dateFrom === 'string' ? params.dateFrom : '',
    dateTo: typeof params.dateTo === 'string' ? params.dateTo : '',
    stage: typeof params.stage === 'string' ? params.stage : '',
    biz: typeof params.biz === 'string' ? params.biz : '',
    agent: typeof params.agent === 'string' ? params.agent : '',
    wex: Array.isArray(params.wex) ? params.wex.filter((w): w is string => typeof w === 'string') : [],
    page: typeof params.page === 'number' ? params.page : 1,
    perPage: typeof params.perPage === 'number' ? params.perPage : 200,
    fresh: params.fresh === true,
  };
}

function applyDeal(row: RawApplicationRow, deal: DealEnrichment): RawApplicationRow {
  return {
    ...row,
    _dealOwner: deal.owner,
    Payment_Type_Billing: deal.Payment_Type_Billing,
    Loves_Verification: deal.Loves_Verification,
  };
}

async function buildSnapshot(): Promise<ApplicationsSnapshot<RawApplicationRow>> {
  // Best-effort: a Deals-drain failure degrades every row to 'not assigned' rather than failing
  // the whole list — the Applications data itself is still good and more valuable shown than not.
  const [apps, deals] = await Promise.all([
    drainApplications(),
    drainDeals().catch(() => ({ byApplicationId: new Map<number, DealEnrichment>(), truncated: false })),
  ]);

  const idMatched = new Set<string>();
  let rows = apps.rows.map((row) => {
    const deal = row.Application_ID !== null ? deals.byApplicationId.get(row.Application_ID) : undefined;
    if (!deal) return row;
    idMatched.add(row.id);
    return applyDeal(row, deal);
  });

  // Fallback for rows Application_ID couldn't match: exact company-name equality against
  // Deals.Deal_Name — mirrors the old mytrionGetApplications Deluge function's own two-phase
  // match (verified live: ~5% of a sample tab page relied on this fallback). Names containing an
  // apostrophe are skipped, matching that function's own query-escaping safety.
  const unmatchedNames = [
    ...new Set(
      rows
        .filter((r) => !idMatched.has(r.id) && r.Name && !r.Name.includes("'"))
        .map((r) => r.Name as string),
    ),
  ];
  if (unmatchedNames.length > 0) {
    const byName = await matchDealsByName(unmatchedNames).catch(() => new Map<string, DealEnrichment>());
    rows = rows.map((row) => {
      if (idMatched.has(row.id) || !row.Name) return row;
      const deal = byName.get(row.Name);
      return deal ? applyDeal(row, deal) : row;
    });
  }

  // One owner-name resolution pass over every distinct owner id present in the final row set
  // (id-matched + name-matched deals both funnel through the same `_dealOwner` shape).
  const dealOwners = rows
    .map((r) => r._dealOwner)
    .filter((o): o is { id: string; name: string } => o !== null);
  const owners = [...new Map(dealOwners.map((o) => [o.id, o])).values()];
  const resolvedNames = await resolveOwnerNames(owners);
  rows = rows.map((row) =>
    row._dealOwner
      ? { ...row, _dealOwner: { id: row._dealOwner.id, name: resolvedNames.get(row._dealOwner.id) ?? row._dealOwner.name } }
      : row,
  );

  return { rows, truncated: apps.truncated || deals.truncated };
}

export interface ListApplicationsResult {
  data: RawApplicationRow[];
  more_records: boolean;
  total: number;
  facets: ReturnType<typeof queryApplications>['facets'];
  generated_at: string;
  truncated: boolean;
}

export async function listApplications(
  ctx: TenantContext,
  params: ApplicationsQueryParams & { fresh: boolean },
): Promise<ListApplicationsResult> {
  const { data, generatedAt } = await getApplicationsSnapshot(ctx.tenantId, buildSnapshot, {
    force: params.fresh,
  });
  const result = queryApplications(data.rows, params);
  return {
    data: result.rows,
    more_records: result.moreRecords,
    total: result.total,
    facets: result.facets,
    generated_at: generatedAt,
    truncated: data.truncated,
  };
}

/**
 * Called from applicationsSave.ts right after a successful Zoho write — patches the cached row so
 * a reopen/reload reflects the save immediately, instead of waiting out the snapshot's soft TTL.
 * Falls back to a full invalidate if the row isn't in the current snapshot (e.g. created since the
 * last drain); that's a lazy invalidation (clears the cache entry), not an eager rebuild.
 */
export function patchApplicationSnapshotRow(
  tenantId: string,
  appId: string,
  resolvedFields: Record<string, unknown>,
): void {
  const patched = patchApplicationsSnapshotRow<RawApplicationRow>(
    tenantId,
    (rows) => rows.find((r) => r.id === appId),
    (row) => {
      for (const [key, value] of Object.entries(resolvedFields)) {
        if (key in row) (row as unknown as Record<string, unknown>)[key] = value;
      }
    },
  );
  if (!patched) invalidateApplicationsSnapshot(tenantId);
}
