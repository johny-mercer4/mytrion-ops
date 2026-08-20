/**
 * Phase 3 (Internal Screening) — the Blacklist + Duplicate marks, and what the run suggests for them.
 *
 * Both checks are automated now, and neither DECIDES: the run writes findings and hits, and a credit
 * agent still records the mark. Pass is only the YES path — A clear and B no-duplicate.
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
  'Active customer / duplicate — same identifiers, plus Citifuel',
];

/**
 * What the automated run says, read off the phase's own `findings` blob.
 *
 * The run writes it (`deskService.runScreening`), so this survives a remount and a reload — unlike the
 * marks, which live in component state. `available: false` is NOT a clear: the ban-list lookup is
 * allowed to fail without taking the run down, and a failure that reads as "no match" is the exact
 * shape of the bug this whole area had.
 */
export type CitifuelVerdict = 'flagged' | 'clear' | 'unknown' | 'absent';

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
  /**
   * Check B's two populations, kept apart on purpose.
   *
   * `caseHits` scans `verification_cases`, which is a recent WINDOW of the applicant history — the
   * poller ingests from a watermark that defaults to today. `dealHits` scans Zoho Deals, which is the
   * history, but has no EIN column and no phone COQL can normalise. Neither is a superset, so an
   * absence from one is not an absence, and the pane must be able to say which one went quiet.
   */
  duplicateScan: {
    caseHits: number | null;
    dealHits: number | null;
    dealsAvailable: boolean;
    dealsError: string | null;
    dealsTruncated: boolean;
  } | null;
  citifuel: {
    available: boolean;
    status: string | null;
    verdict: CitifuelVerdict;
  } | null;
}

const CITIFUEL_VERDICTS = new Set(['flagged', 'clear', 'unknown', 'absent']);

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
  const obj = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  const bl = obj(findings.banList);
  const dup = obj(findings.duplicateScan);
  const citi = obj(findings.citifuel);
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
    duplicateScan: dup
      ? {
          caseHits: num(dup.caseHits),
          dealHits: num(dup.dealHits),
          // Absent reads as UNAVAILABLE, not as available: a run written before the Deal scan existed
          // genuinely did not consult Zoho, and claiming otherwise would backdate a check.
          dealsAvailable: dup.dealsAvailable === true,
          dealsError: str(dup.dealsError),
          dealsTruncated: dup.dealsTruncated === true,
        }
      : null,
    citifuel: citi
      ? {
          available: citi.available === true,
          status: str(citi.status),
          verdict: CITIFUEL_VERDICTS.has(String(citi.verdict))
            ? (citi.verdict as CitifuelVerdict)
            : 'absent',
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

/**
 * What the run implies for Check B — a suggestion, on the same terms as Check A's.
 *
 * IT SUGGESTS NOTHING WHENEVER A SOURCE WENT QUIET, and Check B has three of them. An unreachable
 * Zoho, a Citifuel status this desk cannot interpret (`App Filled`), or a run predating the Deal scan
 * all mean the same thing: the absence of a duplicate has not been established. Returning `no` there
 * would put a clear on the phase that nothing obtained — the precise bug Check A already had, and the
 * reason `blacklistMarkFromRun` refuses on `available: false`.
 *
 * A Citifuel `flagged` alone is enough to suggest `yes`. That is the point of normalising the value
 * set: `yes` and `active` mean an existing Citifuel relationship just as plainly as `Lead Converted`,
 * and the exact-string check they replaced let those through.
 */
export function duplicateMarkFromRun(
  run: ScreeningRunFindings | null,
): ScreeningDuplicateMark | null {
  if (!run) return null;
  if (run.citifuel?.verdict === 'flagged') return 'yes';
  if ((run.duplicateHits ?? 0) > 0) return 'yes';
  // Below here the answer would be "no duplicate", so every source has to have actually spoken.
  if (!run.duplicateScan || !run.duplicateScan.dealsAvailable) return null;
  if (run.duplicateScan.dealsTruncated) return null;
  if (!run.citifuel || !run.citifuel.available) return null;
  if (run.citifuel.verdict === 'unknown') return null;
  return 'no';
}

/** Reviewer-facing sentence for a Citifuel status. One place, so the pane and the aside agree. */
export function citifuelSentence(
  citifuel: ScreeningRunFindings['citifuel'],
): { tone: 'good' | 'warn' | 'bad' | 'neutral'; text: string } {
  if (!citifuel || !citifuel.available) {
    return { tone: 'warn', text: 'Citifuel status could not be read — this is not a clear.' };
  }
  switch (citifuel.verdict) {
    case 'flagged':
      return { tone: 'bad', text: `Citifuel says “${citifuel.status ?? ''}” — an existing relationship.` };
    case 'clear':
      return { tone: 'good', text: 'Citifuel says no — no existing relationship.' };
    case 'unknown':
      return {
        tone: 'warn',
        text: `Citifuel says “${citifuel.status ?? ''}”, which this desk cannot read as yes or no.`,
      };
    default:
      return { tone: 'neutral', text: 'No Citifuel status on the Deal.' };
  }
}
