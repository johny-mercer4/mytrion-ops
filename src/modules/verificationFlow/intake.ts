/**
 * Phase 1 intake completeness — the ONE place that decides red vs green.
 *
 * `verification_cases.verification_process` is set from `evaluateIntakeCompleteness` and nowhere
 * else. It is a pure function of the case row, its principals and its documents, so the same inputs
 * always produce the same verdict and the Sales UI can preview the missing list without a write.
 *
 * The client never sets the gate. Sales POSTs a submit, the server re-evaluates from the database,
 * and the answer it computes is the answer that is stored — a client that lies about completeness
 * changes nothing.
 *
 * Field lists come straight from the SOP's Flow A (owner-operator / individual) and Flow B (carrier).
 */
import type {
  VerificationApplicantType,
  VerificationCaseDocument,
  VerificationCasePrincipal,
} from '../../db/schema/verification_flow.js';

/** The subset of a case row intake cares about. Kept structural so tests need no DB row. */
export interface IntakeCandidate {
  applicantType: VerificationApplicantType | null;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  dateOfBirth: string | null;
  dlLast4: string | null;
  ssnLast4: string | null;
  residentialAddress: string | null;
  businessAddress: string | null;
  ein: string | null;
  mc: string | null;
  dot: string | null;
  email: string | null;
  phone: string | null;
  trucksCount: number | null;
  fuelCardsRequested: number | null;
  requestedLimit: string | null;
  bankingSource: string | null;
  plaidConnected: boolean;
}

export interface MissingItem {
  /** Machine key — what the UI highlights. */
  field: string;
  /** What the agent is asked for, in their words. */
  label: string;
  /** Which part of the wizard owns it. */
  section: 'applicant' | 'identity' | 'business' | 'contact' | 'request' | 'banking' | 'principals';
}

export interface IntakeVerdict {
  complete: boolean;
  missing: MissingItem[];
}

/** SOP: "Last three bank statements OR Plaid bank connection". */
export const REQUIRED_BANK_STATEMENTS = 3;

const has = (v: string | null | undefined): boolean => typeof v === 'string' && v.trim().length > 0;
const hasNum = (v: number | null | undefined): boolean => typeof v === 'number' && Number.isFinite(v);

/**
 * Positive card counts only. Zero fuel cards is not an application, and a negative number is a
 * client bug we should surface as "missing" rather than silently route on.
 */
const hasPositive = (v: number | null | undefined): boolean => hasNum(v) && (v as number) > 0;

function commonRequirements(c: IntakeCandidate): MissingItem[] {
  const missing: MissingItem[] = [];
  if (!has(c.email)) missing.push({ field: 'email', label: 'Email', section: 'contact' });
  if (!has(c.phone)) missing.push({ field: 'phone', label: 'Phone', section: 'contact' });
  if (!hasPositive(c.trucksCount)) {
    missing.push({ field: 'trucksCount', label: 'Number of trucks', section: 'request' });
  }
  if (!hasPositive(c.fuelCardsRequested)) {
    missing.push({
      field: 'fuelCardsRequested',
      label: 'Number of fuel cards requested',
      section: 'request',
    });
  }
  if (!has(c.requestedLimit)) {
    missing.push({
      field: 'requestedLimit',
      label: 'Requested credit / spending limit',
      section: 'request',
    });
  }
  return missing;
}

/** Flow A — owner-operator / individual. */
function ownerOperatorRequirements(c: IntakeCandidate): MissingItem[] {
  const missing: MissingItem[] = [];
  if (!has(c.firstName)) missing.push({ field: 'firstName', label: 'First name', section: 'applicant' });
  if (!has(c.lastName)) missing.push({ field: 'lastName', label: 'Last name', section: 'applicant' });
  if (!has(c.dateOfBirth)) {
    missing.push({ field: 'dateOfBirth', label: 'Date of birth', section: 'applicant' });
  }
  if (!has(c.dlLast4)) {
    missing.push({ field: 'dlLast4', label: "Driver's licence (last 4)", section: 'identity' });
  }
  if (!has(c.ssnLast4)) {
    missing.push({ field: 'ssnLast4', label: 'SSN (last 4)', section: 'identity' });
  }
  if (!has(c.residentialAddress)) {
    missing.push({
      field: 'residentialAddress',
      label: 'Residential address',
      section: 'applicant',
    });
  }
  return missing;
}

/** Flow B — carrier. `company` is Flow B minus MC/DOT (that absence is what routes it to Manager Review). */
function carrierRequirements(c: IntakeCandidate, requireAuthority: boolean): MissingItem[] {
  const missing: MissingItem[] = [];
  if (!has(c.companyName)) {
    missing.push({ field: 'companyName', label: 'Full legal company name', section: 'business' });
  }
  if (!has(c.ein)) missing.push({ field: 'ein', label: 'EIN', section: 'business' });
  if (requireAuthority) {
    if (!has(c.mc)) missing.push({ field: 'mc', label: 'MC number', section: 'business' });
    if (!has(c.dot)) missing.push({ field: 'dot', label: 'USDOT number', section: 'business' });
  }
  if (!has(c.businessAddress)) {
    missing.push({ field: 'businessAddress', label: 'Business address', section: 'business' });
  }
  return missing;
}

/** A document counts only once it has actually arrived. */
function hasDocument(
  documents: readonly Pick<VerificationCaseDocument, 'docType' | 'status'>[],
  docType: string,
): boolean {
  return documents.some((d) => d.docType === docType && d.status === 'received');
}

/**
 * Flow A identity DOCUMENTS.
 *
 * The SOP lists "Driver's License" and "SSN card" as intake items, and it means the documents —
 * Phase 2 then cross-checks the application against them. Requiring only the last 4 digits would
 * let an application reach the desk with nothing to cross-check against, and the last 4 are also
 * what the (deliberately weak) SSN screening match runs on. So both the field and the file.
 */
function identityDocumentRequirements(
  documents: readonly Pick<VerificationCaseDocument, 'docType' | 'status'>[],
): MissingItem[] {
  const missing: MissingItem[] = [];
  if (!hasDocument(documents, 'drivers_license')) {
    missing.push({ field: 'driversLicenseDoc', label: "Driver's licence (upload)", section: 'identity' });
  }
  if (!hasDocument(documents, 'ssn_card')) {
    missing.push({ field: 'ssnCardDoc', label: 'SSN card (upload)', section: 'identity' });
  }
  return missing;
}

/**
 * Banking: three statements OR a Plaid connection. Only `status='received'` bank-statement documents
 * count — a `requested` row is the ask, not the answer.
 */
function bankingRequirements(
  c: IntakeCandidate,
  documents: readonly Pick<VerificationCaseDocument, 'docType' | 'status'>[],
): MissingItem[] {
  if (c.bankingSource === 'plaid') {
    if (!c.plaidConnected) {
      return [{ field: 'plaidConnected', label: 'Plaid bank connection', section: 'banking' }];
    }
    return [];
  }
  const statements = documents.filter(
    (d) => d.docType === 'bank_statement' && d.status === 'received',
  ).length;
  if (statements < REQUIRED_BANK_STATEMENTS) {
    return [
      {
        field: 'bankStatements',
        label: `Last ${REQUIRED_BANK_STATEMENTS} bank statements (${statements} of ${REQUIRED_BANK_STATEMENTS} uploaded)`,
        section: 'banking',
      },
    ];
  }
  return [];
}

/**
 * The verdict. `missing` is ordered by wizard section so the Sales card can list the first few and
 * still be pointing the agent at the earliest unfinished step.
 */
export function evaluateIntakeCompleteness(
  candidate: IntakeCandidate,
  principals: readonly Pick<VerificationCasePrincipal, 'fullName'>[],
  documents: readonly Pick<VerificationCaseDocument, 'docType' | 'status'>[],
): IntakeVerdict {
  const missing: MissingItem[] = [];

  if (!candidate.applicantType) {
    // Without a type we cannot know which flow applies, so this is the only thing worth asking for.
    return {
      complete: false,
      missing: [{ field: 'applicantType', label: 'Applicant type', section: 'applicant' }],
    };
  }

  if (candidate.applicantType === 'owner_operator') {
    missing.push(...ownerOperatorRequirements(candidate));
    missing.push(...identityDocumentRequirements(documents));
  } else {
    missing.push(...carrierRequirements(candidate, candidate.applicantType === 'carrier'));
    if (principals.length === 0) {
      missing.push({
        field: 'principals',
        label: 'At least one owner / principal',
        section: 'principals',
      });
    }
  }

  missing.push(...commonRequirements(candidate));
  missing.push(...bankingRequirements(candidate, documents));

  const order: Record<MissingItem['section'], number> = {
    applicant: 0,
    identity: 1,
    business: 2,
    principals: 3,
    contact: 4,
    request: 5,
    banking: 6,
  };
  missing.sort((a, b) => order[a.section] - order[b.section]);

  return { complete: missing.length === 0, missing };
}

/** Flat keys for `verification_cases.intake_missing` — what the red card renders. */
export function missingFieldKeys(verdict: IntakeVerdict): string[] {
  return verdict.missing.map((m) => m.field);
}
