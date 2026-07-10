/**
 * DWH servercrm (CMP) operator directory — the ALREADY-EXISTING servercrm login for a
 * carrier, from `octane.stg_cmp_user` (current row via is_active) joined to the carrier's
 * company (`octane.stg_cmp_company`, is_current) and the owner's real name
 * (`public.cmp_company_owner`). Lets the admin bind a `carrier_users` owner account to the
 * carrier's real servercrm credentials instead of provisioning a disconnected login.
 * Read-only (dwhQuery pool enforces it).
 */
import { dwhQuery } from './dwh.js';

export interface DwhOperator {
  servercrmUserId: string | null;
  username: string | null;
  carrierId: string | null;
  companyName: string | null;
  phoneNumber: string | null;
  ownerFirstName: string | null;
  ownerLastName: string | null;
  activated: boolean | null;
  enabled: boolean | null;
}

interface OperatorRow {
  user_id: string | number | null;
  username: string | null;
  carrier_id: number | null;
  company_name: string | null;
  phone_number: string | null;
  first_name: string | null;
  last_name: string | null;
  activated: boolean | null;
  enabled: boolean | null;
}

function toDto(row: OperatorRow): DwhOperator {
  return {
    servercrmUserId: row.user_id != null ? String(row.user_id) : null,
    username: row.username,
    carrierId: row.carrier_id != null ? String(row.carrier_id) : null,
    companyName: row.company_name,
    phoneNumber: row.phone_number,
    ownerFirstName: row.first_name,
    ownerLastName: row.last_name,
    activated: row.activated,
    enabled: row.enabled,
  };
}

/**
 * Search servercrm operator logins. A numeric `q` matches carrier id by prefix; a text `q`
 * matches company name (ILIKE). No `q` = most recently updated first. Current rows only
 * (`is_active = true`, one row per user_id).
 */
export async function searchDwhOperators(opts: {
  q?: string | undefined;
  limit?: number | undefined;
}): Promise<DwhOperator[]> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const q = opts.q?.trim() ?? '';

  const where: string[] = ['u.is_active = true'];
  const params: unknown[] = [];
  if (q.length > 0) {
    if (/^\d+$/.test(q)) {
      params.push(`${q}%`);
      where.push(`u.carrier_id::text like $${params.length}`);
    } else {
      params.push(`%${q}%`);
      where.push(`u.company_name ilike $${params.length}`);
    }
  }

  const rows = await dwhQuery<OperatorRow>(
    `select u.user_id, u.username, u.carrier_id, u.company_name, u.phone_number,
            o.first_name, o.last_name, u.activated, u.enabled
       from octane.stg_cmp_user u
       left join octane.stg_cmp_company c on c.carrier_id = u.carrier_id and c.is_current = true
       left join public.cmp_company_owner o on o.company_id = c.company_id
      where ${where.join(' and ')}
      order by u.updated_date desc nulls last
      limit ${limit}`,
    params,
  );
  return rows.map(toDto);
}
