/**
 * Phase 4 (Authority & Operating Status) — the carrier checks, and what now answers them.
 *
 * Owner-operators and companies without MC/DOT never reach this pane (rail `applies: false`).
 * Missing / structure-needed marks reuse the existing document-request door.
 *
 * TWO SUGGESTION SOURCES LIVE HERE, and they are not interchangeable. `authoritySuggestions` reads the
 * DWH broker snapshot — the offline fallback, which matched about a quarter of cases when measured and
 * carries no MC status and no insurance at all. `authoritySuggestionsFromRun` reads the FMCSA register
 * and the FMCSA census, which between them answer five of the six checks. Both are SUGGESTIONS a
 * reviewer applies by hand; neither ever marks anything.
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
 * WHAT THE WAREHOUSE ALREADY KNOWS — the offline fallback, kept for when the register cannot be read.
 *
 * A live FMCSA lookup DOES exist now (`authoritySuggestionsFromRun`), but it is denied to non-US
 * egress at the edge, so off-Render this is all there is. `stg_broker_snapshot` holds
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

// ---- The register run, read off the phase's own findings ---------------------------------------

/**
 * What `runAuthorityLookup` wrote, narrowed. Same shape of contract as Phase 3's `screeningRunFrom`:
 * the run persists it, so it survives a remount and a reload, and `available: false` is NEVER a clear.
 *
 * FOUR SOURCES, AND THEIR FRESHNESS IS PART OF THE ANSWER. The FMCSA register is the source of truth
 * but is denied to non-US egress at the edge, so off-Render `register.available` is false with
 * `reason: 'blocked'` — which says nothing whatever about the carrier. The Socrata census is live. The
 * insurance feed is FROZEN at `dataAsOf` and only looks fresh because Socrata republishes it wholesale.
 */
export type AuthorityUnavailableReason =
  | 'not_configured'
  | 'blocked'
  | 'auth'
  | 'maintenance'
  | 'transport'
  | 'http';

export interface AuthorityRunSource {
  available: boolean;
  error: string | null;
}

export interface AuthorityRunFindings {
  ranAt: string;
  keys: {
    dot: string | null;
    mc: string | null;
    carrierDot: string | null;
    authorityNumbersIdentical: boolean;
    carrierDotDisagrees: boolean;
  };
  register: AuthorityRunSource & {
    reason: AuthorityUnavailableReason | null;
    notFound: boolean;
    matchedOn: 'dot' | 'mc' | 'name' | null;
    statusVerdict: 'active' | 'inactive' | 'unknown' | null;
    statusCode: string | null;
    allowedToOperate: 'yes' | 'no' | 'unknown' | null;
    /** Dollars, already multiplied out of the register's thousands. Null when absent, 0 when none. */
    bipdDollars: number | null;
    bipdOnFile: boolean | null;
    totalPowerUnits: number | null;
    legalName: string | null;
    candidateCount: number;
  };
  operatingAuthority: AuthorityRunSource & { recordCount: number; anyActive: boolean };
  census: AuthorityRunSource & {
    statusCode: string | null;
    statusLabel: string | null;
    powerUnits: number | null;
    addDate: string | null;
    mcDocket: string | null;
    mcStatusCode: string | null;
  };
  insurance: AuthorityRunSource & {
    frozen: boolean;
    dataAsOf: string | null;
    bipdActive: number;
    bipdCoverageDollars: number | null;
  };
}

function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}
function n(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function t(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}
function bool(value: unknown): boolean {
  return value === true;
}

export function authorityRunFrom(
  findings: Record<string, unknown> | null | undefined,
): AuthorityRunFindings | null {
  if (!findings || typeof findings !== 'object') return null;
  const ranAt = t(findings.ranAt);
  if (!ranAt) return null;

  const keys = obj(findings.keys) ?? {};
  const reg = obj(findings.register) ?? {};
  const carrier = obj(reg.carrier);
  const insLines = obj(carrier?.insurance);
  const bipd = obj(insLines?.bipd);
  const auth = obj(findings.operatingAuthority) ?? {};
  const cen = obj(findings.census) ?? {};
  const record = obj(cen.record);
  const dockets = Array.isArray(record?.dockets) ? record.dockets : [];
  const firstDocket = obj(dockets[0]);
  const ins = obj(findings.insurance) ?? {};
  const authRecords = Array.isArray(auth.records) ? auth.records : [];

  const verdict = t(carrier?.status);
  return {
    ranAt,
    keys: {
      dot: t(keys.dot),
      mc: t(keys.mc),
      carrierDot: t(keys.carrierDot),
      authorityNumbersIdentical: bool(keys.authorityNumbersIdentical),
      carrierDotDisagrees: bool(keys.carrierDotDisagrees),
    },
    register: {
      available: bool(reg.available),
      error: t(reg.error),
      reason: (t(reg.reason) as AuthorityUnavailableReason | null) ?? null,
      notFound: bool(reg.notFound),
      matchedOn: (t(reg.matchedOn) as 'dot' | 'mc' | 'name' | null) ?? null,
      statusVerdict:
        verdict === 'active' || verdict === 'inactive' || verdict === 'unknown' ? verdict : null,
      statusCode: t(carrier?.statusCode),
      allowedToOperate:
        t(carrier?.allowedToOperate) === 'yes'
          ? 'yes'
          : t(carrier?.allowedToOperate) === 'no'
            ? 'no'
            : t(carrier?.allowedToOperate) === 'unknown'
              ? 'unknown'
              : null,
      // The register serves these as dollar strings in THOUSANDS; the client parsed them already.
      bipdDollars: n(bipd?.dollars),
      bipdOnFile: bipd === null ? null : bool(bipd.onFile),
      totalPowerUnits: n(carrier?.totalPowerUnits),
      legalName: t(carrier?.legalName),
      candidateCount: Array.isArray(reg.candidates) ? reg.candidates.length : 0,
    },
    operatingAuthority: {
      available: bool(auth.available),
      error: t(auth.error),
      recordCount: authRecords.length,
      anyActive: authRecords.some((rec) => {
        const r = obj(rec);
        return t(obj(r?.common)?.verdict) === 'active' || t(obj(r?.contract)?.verdict) === 'active';
      }),
    },
    census: {
      available: bool(cen.available),
      error: t(cen.error),
      statusCode: t(record?.statusCode),
      statusLabel: t(record?.statusLabel),
      powerUnits: n(record?.powerUnits),
      addDate: t(record?.addDate),
      mcDocket: firstDocket === null ? null : t(firstDocket.number),
      mcStatusCode: firstDocket === null ? null : t(firstDocket.statusCode),
    },
    insurance: {
      available: bool(ins.available),
      error: t(ins.error),
      frozen: bool(ins.frozen),
      dataAsOf: t(ins.dataAsOf),
      bipdActive: n(ins.bipdActive) ?? 0,
      bipdCoverageDollars: n(ins.bipdCoverageDollars),
    },
  };
}

/**
 * The marks the RUN implies, each with the evidence that produced it.
 *
 * EVERY ONE IS WITHHELD WHEN ITS SOURCE WENT QUIET, in a pure function rather than a JSX conditional,
 * because that is the rule Phase 3 already follows: a mark of `ok` is a CLEAR, and a clear may only
 * come from a source that actually answered. Off-Render the register is denied at the edge, so the
 * census carries USDOT status / authority age / MC status on its own — and insurance carries NONE of
 * them, which is why `insurance` is suggested only from the live register and never from the frozen feed.
 *
 * `history` is never suggested. "Operating history" is a judgement, not a field, in any of these sources.
 */
export function authoritySuggestionsFromRun(
  run: AuthorityRunFindings | null,
  now: number,
): Record<string, AuthoritySuggestion> {
  if (!run) return {};
  const out: Record<string, AuthoritySuggestion> = {};

  // USDOT status — the register first, the census when the register is unreachable.
  if (run.register.available && run.register.statusVerdict !== null) {
    const code = run.register.statusCode ?? '?';
    out.dot =
      run.register.statusVerdict === 'active'
        ? { mark: 'ok', because: `FMCSA register: status ${code}, allowed to operate` }
        : run.register.statusVerdict === 'inactive'
          ? { mark: 'inactive', because: `FMCSA register: status ${code}` }
          : { mark: 'unresolved', because: `FMCSA register returned status ${code}, which is not A or I` };
  } else if (run.census.available && run.census.statusCode !== null) {
    const label = run.census.statusLabel ?? run.census.statusCode;
    out.dot =
      run.census.statusCode === 'A'
        ? { mark: 'ok', because: `FMCSA census: ${label}` }
        : run.census.statusCode === 'I'
          ? { mark: 'inactive', because: `FMCSA census: ${label}` }
          : { mark: 'unresolved', because: `FMCSA census: ${label}` };
  }

  // Operating authority — the grant records, else the census docket status.
  if (run.operatingAuthority.available && run.operatingAuthority.recordCount > 0) {
    out.operating = run.operatingAuthority.anyActive
      ? { mark: 'ok', because: `${run.operatingAuthority.recordCount} authority record(s), common or contract active` }
      : { mark: 'inactive', because: `${run.operatingAuthority.recordCount} authority record(s), none active` };
  } else if (run.census.available && run.census.mcStatusCode !== null) {
    out.operating =
      run.census.mcStatusCode === 'A'
        ? { mark: 'ok', because: `FMCSA census docket status A` }
        : { mark: 'inactive', because: `FMCSA census docket status ${run.census.mcStatusCode}` };
  }

  // MC status. The census is the ONLY offline source that carries it — the DWH snapshot has no MC
  // column at all — so a docket here is worth more than its 39.8% fill rate suggests.
  if (run.census.available && run.census.mcDocket !== null && run.census.mcStatusCode !== null) {
    out.mc =
      run.census.mcStatusCode === 'A'
        ? { mark: 'ok', because: `MC ${run.census.mcDocket} — census status A` }
        : { mark: 'inactive', because: `MC ${run.census.mcDocket} — census status ${run.census.mcStatusCode}` };
  }

  /**
   * INSURANCE COMES ONLY FROM THE LIVE REGISTER. The Socrata insurance feed is frozen, and 4.7% of the
   * carriers it calls insured have already passed their cancellation date — so it may inform a reviewer
   * but must never suggest a mark. `bipdOnFile === false` is a real finding: BIPD required, none filed.
   */
  if (run.register.available && run.register.bipdOnFile !== null) {
    out.insurance = run.register.bipdOnFile
      ? {
          mark: 'ok',
          because: `FMCSA register: BIPD on file${
            run.register.bipdDollars === null ? '' : ` (${formatDollars(run.register.bipdDollars)})`
          }`,
        }
      : { mark: 'inactive', because: 'FMCSA register: no BIPD liability on file' };
  }

  // Authority age — the census `add_date`, the one field it fills on every single row.
  const years = authorityAgeYears(run.census.addDate, now);
  if (run.census.available && years !== null) {
    out.authority_age = {
      mark: 'ok',
      because: `Authority registered ${run.census.addDate} — about ${years} year${years === 1 ? '' : 's'} ago`,
    };
  }

  return out;
}

/** Whole dollars, no cents — these are policy minimums like $750,000, never exact balances. */
export function formatDollars(dollars: number): string {
  return dollars.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 0,
  });
}

/** Which sources the run could not reach, named with what each absence costs. */
export function authorityUnreachable(
  run: AuthorityRunFindings | null,
): Array<{ id: string; label: string; detail: string }> {
  if (!run) return [];
  const out: Array<{ id: string; label: string; detail: string }> = [];
  if (!run.register.available) {
    out.push({
      id: 'register',
      label: 'The FMCSA register',
      detail:
        run.register.reason === 'blocked'
          ? 'this deployment’s IP is denied at the FMCSA edge — permanent off the US server, and it says nothing about the carrier'
          : (run.register.error ??
            'QCMobile did not answer, so MC/USDOT status and insurance went unchecked'),
    });
  }
  if (!run.census.available) {
    out.push({
      id: 'census',
      label: 'The FMCSA census',
      detail: run.census.error ?? 'the census did not answer, so USDOT status and authority age went unchecked',
    });
  }
  if (!run.insurance.available) {
    out.push({
      id: 'insurance',
      label: 'Insurance filing history',
      detail: run.insurance.error ?? 'the filing history did not answer',
    });
  }
  return out;
}
