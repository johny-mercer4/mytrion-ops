/**
 * Carrier records from the warehouse — `stg_broker_snapshot`, used to PREFILL Phase 1 intake.
 *
 * 542,654 rows (538,062 active) of FMCSA-shaped carrier data: DOT number, owner name, physical
 * address, phone, email, power units and operating status. Fill rates on the active rows are
 * 95-99% for every column we read.
 *
 * WHAT THIS IS FOR, AND WHAT IT IS NOT. It is a SUGGESTION source. Measured against the live
 * verification cases it matches about a quarter of them, so it cannot be a dependency — nothing
 * downstream may assume a match exists — and it must never write to a case on its own. The agent
 * sees what the warehouse holds and chooses.
 *
 * MATCH KEYS, in order: phone, then DOT, then email. Phone first because it wins most often on
 * real data (5 of 25 versus 3 for DOT and 1 for email) and because a Deal usually has one long
 * before it has an authority number. There is deliberately no company-name key: this table has no
 * company-name column at all — `owner_full_name` is a PERSON — so a name match is not available
 * however much it would help.
 *
 * ONE query, not three. Phone matching normalises through `regexp_replace`, which no index can
 * serve, so three sequential lookups would be three sequential scans of half a million rows. All
 * three keys go in one `or` and the winner is chosen in JS by the order above.
 *
 * Postgres dialect, `$n` placeholders. Read-only, like every DWH module — see `dwh.ts` for the
 * session pin.
 */
import { dwh } from './dwh.js';

/** Which key produced the match — shown to the agent, because provenance decides whether to trust it. */
export type BrokerMatchKey = 'phone' | 'dot' | 'email';

export interface BrokerSnapshotMatch {
  matchedOn: BrokerMatchKey;
  dotNumber: string | null;
  ownerFullName: string | null;
  physicalAddress: string | null;
  phoneNumber: string | null;
  email: string | null;
  /** FMCSA power units — the closest thing the warehouse has to "number of trucks". */
  powerUnits: number | null;
  truckSize: number | null;
  operatingStatus: string | null;
  /** `add_date` — when the authority was registered. Phase 9 reads authority age. */
  authorityAddedOn: string | null;
}

interface SnapshotRow {
  dot_number: number | string | null;
  owner_full_name: string | null;
  physical_address: string | null;
  phone_number: string | null;
  email: string | null;
  power_units: number | string | null;
  truck_size: number | string | null;
  operating_status: string | null;
  add_date: string | Date | null;
  match_phone: boolean;
  match_dot: boolean;
  match_email: boolean;
}

export interface BrokerLookupKeys {
  /** Any format; normalised to digits here. A US number may or may not carry its leading 1. */
  phones?: readonly (string | null | undefined)[];
  dot?: string | null;
  email?: string | null;
}

/** Digits only, with a leading US country code dropped so `+1 614 555 0110` matches `6145550110`. */
export function normalisePhone(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return digits.length >= 10 ? digits : null;
}

/** A DOT is digits and never zero — the same sentinel rule the Zoho boundary applies. */
function normaliseDot(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits !== '' && Number(digits) !== 0 ? digits : null;
}

function num(value: number | string | null): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toIsoDate(value: string | Date | null): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function toDto(row: SnapshotRow, matchedOn: BrokerMatchKey): BrokerSnapshotMatch {
  return {
    matchedOn,
    // BIGINT in the warehouse, TEXT on our side — cast on the way out, as `dwhCompanies` does.
    dotNumber: row.dot_number != null ? String(row.dot_number) : null,
    ownerFullName: row.owner_full_name,
    physicalAddress: row.physical_address,
    phoneNumber: row.phone_number,
    email: row.email,
    powerUnits: num(row.power_units),
    truckSize: num(row.truck_size),
    operatingStatus: row.operating_status,
    authorityAddedOn: toIsoDate(row.add_date),
  };
}

/**
 * `$1` DOT, `$2` lowercased email, `$3` normalised phones. All three are referenced — Postgres
 * rejects a bound parameter it cannot see ("could not determine data type of parameter"), which is
 * why the null checks are written against the parameter rather than skipped in JS.
 *
 * `match_*` come back per row so the ranking does not have to re-derive which key hit.
 */
const LOOKUP_SQL = `
  select dot_number, owner_full_name, physical_address, phone_number, email,
         power_units, truck_size, operating_status, add_date,
         ($3::text[] is not null and regexp_replace(coalesce(phone_number, ''), '\\D', '', 'g') = any($3::text[])) as match_phone,
         ($1::bigint is not null and dot_number = $1::bigint) as match_dot,
         ($2::text is not null and lower(email) = $2::text) as match_email
  from stg_broker_snapshot
  where is_active
    and (
      ($1::bigint is not null and dot_number = $1::bigint)
      or ($2::text is not null and lower(email) = $2::text)
      or ($3::text[] is not null and regexp_replace(coalesce(phone_number, ''), '\\D', '', 'g') = any($3::text[]))
    )
  order by change_date desc nulls last
  limit 5
`;

/** Ranked as documented: phone, then DOT, then email. */
const MATCH_ORDER: readonly BrokerMatchKey[] = ['phone', 'dot', 'email'];

/**
 * The best carrier record for these keys, or null.
 *
 * Returns null rather than throwing when there is nothing to look up — an application with no
 * phone, DOT or email is the normal early state, not an error.
 */
export async function findBrokerSnapshot(
  keys: BrokerLookupKeys,
): Promise<BrokerSnapshotMatch | null> {
  const phones = [...new Set((keys.phones ?? []).map(normalisePhone).filter((p): p is string => p !== null))];
  const dot = normaliseDot(keys.dot);
  const email = keys.email?.trim().toLowerCase() || null;
  if (phones.length === 0 && dot === null && email === null) return null;

  const rows = await dwh.query<SnapshotRow>(LOOKUP_SQL, [
    dot,
    email,
    phones.length > 0 ? phones : null,
  ]);
  if (rows.length === 0) return null;

  for (const key of MATCH_ORDER) {
    const hit = rows.find((r) =>
      key === 'phone' ? r.match_phone : key === 'dot' ? r.match_dot : r.match_email,
    );
    if (hit) return toDto(hit, key);
  }
  return null;
}
