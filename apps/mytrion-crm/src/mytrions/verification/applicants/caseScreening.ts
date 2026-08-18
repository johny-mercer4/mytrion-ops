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
