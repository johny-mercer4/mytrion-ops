/**
 * DWH client directory — the clients the admin provisions carrier accounts FROM, ordered by
 * application date. Searchable by company name (deal_name), carrier id, or application id.
 * Read-only (dwhQuery pool enforces it).
 *
 * SOURCE: `octane.stg_zoho_deals` (SCD2 history view), NOT the `octane.intm_zoho_deals` view we
 * used to read. intm_zoho_deals hard-codes `where is_active = true`, but the upstream dbt/Airflow
 * load that flags the current version of each deal is broken — every one of the ~253k history rows
 * has `is_active = false` AND a non-null `valid_to`, so intm_zoho_deals returns ZERO rows for every
 * carrier and the picker was empty for everyone. Until that pipeline is fixed we derive the current
 * version ourselves: DISTINCT ON (zoho_deal_id) ordered by `valid_from DESC` picks the newest
 * snapshot per deal (collapses ~253k rows → ~21.7k deals). When the upstream flag is repaired this
 * still works; revert to intm_zoho_deals only once `is_active` is trustworthy again.
 */
import { dwhQuery } from './dwh.js';

export interface DwhClient {
  companyName: string | null;
  stage: string | null;
  carrierId: string | null;
  applicationId: string | null;
  /** ISO date (yyyy-mm-dd) — the ordering key. */
  applicationDate: string | null;
  /** Zoho user id of the deal owner (the sales agent). */
  ownerZohoUserId: string | null;
}

interface DealRow {
  deal_name: string | null;
  stage: string | null;
  carrier_id: number | null;
  application_id: number | null;
  application_date: string | Date | null;
  owner_id: string | number | null;
}

function toIsoDate(v: string | Date | null): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
}

function toDto(row: DealRow): DwhClient {
  return {
    companyName: row.deal_name,
    stage: row.stage,
    carrierId: row.carrier_id != null ? String(row.carrier_id) : null,
    applicationId: row.application_id != null ? String(row.application_id) : null,
    applicationDate: toIsoDate(row.application_date),
    ownerZohoUserId: row.owner_id != null ? String(row.owner_id) : null,
  };
}

/**
 * Search the client directory. A numeric `q` matches carrier/application ids by prefix
 * AND company names; a text `q` matches company names (ILIKE). No `q` = newest
 * applications first (browse mode).
 *
 * The search + stage filter run on the OUTER query (over the already-collapsed current version per
 * deal), never inside the DISTINCT ON — filtering the history first could pick a stale version whose
 * older snapshot happens to match. `Closed Lost` deals are excluded: this is a provisioning picker,
 * not a full deal browser. `is_active` is deliberately NOT filtered (it is false on every row — see
 * the file header); recency comes from `valid_from` instead.
 */
export async function searchDwhClients(opts: {
  q?: string | undefined;
  limit?: number | undefined;
}): Promise<DwhClient[]> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const q = opts.q?.trim() ?? '';

  const where: string[] = [`stage is distinct from 'Closed Lost'`];
  const params: unknown[] = [];
  if (q.length > 0) {
    params.push(`%${q}%`);
    const nameClause = `deal_name ilike $${params.length}`;
    if (/^\d+$/.test(q)) {
      params.push(`${q}%`);
      where.push(
        `(${nameClause} or carrier_id::text like $${params.length} or application_id::text like $${params.length})`,
      );
    } else {
      where.push(nameClause);
    }
  }

  // Inner: newest snapshot per deal (valid_from DESC). Outer: search + stage filter + display order.
  const rows = await dwhQuery<DealRow>(
    `select deal_name, stage, carrier_id, application_id, application_date, owner_id
       from (
         select distinct on (zoho_deal_id)
                zoho_deal_id, deal_name, stage, carrier_id, application_id, application_date, owner_id
           from octane.stg_zoho_deals
          order by zoho_deal_id, valid_from desc nulls last
       ) latest
      where ${where.join(' and ')}
      order by application_date desc nulls last, zoho_deal_id desc
      limit ${limit}`,
    params,
  );
  return rows.map(toDto);
}
