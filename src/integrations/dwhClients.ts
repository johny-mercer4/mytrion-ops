/**
 * DWH client directory — the ALREADY-DEFINED clients from `octane.intm_zoho_deals`
 * (one active row per deal via is_active), ordered by application date. This is the
 * source the admin provisions carrier accounts FROM: searchable by company name
 * (deal_name), carrier id, or application id. Read-only (dwhQuery pool enforces it).
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
 */
export async function searchDwhClients(opts: {
  q?: string | undefined;
  limit?: number | undefined;
}): Promise<DwhClient[]> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const q = opts.q?.trim() ?? '';

  const where: string[] = ['is_active = true'];
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

  const rows = await dwhQuery<DealRow>(
    `select deal_name, stage, carrier_id, application_id, application_date, owner_id
       from octane.intm_zoho_deals
      where ${where.join(' and ')}
      order by application_date desc nulls last, zoho_deal_id desc
      limit ${limit}`,
    params,
  );
  return rows.map(toDto);
}
