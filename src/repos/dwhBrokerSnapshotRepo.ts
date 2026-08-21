/**
 * Read-only queries against DWH `public.stg_broker_snapshot`.
 *
 * This warehouse is not tenant-scoped — there is no tenant_id. The repo still exists so Data
 * Center SQL stays out of routes (CLAUDE.md). DWH is a replica; never migrate it.
 *
 * Inspected 2026-08-21 (`information_schema` + `pg_index`): 17 columns, ~543k rows
 * (538k active). Indexes are `sk` PK, unique active `id`, and `change_date`. There is no
 * index on `dot_number` or `owner_full_name`, and no MC column at all. EXPLAIN of a DOT
 * equality is a parallel seq scan (~cost 21k). We cannot add an index on a read-only
 * replica, so "fast" is exact DOT / `left(lower(owner_full_name))` prefix + `is_active`
 * + a bounded page — never an unbounded `SELECT *`. Phone/email stay Phase 2 match keys
 * (`dwhBrokerSnapshot.ts`).
 *
 * Pagination is OFFSET + LIMIT+1 (`hasMore`), not COUNT(*). A name-prefix COUNT would
 * seq-scan the same 543k the page already walks; we refuse that extra scan. OFFSET page N
 * still skips prior matches on an unindexed replica — bound `pageSize` (max 100) so each
 * request stays a bounded sort+limit. `sk` is the tie-break so pages do not drift.
 */
import { dwh } from '../integrations/dwh.js';

/** First-page size. DOT usually returns 1–few SCD rows; name stays bounded per page. */
export const BROKER_SNAPSHOT_DEFAULT_PAGE_SIZE = 50;
export const BROKER_SNAPSHOT_MAX_PAGE_SIZE = 100;

/** Prefix ILIKE bound — below this, a name query is not worth the scan. */
export const BROKER_SNAPSHOT_NAME_MIN = 3;

const DOT_SQL = `
  select *
  from public.stg_broker_snapshot
  where is_active
    and dot_number = $1::bigint
  order by change_date desc nulls last, sk desc
  limit $2 offset $3
`;

const NAME_SQL = `
  select *
  from public.stg_broker_snapshot
  where is_active
    and owner_full_name is not null
    and left(lower(owner_full_name), length($1)) = lower($1)
  order by change_date desc nulls last, sk desc
  limit $2 offset $3
`;

export function clampBrokerPage(page: number | undefined): number {
  const n = Math.floor(page ?? 1);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export function clampBrokerPageSize(pageSize: number | undefined): number {
  const n = Math.floor(pageSize ?? BROKER_SNAPSHOT_DEFAULT_PAGE_SIZE);
  if (!Number.isFinite(n) || n < 1) return BROKER_SNAPSHOT_DEFAULT_PAGE_SIZE;
  return Math.min(n, BROKER_SNAPSHOT_MAX_PAGE_SIZE);
}

export async function searchBrokerSnapshotByDot(
  dot: string,
  pageSize: number,
  offset: number,
): Promise<Record<string, unknown>[]> {
  return dwh.query<Record<string, unknown>>(DOT_SQL, [dot, pageSize + 1, offset]);
}

export async function searchBrokerSnapshotByName(
  name: string,
  pageSize: number,
  offset: number,
): Promise<Record<string, unknown>[]> {
  return dwh.query<Record<string, unknown>>(NAME_SQL, [name, pageSize + 1, offset]);
}
