/**
 * Phase 4 (Authority & Operating Status) — manual carrier checks from the draft SOP.
 *
 * Owner-operators and companies without MC/DOT never reach this pane (rail `applies: false`).
 * Missing / structure-needed marks reuse the existing document-request door.
 */
import type { VerificationDocType } from '@/api/verificationFlow';

export type AuthorityMark = 'ok' | 'inactive' | 'missing' | 'unresolved';
export type StructureMark = 'na' | 'needed' | 'ok';

export interface AuthorityCheck {
  id: string;
  label: string;
  missingDoc: { docType: VerificationDocType; label: string };
}

export const AUTHORITY_CHECKS: readonly AuthorityCheck[] = [
  { id: 'mc', label: 'MC status', missingDoc: { docType: 'authority', label: 'MC authority' } },
  { id: 'dot', label: 'USDOT status', missingDoc: { docType: 'authority', label: 'USDOT authority' } },
  { id: 'operating', label: 'Operating authority', missingDoc: { docType: 'authority', label: 'Operating authority' } },
  { id: 'insurance', label: 'Insurance status', missingDoc: { docType: 'insurance', label: 'Insurance certificate' } },
  { id: 'history', label: 'Operating history', missingDoc: { docType: 'authority', label: 'Operating history' } },
];

export interface AuthorityMarks {
  checks: Record<string, AuthorityMark>;
  relatedCompany: StructureMark | null;
  thirdParty: StructureMark | null;
}

export const EMPTY_AUTHORITY_MARKS: AuthorityMarks = {
  checks: {},
  relatedCompany: null,
  thirdParty: null,
};

export function authorityChecklistLines(): readonly string[] {
  return [
    ...AUTHORITY_CHECKS.map((c) => c.label),
    'Related-company structure — Corporate Guarantee',
    'Third-party carrier — Lease agreement and unit info',
  ];
}

export function authorityCanPass(marks: AuthorityMarks): boolean {
  const checksOk = AUTHORITY_CHECKS.every((c) => marks.checks[c.id] === 'ok');
  if (!checksOk) return false;
  if (marks.relatedCompany === 'needed') return false;
  if (marks.thirdParty === 'needed') return false;
  return true;
}

export function missingAuthorityDocs(
  marks: AuthorityMarks,
): Array<{ docType: VerificationDocType; label: string }> {
  const seen = new Set<string>();
  const items: Array<{ docType: VerificationDocType; label: string }> = [];
  const push = (doc: { docType: VerificationDocType; label: string }): void => {
    const key = `${doc.docType}:${doc.label}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(doc);
  };
  for (const check of AUTHORITY_CHECKS) {
    if (marks.checks[check.id] === 'missing') push(check.missingDoc);
  }
  if (marks.relatedCompany === 'needed') {
    push({ docType: 'corporate_guarantee', label: 'Corporate guarantee' });
  }
  if (marks.thirdParty === 'needed') {
    push({ docType: 'lease_agreement', label: 'Lease agreement' });
    push({ docType: 'other', label: 'Unit information' });
  }
  return items;
}
