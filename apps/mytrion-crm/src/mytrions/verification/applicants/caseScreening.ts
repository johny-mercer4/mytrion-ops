/**
 * Phase 3 (Internal Screening) — manual Blacklist + Duplicate marks from the draft SOP.
 *
 * Automations are not built yet. The desk compares the identity facts by eye and records
 * the two decisions. Pass is only the YES path: A clear and B no-duplicate.
 */
import type { VerificationApplicantType, VerificationPrincipal } from '@/api/verificationFlow';

export type ScreeningBlacklistMark = 'none' | 'possible' | 'confirmed';
export type ScreeningDuplicateMark = 'no' | 'yes';

export interface ScreeningMarks {
  blacklist: ScreeningBlacklistMark | null;
  duplicate: ScreeningDuplicateMark | null;
}

export const EMPTY_SCREENING_MARKS: ScreeningMarks = { blacklist: null, duplicate: null };

export interface ScreeningFact {
  id: string;
  label: string;
  value: string;
}

function text(value: unknown): string {
  if (value == null) return '—';
  const s = String(value).trim();
  return s === '' ? '—' : s;
}

/** OO shows the person + permitted SSN; carrier shows company, EIN and principals. */
export function screeningIdentityFacts(
  row: Record<string, unknown> & { applicantType: VerificationApplicantType | null },
  principals: readonly VerificationPrincipal[],
): readonly ScreeningFact[] {
  const ownerOperator = row.applicantType === 'owner_operator';
  const person = [row.firstName, row.lastName].filter(Boolean).join(' ');
  const names = ownerOperator
    ? person || '—'
    : [text(row.companyName), principals.map((p) => p.fullName).filter(Boolean).join(', ')]
        .filter((part) => part !== '—' && part !== '')
        .join(' · ') || '—';
  return [
    {
      id: 'name',
      label: ownerOperator ? 'Name' : 'Name / owner / principals',
      value: names,
    },
    {
      id: 'tax',
      label: ownerOperator ? 'SSN last 4' : 'EIN',
      value: ownerOperator ? text(row.ssnLast4) : text(row.ein),
    },
    { id: 'phone', label: 'Phone', value: text(row.phone) },
    { id: 'email', label: 'Email', value: text(row.email) },
    {
      id: 'address',
      label: ownerOperator ? 'Residential address' : 'Business address',
      value: ownerOperator ? text(row.residentialAddress) : text(row.businessAddress),
    },
    { id: 'ip', label: 'IP', value: text(row.applicantIp) },
    { id: 'mc', label: 'MC', value: text(row.mc) },
    { id: 'dot', label: 'USDOT', value: text(row.dot) },
  ];
}

export function screeningCanPass(marks: ScreeningMarks): boolean {
  return marks.blacklist === 'none' && marks.duplicate === 'no';
}

/** Confirmed Check A uses the existing decline_blacklist door (adds entries + informs Collections). */
export function screeningDeclineOutcome(
  marks: ScreeningMarks,
): 'decline_blacklist' | 'decline' {
  return marks.blacklist === 'confirmed' ? 'decline_blacklist' : 'decline';
}

export const SCREENING_CHECKLIST: readonly string[] = [
  'Blacklist — name, EIN or SSN, phone, email, address, IP, MC, USDOT',
  'Active customer / duplicate — same identifiers',
];

/**
 * What the automated run says, read off the phase's own `findings` blob.
 *
 * The run writes it (`deskService.runScreening`), so this survives a remount and a reload — unlike the
 * marks, which live in component state. `available: false` is NOT a clear: the ban-list lookup is
 * allowed to fail without taking the run down, and a failure that reads as "no match" is the exact
 * shape of the bug this whole area had.
 */
export interface ScreeningRunFindings {
  ranAt: string | null;
  identifiersScreened: number | null;
  blacklistHits: number | null;
  duplicateHits: number | null;
  banList: {
    source: string | null;
    available: boolean;
    error: string | null;
    platformHits: number | null;
    ownHits: number | null;
  } | null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export function screeningRunFrom(findings: Record<string, unknown> | null | undefined): ScreeningRunFindings | null {
  if (!findings || typeof findings !== 'object') return null;
  const ranAt = str(findings.ranAt);
  if (!ranAt) return null;
  const raw = findings.banList;
  const bl = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  return {
    ranAt,
    identifiersScreened: num(findings.identifiersScreened),
    blacklistHits: num(findings.blacklistHits),
    duplicateHits: num(findings.duplicateHits),
    banList: bl
      ? {
          source: str(bl.source),
          available: bl.available === true,
          error: str(bl.error),
          platformHits: num(bl.platformHits),
          ownHits: num(bl.ownHits),
        }
      : null,
  };
}

/**
 * The blacklist mark the RUN implies — a suggestion the reviewer can overrule, never a decision.
 *
 * A clean run means the identifiers we hold are not on either list, which is exactly Check A's
 * "NO MATCH -> Continue". A run with hits is `possible` and not `confirmed`, because the SOP puts a
 * human between a hit and a decline: "MATCH -> Credit Agent verifies the match". And a run whose
 * ban-list lookup was unavailable implies NOTHING — returning `none` there would record a clear the
 * system never obtained.
 */
export function blacklistMarkFromRun(
  run: ScreeningRunFindings | null,
): ScreeningBlacklistMark | null {
  if (!run) return null;
  if (run.banList && !run.banList.available) return null;
  return (run.blacklistHits ?? 0) > 0 ? 'possible' : 'none';
}
