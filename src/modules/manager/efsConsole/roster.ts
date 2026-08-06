/**
 * EFS Console — the client roster, and the carrier-scope gate.
 *
 * The roster is `octane.dim_company` ONLY. It touches no vendor endpoint, so the console's landing
 * screen paints instantly while every EFS read (1.1s–11.1s against prod) waits for a click.
 *
 * `assertEfsCarrier` is the containment that makes this a client tool rather than a general EFS
 * proxy: a carrier that is not in dim_company cannot be read and cannot be written, on any route,
 * ever. That is deliberate and it has a known cost — dim_company lags the warehouse sync, so a
 * genuinely new child carrier will 404 here for a while and look like a bug. The error message
 * says exactly that so support does not have to guess.
 */
import { dwh } from '../../../integrations/dwh.js';
import { carrierNotAClient } from './dispatch.js';

export interface EfsRosterRow {
  carrierId: string;
  companyName: string;
  contractId: string | null;
  isActive: boolean;
  isDebtor: boolean;
  isLocSuspended: boolean;
  activeCards: number;
  producedCards: number;
  creditLimit: number | null;
  debtAmount: number | null;
  agent: string | null;
  tierName: string | null;
  lastTransactionDate: string | null;
}

interface RosterRaw {
  carrier_id: string | number;
  company_name: string | null;
  contract_id: string | number | null;
  is_active: number | null;
  is_debtor: boolean | null;
  is_loc_suspended: boolean | null;
  total_active_cards: string | number | null;
  total_produced_cards: string | number | null;
  credit_limit: string | number | null;
  debt_amount: string | number | null;
  agent: string | null;
  tier_name: string | null;
  last_transaction_date: Date | string | null;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const maybeNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const iso = (v: Date | string | null): string | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

function toRow(r: RosterRaw): EfsRosterRow {
  return {
    carrierId: String(r.carrier_id),
    companyName: r.company_name ?? `Carrier ${String(r.carrier_id)}`,
    contractId: r.contract_id === null ? null : String(r.contract_id),
    // dim_company stores is_active as an integer flag, not a boolean.
    isActive: num(r.is_active) === 1,
    isDebtor: r.is_debtor === true,
    isLocSuspended: r.is_loc_suspended === true,
    activeCards: num(r.total_active_cards),
    producedCards: num(r.total_produced_cards),
    creditLimit: maybeNum(r.credit_limit),
    debtAmount: maybeNum(r.debt_amount),
    agent: r.agent,
    tierName: r.tier_name,
    lastTransactionDate: iso(r.last_transaction_date),
  };
}

const COLUMNS = `carrier_id, company_name, contract_id, is_active, is_debtor, is_loc_suspended,
                 total_active_cards, total_produced_cards, credit_limit, debt_amount,
                 agent, tier_name, last_transaction_date`;

export interface RosterFilter {
  /** Free text over company name; a digits-only value also matches carrier id by prefix. */
  q?: string | undefined;
  status?: 'all' | 'active' | 'inactive' | 'debtor' | 'suspended' | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

/**
 * A page of clients.
 *
 * Paged rather than fetched whole: `dwhClientRoster.fetchAllClients` pulls ~8k rows and is a
 * multi-second mart scan (it is why the Loyalty card caches for five minutes). The console's
 * roster is a search-and-scan surface, so it reads a window instead.
 */
export async function listEfsRoster(
  filter: RosterFilter = {},
): Promise<{ rows: EfsRosterRow[]; total: number }> {
  const q = (filter.q ?? '').trim();
  const like = q ? `%${q}%` : null;
  const digits = /^\d+$/.test(q) ? q : null;
  const status = filter.status ?? 'all';
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const offset = Math.max(filter.offset ?? 0, 0);

  /*
   * The search predicate is ALWAYS present and always references both placeholders, guarded by
   * `$1::text IS NULL`. Adding it conditionally meant an unfiltered roster bound two parameters to
   * a statement that referenced none, which Postgres rejects outright ("bind message supplies 2
   * parameters, but prepared statement requires 0") — so the default view, the one every user hits
   * first, was the one that 500'd.
   */
  const where: string[] = [
    'carrier_id IS NOT NULL',
    `($1::text IS NULL
        OR company_name ILIKE $1
        OR ($2::text IS NOT NULL AND carrier_id::text LIKE $2 || '%'))`,
  ];
  if (status === 'active') where.push('is_active = 1');
  if (status === 'inactive') where.push('coalesce(is_active, 0) <> 1');
  if (status === 'debtor') where.push('is_debtor IS TRUE');
  if (status === 'suspended') where.push('is_loc_suspended IS TRUE');
  const clause = where.join(' AND ');

  const [rows, counted] = await Promise.all([
    dwh.query<RosterRaw>(
      `SELECT ${COLUMNS}
         FROM octane.dim_company
        WHERE ${clause}
        ORDER BY (is_active = 1) DESC, coalesce(total_active_cards, 0) DESC, company_name
        LIMIT ${limit} OFFSET ${offset}`,
      [like, digits],
    ),
    dwh.query<{ n: string | number }>(
      `SELECT count(*) AS n FROM octane.dim_company WHERE ${clause}`,
      [like, digits],
    ),
  ]);

  return { rows: rows.map(toRow), total: num(counted[0]?.n) };
}

/** One client's warehouse facts — the context strip above the EFS dossier. */
export async function findEfsClient(carrierId: string): Promise<EfsRosterRow | null> {
  const rows = await dwh.query<RosterRaw>(
    `SELECT ${COLUMNS} FROM octane.dim_company WHERE carrier_id::text = $1 LIMIT 1`,
    [carrierId],
  );
  const first = rows[0];
  return first ? toRow(first) : null;
}

/**
 * The scope gate. Throws 404 CARRIER_NOT_A_CLIENT for anything outside dim_company.
 *
 * Every carrier-scoped read and every carrier-scoped write calls this FIRST, before any vendor
 * traffic — so an out-of-scope id costs a warehouse lookup, not an EFS round trip, and never
 * reaches the vendor at all.
 */
export async function assertEfsCarrier(carrierId: string): Promise<EfsRosterRow> {
  const client = await findEfsClient(carrierId);
  if (!client) throw carrierNotAClient(carrierId);
  return client;
}
