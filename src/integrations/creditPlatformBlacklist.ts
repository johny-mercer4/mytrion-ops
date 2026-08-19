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
 * through, so "Smith  Trucking, LLC" and "smith trucking llc" are the same needle. The CP values are
 * already trimmed and almost entirely lowercase (measured: 1 uppercase EIN, 95 uppercase phones), so
 * the comparison is done on `normalized` in SQL as well, not on the raw column.
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
 * `companyName` and the person's full name under one type). `carrier_id` is the platform's own carrier
 * key and matches nothing we hold, so it is deliberately absent — a type we cannot produce a needle
 * for would silently never match, and pretending otherwise in the map would hide that.
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

/** Ours → every CP type that can satisfy it. The inverse of the map above. */
const OURS_TO_CP_TYPES: Partial<Record<VerificationIdentifierType, string[]>> = (() => {
  const out: Partial<Record<VerificationIdentifierType, string[]>> = {};
  for (const [cp, ours] of Object.entries(CP_TYPE_TO_OURS)) {
    (out[ours] ??= []).push(cp);
  }
  return out;
})();

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
          and lower(btrim(b.value)) = n.needle
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
