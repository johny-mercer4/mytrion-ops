/**
 * The REAL ban list — `credit_platform.public.blacklist_entries`, read directly.
 *
 * WHY THIS EXISTS. Check A's automation was wired to `verification_blacklist_entries` in OUR Postgres,
 * which holds 0 rows: nothing has ever populated it, and the only writer is this desk's own
 * `decline_blacklist` outcome. Meanwhile the list Octane actually maintains lives in the credit
 * platform — 6,803 active entries across name / company_name / ein / email / phone / address / ip /
 * carrier_id. So "Run screening" returned "no blacklist match" on every case in the system. A fraud
 * check that always clears is worse than no check, because the clear is recorded.
 *
 * READ-ONLY, and over the pool that enforces it (`verificationDb`, `default_transaction_read_only`).
 * We do not own this database and never write it from here — adding an entry is still a write to our
 * own table, so a decline made on this desk is visible to this desk. Matching therefore unions the two.
 *
 * MATCHING IS ON NORMALISED VALUES, not on our hashes: the credit platform stores plaintext and knows
 * nothing about `sha256(type:value)`. `normalizeIdentifier` is the one normaliser both sides go
 * through, so "Smith  Trucking, LLC" and "smith trucking llc" are the same needle.
 *
 * AND IT NORMALISES PER TYPE ON BOTH SIDES, which is not the same thing as case-folding both sides.
 * `normalizeIdentifier` reduces a phone or an EIN to DIGITS; it only case-folds the text types. The
 * first version of this matcher compared `lower(btrim(b.value))` for everything, and the measured
 * consequence was that the phone probe could not match a single row: all 871 `phone` entries are
 * stored formatted — `(201)560-8603`, `180-098-6115` — so a digits-only needle never equalled one.
 * 871 banned phone numbers, 0 reachable, on a check that reported "no match". `storedNormalized`
 * below is the stored-side mirror of `normalizeIdentifier`, so the two sides meet.
 */
import { getVerificationPool } from './verificationDb.js';
import { normalizeIdentifier } from '../modules/verificationFlow/screening.js';
import type { VerificationIdentifierType } from '../db/schema/verification_flow.js';
import { logger } from '../lib/logger.js';
import { errorMessage } from '../lib/errors.js';
import { env } from '../config/env.js';

/**
 * CP `type` → ours.
 *
 * `company_name` and `name` both land on `name`, which is what our own screening does too (it screens
 * `companyName` and the person's full name under one type).
 *
 * FOUR TYPES ARE DELIBERATELY ABSENT, and each absence is a measured fact rather than an oversight.
 * A type we cannot produce a needle for would silently never match, and listing it here would hide
 * that behind an apparently-complete map.
 *
 *  - `carrier_id` (875 entries, all 7 digits). `verification_cases.carrier_id` exists but is empty on
 *    every case (0 of 52 measured), because a carrier id is issued AFTER approval — Zoho even carries
 *    `Carrier_ID_Added_Date`. A new applicant has none by definition. This becomes screenable the day
 *    the desk starts re-checking existing carriers, not before.
 *  - `ip` (697 entries). We never capture the applicant's IP: `collectIdentifiers` is called with
 *    `applicantIp: null` from both call sites, because no intake surface asks for it.
 *  - `mc` / `usdot`. No such CP type exists. They are screened against OUR OWN list only, which is
 *    why `collectIdentifiers` still emits them — see `matchDuplicates` and `blacklistCase`.
 *  - `ssn`. No such CP type either; the platform files SSNs under `ein`, which we already probe. What
 *    we CANNOT do is probe with an SSN of our own: the schema stores `ssn_last4` and nothing more
 *    (deliberately — "Full SSN / DL are never stored"), and 0 of the 870 CP `ein` rows are 4 digits
 *    long (752 are 9, 98 are 12, 18 are 8). A last-4 needle sent to `ein` would match nothing, ever.
 *    It is not sent. If a banned SSN is typed into the EIN box, the `ein` probe finds it.
 */
const CP_TYPE_TO_OURS: Record<string, VerificationIdentifierType> = {
  name: 'name',
  company_name: 'name',
  ein: 'ein',
  email: 'email',
  phone: 'phone',
  address: 'address',
  ip: 'ip',
};

/**
 * Ours → the ONE CP type a new ban of ours is filed under.
 *
 * Reading probes every CP type that can satisfy ours; WRITING must pick one, or a single banned name
 * would insert twice — once as `name`, once as `company_name` — for the same string. `name` is the
 * choice for both, because `collectIdentifiers` flattens the company name and the person's name into
 * one `name` identifier and cannot tell them apart afterwards, and because our own probe queries both
 * CP name types anyway, so a ban filed under `name` is found either way.
 *
 * Null for the four types CP does not model — `ssn`, `mc`, `usdot`, `ip`. Those stay on our list
 * alone, which is the honest outcome: inventing a CP type for them would write rows nothing reads.
 * (`carrier_id` is absent for the different reason given above: a new applicant has none.)
 */
export function canonicalCpType(entryType: VerificationIdentifierType): string | null {
  switch (entryType) {
    case 'name':
      return 'name';
    case 'ein':
      return 'ein';
    case 'email':
      return 'email';
    case 'phone':
      return 'phone';
    case 'address':
      return 'address';
    default:
      return null;
  }
}

/** Ours → every CP type that can satisfy it. The inverse of the map above. */
const OURS_TO_CP_TYPES: Partial<Record<VerificationIdentifierType, string[]>> = (() => {
  const out: Partial<Record<VerificationIdentifierType, string[]>> = {};
  for (const [cp, ours] of Object.entries(CP_TYPE_TO_OURS)) {
    (out[ours] ??= []).push(cp);
  }
  return out;
})();

/**
 * The stored-side mirror of `normalizeIdentifier`, as SQL.
 *
 * Digits for the numeric types and case-folding for the rest — the same split the TypeScript
 * normaliser makes, applied to `blacklist_entries.value`. Without it the numeric probes compare a
 * digits-only needle against a formatted column and match nothing.
 *
 * THE SCIENTIFIC-NOTATION BRANCH IS NOT DEFENSIVE PADDING. 86 of the 871 phone rows are stored as
 * `2.012839371E9` — a spreadsheet export that turned a 10-digit number into a float. Stripping
 * non-digits from that yields the 11-character `20128393719`, which matches no real phone, so those
 * 86 bans would stay unreachable even after the fix above. The regex guard means only a well-formed
 * float is ever cast, so this cannot raise on the other 785 rows.
 *
 * Costs the `(type, value)` index, as the credit-platform team noted when they handed this over. A
 * sequential scan of 6,803 rows is not worth normalising their data first.
 */
const STORED_NORMALIZED = `case
             when b.type in ('phone', 'ein') then
               case when b.value ~ '^[0-9]+\\.[0-9]+[eE][0-9]+$'
                    then trunc(b.value::numeric)::bigint::text
                    else regexp_replace(b.value, '\\D', '', 'g') end
             else lower(btrim(b.value))
           end`;

export interface CreditPlatformBanHit {
  /** `blacklist_entries.id` — the platform's own row, for the reviewer to quote. */
  entryId: number;
  /** The CP type verbatim, so "company_name" is not flattened to "name" in what the desk reads. */
  cpType: string;
  entryType: VerificationIdentifierType;
  /** The normalised needle that matched — never the stored plaintext. */
  matchedOn: string;
  reason: string | null;
  addedBy: string | null;
  addedAt: string | null;
}

export function isCreditPlatformBanListConfigured(): boolean {
  return Boolean(env.VERIFICATION_DATABASE_URL);
}

/**
 * Which of these identifiers are on the credit platform's ban list.
 *
 * ONE QUERY for every identifier, not one per identifier: a case carries up to eleven and the pool is
 * five connections wide. The pairs go in as two parallel arrays and are matched with `unnest`, so a
 * name needle cannot match an email entry.
 *
 * NEVER THROWS. A ban-list lookup that fails must not take the whole screening run down — the desk
 * still needs the duplicate scan and its own list. The caller is told the lookup was unavailable so it
 * can say so rather than reporting a clear it did not get; see `runScreening`.
 */
export async function matchCreditPlatformBanList(
  identifiers: ReadonlyArray<{ entryType: VerificationIdentifierType; value: string }>,
): Promise<{ available: boolean; hits: CreditPlatformBanHit[]; error: string | null }> {
  if (!isCreditPlatformBanListConfigured()) {
    return { available: false, hits: [], error: 'VERIFICATION_DATABASE_URL is not configured' };
  }

  const types: string[] = [];
  const needles: string[] = [];
  const ourTypeByCp = new Map<string, VerificationIdentifierType>();
  for (const id of identifiers) {
    const cpTypes = OURS_TO_CP_TYPES[id.entryType];
    if (!cpTypes) continue;
    const normalized = normalizeIdentifier(id.entryType, id.value);
    if (normalized.length === 0) continue;
    for (const cpType of cpTypes) {
      types.push(cpType);
      needles.push(normalized);
      ourTypeByCp.set(cpType, id.entryType);
    }
  }
  if (types.length === 0) return { available: true, hits: [], error: null };

  try {
    const { rows } = await getVerificationPool().query<{
      id: number;
      type: string;
      reason: string | null;
      added_by: string | null;
      added_at: Date | null;
      needle: string;
    }>(
      `select b.id, b.type, b.reason, b.added_by, b.added_at, n.needle
         from unnest($1::text[], $2::text[]) as n(kind, needle)
         join public.blacklist_entries b
           on b.type = n.kind
          and ${STORED_NORMALIZED} = n.needle
        order by b.added_at desc nulls last
        limit 200`,
      [types, needles],
    );

    return {
      available: true,
      error: null,
      hits: rows.map((row) => ({
        entryId: row.id,
        cpType: row.type,
        entryType: ourTypeByCp.get(row.type) ?? CP_TYPE_TO_OURS[row.type] ?? 'name',
        matchedOn: row.needle,
        reason: row.reason,
        addedBy: row.added_by,
        addedAt: row.added_at ? row.added_at.toISOString() : null,
      })),
    };
  } catch (err) {
    const message = errorMessage(err);
    logger.warn({ err: message }, 'credit-platform ban list lookup failed');
    return { available: false, hits: [], error: message };
  }
}

/** How big the list is, for the desk to show it is reading something real. Null when unavailable. */
export async function creditPlatformBanListSize(): Promise<number | null> {
  if (!isCreditPlatformBanListConfigured()) return null;
  try {
    const { rows } = await getVerificationPool().query<{ n: string }>(
      `select count(*)::text n from public.blacklist_entries`,
    );
    return Number(rows[0]?.n ?? 0);
  } catch (err) {
    logger.warn({ err: errorMessage(err) }, 'credit-platform ban list size failed');
    return null;
  }
}
