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
  /**
   * AUTHORITY AGE, which the SOP asks for here ("operating history and authority age") and Phase 9
   * reads again for the risk tier. It was the one item on the SOP's Phase 4 list with no check of its
   * own, so a reviewer had nowhere to record it and Phase 9 had nothing to inherit.
   */
  { id: 'authority_age', label: 'Authority age', missingDoc: { docType: 'authority', label: 'Authority registration date' } },
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

/**
 * WHAT THE WAREHOUSE ALREADY KNOWS — the closest thing to Phase 4's FMCSA lookup that exists today.
 *
 * There is no live FMCSA or QCmobile call in this repo. What there is, is `stg_broker_snapshot`:
 * 542,654 rows of FMCSA-SHAPED carrier data keyed on DOT, carrying `operating_status` and the
 * authority's `add_date`. The Identity pane has been reading it for a while; Phase 4 was marking five
 * checks by hand beside a panel that already held two of the answers.
 *
 * These are SUGGESTIONS, and deliberately partial:
 *
 *  - `dot` / `operating` come from `operatingStatus`. "AUTHORIZED FOR PROPERTY" is an active authority;
 *    anything containing "not authorized" / "out of service" / "inactive" is not.
 *  - `authority_age` is derived from `authorityAddedOn` — a date the warehouse either has or does not.
 *  - `mc` is NOT suggested. The snapshot is keyed and populated on DOT; it carries no MC status, and
 *    inferring one from the DOT's would be an assertion about a different authority.
 *  - `insurance` is NOT suggested. Nothing in the warehouse carries insurance status; that is a
 *    document or a QCmobile lookup, and neither exists here.
 *  - `history` is NOT suggested. "Operating history" is a judgement, not a field.
 *
 * A suggestion is never applied on its own — see the pane. Returning a mark the reviewer did not make
 * would put a name against a check nobody performed.
 */
export interface AuthoritySnapshotFacts {
  dotNumber: string | null;
  operatingStatus: string | null;
  authorityAddedOn: string | null;
}

export interface AuthoritySuggestion {
  mark: AuthorityMark;
  /** The evidence, in the reviewer's own terms — shown beside the suggestion. */
  because: string;
}

const NOT_ACTIVE = ['not authorized', 'out of service', 'inactive', 'revoked', 'suspended'];

export function authorityActiveFromStatus(status: string | null): boolean | null {
  const s = (status ?? '').trim().toLowerCase();
  if (s === '') return null;
  if (NOT_ACTIVE.some((bad) => s.includes(bad))) return false;
  if (s.includes('authorized') || s.includes('active')) return true;
  // A status we do not recognise implies nothing — the reviewer reads it themselves.
  return null;
}

/** Whole years between the authority date and now. Null when the warehouse has no date. */
export function authorityAgeYears(addedOn: string | null, now: number): number | null {
  if (!addedOn) return null;
  const ms = Date.parse(addedOn);
  if (!Number.isFinite(ms) || ms > now) return null;
  return Math.floor((now - ms) / (365.25 * 24 * 60 * 60 * 1000));
}

export function authoritySuggestions(
  snapshot: AuthoritySnapshotFacts | null,
  now: number,
): Record<string, AuthoritySuggestion> {
  if (!snapshot) return {};
  const out: Record<string, AuthoritySuggestion> = {};

  const active = authorityActiveFromStatus(snapshot.operatingStatus);
  if (active !== null) {
    const because = `Warehouse authority status: ${snapshot.operatingStatus}`;
    out.dot = { mark: active ? 'ok' : 'inactive', because };
    out.operating = { mark: active ? 'ok' : 'inactive', because };
  }

  const years = authorityAgeYears(snapshot.authorityAddedOn, now);
  if (years !== null) {
    out.authority_age = {
      mark: 'ok',
      because: `Authority registered ${snapshot.authorityAddedOn} — about ${years} year${years === 1 ? '' : 's'} ago`,
    };
  }

  return out;
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
