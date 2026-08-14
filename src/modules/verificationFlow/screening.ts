/**
 * Phase 3 screening — Check A (blacklist) and Check B (active customer / duplicate).
 *
 * Entirely local: both checks run against our own Postgres. There is no external service, which is
 * the point of the rebuild.
 *
 * IDENTIFIERS ARE HASHED, NOT STORED. An SSN or EIN is normalized then SHA-256'd, so the blacklist
 * can match on it without holding it. `valueDisplay` is a masked echo for the desk — never the raw
 * value. A hash is only as private as its input space, so this is a reduction in exposure, not a
 * substitute for access control: the tables stay department-gated either way.
 *
 * Normalization is what makes matching work at all — "(555) 123-4567" and "5551234567" are the same
 * phone, and `MC-123456` is the same authority as `123456`.
 */
import { createHash } from 'node:crypto';
import type { VerificationIdentifierType } from '../../db/schema/verification_flow.js';

export interface ScreeningIdentifier {
  entryType: VerificationIdentifierType;
  /** Raw value as entered. Never persisted — only its hash and a masked display are. */
  value: string;
  /** Masked echo for the desk, e.g. "***-**-4821". Computed here so callers cannot leak the raw one. */
  display: string;
  hash: string;
  last4: string | null;
}

/**
 * Per-type normalization, applied before hashing so equivalent values collide deliberately.
 * Digits-only for numeric identifiers; case- and whitespace-folded for the rest.
 */
export function normalizeIdentifier(entryType: VerificationIdentifierType, raw: string): string {
  const trimmed = raw.trim();
  switch (entryType) {
    case 'ssn':
    case 'ein':
    case 'phone':
    case 'mc':
    case 'usdot':
      return trimmed.replace(/\D+/g, '');
    case 'email':
      return trimmed.toLowerCase();
    case 'name':
    case 'address':
      // Collapse internal whitespace and punctuation so "Smith  Trucking, LLC" matches
      // "smith trucking llc". Deliberately lossy: a near-miss should surface as a hit for a human
      // to rule on, which is exactly what Check A does with its verdict step.
      return trimmed
        .toLowerCase()
        .replace(/[.,#]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    case 'ip':
      return trimmed.toLowerCase();
  }
}

export function hashIdentifier(entryType: VerificationIdentifierType, raw: string): string {
  const normalized = normalizeIdentifier(entryType, raw);
  return createHash('sha256').update(`${entryType}:${normalized}`).digest('hex');
}

/** Last four characters of the normalized value, for display. Null when too short to be useful. */
function last4Of(normalized: string): string | null {
  return normalized.length >= 4 ? normalized.slice(-4) : null;
}

/** Mask everything but the tail for the identifiers that are genuinely sensitive. */
function maskFor(entryType: VerificationIdentifierType, raw: string, normalized: string): string {
  const tail = last4Of(normalized);
  switch (entryType) {
    case 'ssn':
      return tail ? `***-**-${tail}` : '***';
    case 'ein':
      return tail ? `**-***${tail}` : '**';
    case 'phone':
      return tail ? `(***) ***-${tail}` : '***';
    case 'email': {
      const [user, domain] = normalized.split('@');
      if (!user || !domain) return '***';
      return `${user.slice(0, 2)}***@${domain}`;
    }
    // Business identifiers are not secrets — MC/DOT/name/address are public-record or already on
    // the case. Masking them would make a hit unreadable for no privacy gain.
    default:
      return raw.trim();
  }
}

/** Build a screenable identifier. Returns null for an empty value so callers can map over sparse input. */
export function buildIdentifier(
  entryType: VerificationIdentifierType,
  raw: string | null | undefined,
): ScreeningIdentifier | null {
  if (typeof raw !== 'string') return null;
  const normalized = normalizeIdentifier(entryType, raw);
  if (normalized.length === 0) return null;
  return {
    entryType,
    value: raw,
    display: maskFor(entryType, raw, normalized),
    hash: createHash('sha256').update(`${entryType}:${normalized}`).digest('hex'),
    last4: last4Of(normalized),
  };
}

/** The case fields both checks screen on, per the SOP's identifier list. */
export interface ScreenableCase {
  companyName: string | null;
  firstName: string | null;
  lastName: string | null;
  ein: string | null;
  ssnLast4: string | null;
  phone: string | null;
  email: string | null;
  businessAddress: string | null;
  residentialAddress: string | null;
  mc: string | null;
  dot: string | null;
  applicantIp: string | null;
}

/**
 * Every identifier a case can be screened on.
 *
 * SSN is screened on the LAST 4 ONLY, because that is all we hold. That is a deliberately weaker
 * match than a full SSN would give — it will produce false positives, which is precisely why every
 * blacklist hit goes to a credit agent for a verdict before anything happens.
 */
export function collectIdentifiers(c: ScreenableCase): ScreeningIdentifier[] {
  const fullName = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
  const candidates: Array<[VerificationIdentifierType, string | null]> = [
    ['name', c.companyName],
    ['name', fullName.length > 0 ? fullName : null],
    ['ein', c.ein],
    ['ssn', c.ssnLast4],
    ['phone', c.phone],
    ['email', c.email],
    ['address', c.businessAddress],
    ['address', c.residentialAddress],
    ['mc', c.mc],
    ['usdot', c.dot],
    ['ip', c.applicantIp],
  ];

  const seen = new Set<string>();
  const out: ScreeningIdentifier[] = [];
  for (const [type, value] of candidates) {
    const id = buildIdentifier(type, value);
    if (!id) continue;
    // A company named the same as its owner would otherwise be screened twice and produce two
    // identical hits for the agent to rule on separately.
    if (seen.has(id.hash)) continue;
    seen.add(id.hash);
    out.push(id);
  }
  return out;
}

/**
 * Whether Phase 3 may be cleared.
 *
 * A confirmed blacklist match is decisive — Decline + Blacklist, and Collections is informed.
 * An unruled hit blocks: the SOP has the credit agent verify each match, so "no verdict yet" is not
 * the same as "no match" and must not pass silently.
 */
export function screeningVerdictSummary(
  hits: ReadonlyArray<{ checkType: string; verdict: string }>,
): {
  blacklistConfirmed: boolean;
  duplicateConfirmed: boolean;
  unresolved: number;
  clear: boolean;
} {
  let blacklistConfirmed = false;
  let duplicateConfirmed = false;
  let unresolved = 0;

  for (const hit of hits) {
    if (hit.verdict === 'unverified') {
      unresolved += 1;
      continue;
    }
    if (hit.verdict !== 'confirmed') continue;
    if (hit.checkType === 'blacklist') blacklistConfirmed = true;
    if (hit.checkType === 'duplicate') duplicateConfirmed = true;
  }

  return {
    blacklistConfirmed,
    duplicateConfirmed,
    unresolved,
    clear: unresolved === 0 && !blacklistConfirmed && !duplicateConfirmed,
  };
}
