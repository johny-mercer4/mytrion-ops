/**
 * Phase 2 (Initial Identity / Business Verification) — manual checks from the draft SOP.
 *
 * Owner-operator and carrier are different lists. Marks stay on the desk until a decision;
 * MISSING maps onto the existing document-request door so Sales sees `pending_docs`.
 */
import type { VerificationApplicantType, VerificationDocType } from '@/api/verificationFlow';
import { PHASE_ORDER } from './applicantsModel';

export type IdentityMark = 'ok' | 'missing' | 'inconsistent';

export interface IdentityCheck {
  id: string;
  label: string;
  /** Intake columns shown beside the check so the reviewer can compare. */
  fields: readonly string[];
  /** Document type requested when this check is marked missing. */
  missingDoc: { docType: VerificationDocType; label: string };
}

const OO_CHECKS: readonly IdentityCheck[] = [
  { id: 'full_name', label: 'Full name', fields: ['firstName', 'lastName'], missingDoc: { docType: 'other', label: 'Name documentation' } },
  { id: 'drivers_license', label: "Driver's licence", fields: ['dlLast4', 'dlState'], missingDoc: { docType: 'drivers_license', label: "Driver's licence" } },
  { id: 'ssn_docs', label: 'SSN documentation', fields: ['ssnLast4'], missingDoc: { docType: 'ssn_card', label: 'SSN card' } },
  { id: 'residential_address', label: 'Residential address', fields: ['residentialAddress'], missingDoc: { docType: 'other', label: 'Residential address proof' } },
  { id: 'phone_email', label: 'Phone and email', fields: ['phone', 'email'], missingDoc: { docType: 'other', label: 'Contact confirmation' } },
  { id: 'bank_ownership', label: 'Bank account ownership', fields: ['bankingSource'], missingDoc: { docType: 'bank_statement', label: 'Bank statement' } },
  { id: 'consistency', label: 'Consistency across application, ID, bank and contact', fields: [], missingDoc: { docType: 'other', label: 'Identity consistency evidence' } },
];

const CARRIER_CHECKS: readonly IdentityCheck[] = [
  { id: 'company_ein', label: 'Legal company name and EIN', fields: ['companyName', 'ein'], missingDoc: { docType: 'other', label: 'Company / EIN documentation' } },
  { id: 'business_address', label: 'Business address', fields: ['businessAddress'], missingDoc: { docType: 'other', label: 'Business address proof' } },
  { id: 'principals', label: 'Owner(s) / principals', fields: [], missingDoc: { docType: 'other', label: 'Principal identification' } },
  { id: 'phone_email', label: 'Phone and email', fields: ['phone', 'email'], missingDoc: { docType: 'other', label: 'Contact confirmation' } },
  { id: 'mc_dot', label: 'MC and USDOT', fields: ['mc', 'dot'], missingDoc: { docType: 'authority', label: 'Operating authority' } },
  { id: 'authority_age', label: 'Authority status and business / authority age', fields: ['mc', 'dot'], missingDoc: { docType: 'authority', label: 'Authority status' } },
  { id: 'bank_ownership', label: 'Bank account ownership', fields: ['bankingSource'], missingDoc: { docType: 'bank_statement', label: 'Bank statement' } },
];

export function identityChecksFor(
  applicantType: VerificationApplicantType | null,
): readonly IdentityCheck[] {
  return applicantType === 'owner_operator' ? OO_CHECKS : CARRIER_CHECKS;
}

export function identityChecklistLines(
  applicantType: VerificationApplicantType | null,
): readonly string[] {
  return identityChecksFor(applicantType).map((c) => c.label);
}

export function allIdentityOk(
  checks: readonly IdentityCheck[],
  marks: Record<string, IdentityMark>,
): boolean {
  return checks.length > 0 && checks.every((c) => marks[c.id] === 'ok');
}

export function missingIdentityDocs(
  checks: readonly IdentityCheck[],
  marks: Record<string, IdentityMark>,
): Array<{ docType: VerificationDocType; label: string }> {
  const seen = new Set<string>();
  const items: Array<{ docType: VerificationDocType; label: string }> = [];
  for (const check of checks) {
    if (marks[check.id] !== 'missing') continue;
    const key = `${check.missingDoc.docType}:${check.missingDoc.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(check.missingDoc);
  }
  return items;
}

export function caseMovedPastPhase(phaseOrder: number, casePhaseCode: string): boolean {
  const current = PHASE_ORDER.indexOf(casePhaseCode) + 1;
  return current > 0 && phaseOrder < current;
}

export function showPhaseDecideActions(input: {
  phaseStatus: string;
  applies: boolean;
  closed: boolean;
  locked: boolean;
  /** True when the case has already advanced past this spine step. */
  movedPast: boolean;
}): boolean {
  if (input.closed || input.locked || input.movedPast) return false;
  if (!input.applies) return false;
  if (input.phaseStatus === 'passed') return false;
  return true;
}
