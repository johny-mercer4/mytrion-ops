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
 * + LIMIT — never an unbounded `SELECT *`. Phone/email stay Phase 2 match keys
 * (`dwhBrokerSnapshot.ts`).
 */
import { dwh } from '../integrations/dwh.js';

export const BROKER_SNAPSHOT_SEARCH_LIMIT = 25;

/** Prefix ILIKE bound — below this, a name query is not worth the scan. */
export const BROKER_SNAPSHOT_NAME_MIN = 3;

const DOT_SQL = `
  select *
  from public.stg_broker_snapshot
  where is_active
    and dot_number = $1::bigint
  order by change_date desc nulls last
  limit $2
`;

const NAME_SQL = `
  select *
  from public.stg_broker_snapshot
  where is_active
    and owner_full_name is not null
    and left(lower(owner_full_name), length($1)) = lower($1)
  order by change_date desc nulls last
  limit $2
`;

export async function searchBrokerSnapshotByDot(dot: string): Promise<Record<string, unknown>[]> {
  return dwh.query<Record<string, unknown>>(DOT_SQL, [dot, BROKER_SNAPSHOT_SEARCH_LIMIT]);
}

export async function searchBrokerSnapshotByName(name: string): Promise<Record<string, unknown>[]> {
  return dwh.query<Record<string, unknown>>(NAME_SQL, [name, BROKER_SNAPSHOT_SEARCH_LIMIT]);
}
