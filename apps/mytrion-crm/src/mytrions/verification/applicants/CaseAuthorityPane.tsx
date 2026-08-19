/**
 * Phase 4 working pane — MC/DOT against the warehouse snapshot, then mark authority.
 *
 * PARTLY AUTOMATED NOW. There is no live FMCSA or QCmobile call in this repo, but `stg_broker_snapshot`
 * holds 542,654 rows of FMCSA-shaped carrier data keyed on DOT — including `operating_status` and the
 * authority's `add_date`. This pane was already fetching it and printing three lines of it beside five
 * checks the reviewer then answered from scratch. `authoritySuggestions` turns what the warehouse knows
 * into proposed marks with their evidence attached; the reviewer applies them, one at a time or all at
 * once, and can overrule any of them. Nothing is marked on its own — a check nobody performed must not
 * carry somebody's name.
 *
 * What is NOT suggested is as deliberate as what is: MC status (the snapshot is DOT-keyed and carries
 * no MC authority), insurance (nothing here holds it) and operating history (a judgement). Those stay
 * blank so the gap is visible rather than filled with a guess.
 */
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Icon, Input } from '@/ds';
import {
  getDeskBrokerSnapshot,
  type BrokerSnapshotMatch,
} from '@/api/verificationDeskWrites';
import type { VerificationApplicantType, VerificationDeskDetail } from '@/api/verificationFlow';
import { CaseMarkGroup, type MarkOption } from './CaseMarkGroup';
import {
  AUTHORITY_CHECKS,
  authorityAgeYears,
  authoritySuggestions,
  type AuthorityMark,
  type AuthorityMarks,
  type StructureMark,
} from './caseAuthority';

/**
 * `inactive` is `bad` and `missing` is `warn`, for the same reason as Phase 2: missing is an ASK that
 * routes a document request to Sales, while an inactive authority is a finding about the applicant.
 * `unresolved` is `warn` — it is the reviewer saying they could not settle it, which needs a manager.
 */
const CHECK_MARKS: ReadonlyArray<MarkOption<AuthorityMark>> = [
  { id: 'ok', label: 'OK', icon: 'check_circle', tone: 'good', hint: 'Active and consistent' },
  { id: 'inactive', label: 'Inactive', icon: 'block', tone: 'bad', hint: 'Not active — goes to Manager Review' },
  {
    id: 'missing',
    label: 'Missing',
    icon: 'cloud_upload',
    tone: 'warn',
    hint: 'Not on file — passing the phase requests it from Sales',
  },
  { id: 'unresolved', label: 'Unresolved', icon: 'warning', tone: 'warn', hint: 'Could not settle it' },
];

const STRUCTURE_MARKS: ReadonlyArray<MarkOption<StructureMark>> = [
  { id: 'na', label: 'N/A', icon: 'check_circle', tone: 'good', hint: 'Does not apply to this applicant' },
  {
    id: 'needed',
    label: 'Needed',
    icon: 'cloud_upload',
    tone: 'warn',
    hint: 'Requests the document from Sales',
  },
  { id: 'ok', label: 'On file', icon: 'check_circle', tone: 'good', hint: 'Attached and acceptable' },
];

function text(value: unknown): string {
  if (value == null) return '—';
  const s = String(value).trim();
  return s === '' ? '—' : s;
}

export function AuthorityPane({
  detail,
  caseId,
  marks,
  onMarks,
}: {
  detail: VerificationDeskDetail;
  caseId: string;
  marks: AuthorityMarks;
  onMarks: (next: AuthorityMarks) => void;
}) {
  const c = detail.case as VerificationDeskDetail['case'] & Record<string, unknown>;
  const [snapshot, setSnapshot] = useState<BrokerSnapshotMatch | null>(null);
  const [snapState, setSnapState] = useState<'loading' | 'ready' | 'none'>('loading');
  const received = detail.documents.filter((d) => d.status === 'received');

  useEffect(() => {
    let live = true;
    setSnapState('loading');
    getDeskBrokerSnapshot(caseId)
      .then((res) => {
        if (!live) return;
        setSnapshot(res.match);
        setSnapState(res.match ? 'ready' : 'none');
      })
      .catch(() => {
        if (!live) return;
        setSnapshot(null);
        setSnapState('none');
      });
    return () => {
      live = false;
    };
  }, [caseId]);

  const setCheck = (id: string, mark: AuthorityMark): void => {
    onMarks({ ...marks, checks: { ...marks.checks, [id]: mark } });
  };

  // One clock for the pane, so the authority age in the snapshot column and the one in the suggestion
  // cannot disagree by a day mid-render.
  const now = useMemo(() => Date.now(), [snapshot]);
  const suggestions = useMemo(() => authoritySuggestions(snapshot, now), [snapshot, now]);
  const ageYears = authorityAgeYears(snapshot?.authorityAddedOn ?? null, now);
  const outstanding = Object.entries(suggestions).filter(([id, s]) => marks.checks[id] !== s.mark);

  const applyAll = (): void => {
    const next = { ...marks.checks };
    for (const [id, s] of outstanding) next[id] = s.mark;
    onMarks({ ...marks, checks: next });
  };

  return (
    <div className="va-stack">
      <div className="va-pane-head">
        <h3 className="t-eyebrow va-pane-kicker">Authority & operating status</h3>
        <span className="va-pane-note">
          {snapState === 'ready'
            ? 'Warehouse snapshot found — suggestions below, yours to apply'
            : 'No warehouse match — decide from the application and files'}
        </span>
      </div>

      <div className="va-id-compare">
        <section className="va-id-col">
          <h4 className="va-field-label">On the application</h4>
          <p className="va-pane-body">{text(c.companyName)}</p>
          <p className="va-pane-body">MC: {text(c.mc)}</p>
          <p className="va-pane-body">USDOT: {text(c.dot)}</p>
        </section>
        <section className="va-id-col">
          <h4 className="va-field-label">Broker snapshot</h4>
          {snapState === 'loading' ? (
            <p className="va-pane-body">Looking up carrier records…</p>
          ) : snapState === 'none' ? (
            <p className="va-pane-body">No warehouse match — decide from the application and files.</p>
          ) : (
            <>
              <p className="va-pane-body">USDOT: {text(snapshot?.dotNumber)}</p>
              <p className="va-pane-body">Authority status: {text(snapshot?.operatingStatus)}</p>
              <p className="va-pane-body">
                Authority since: {text(snapshot?.authorityAddedOn)}
                {ageYears !== null ? ` · about ${ageYears} year${ageYears === 1 ? '' : 's'}` : ''}
              </p>
              {/* WHAT THE SNAPSHOT CANNOT ANSWER, named. MC status, insurance and operating history are
                  absent from the warehouse, and a reviewer who is not told that reads three blank
                  checks as three things the lookup cleared. */}
              <p className="va-aside-note">
                No MC status, insurance or operating history here — those stay yours.
              </p>
            </>
          )}
        </section>
        <section className="va-id-col">
          <h4 className="va-field-label">Files received</h4>
          {received.length === 0 ? (
            <p className="va-pane-body">None yet — attach from Documents.</p>
          ) : (
            received.map((d) => (
              <p className="va-pane-body" key={d.id}>
                {d.label ?? d.fileName ?? d.docType}
              </p>
            ))
          )}
        </section>
      </div>

      {/* THE SUGGESTIONS, and the one control that takes them all. Never applied on their own — the
          reviewer's name goes on the phase decision, so the marks have to be theirs. */}
      {outstanding.length > 0 ? (
        <div className="va-ask">
          <span className="va-aside-note">
            The warehouse snapshot answers {outstanding.length} of these {AUTHORITY_CHECKS.length}{' '}
            checks. Applying fills the mark; the evidence stays on the row.
          </span>
          <div className="va-ask-actions">
            <Button variant="secondary" size="sm" icon="check" onClick={applyAll}>
              Apply {outstanding.length} suggestion{outstanding.length === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="va-id-checks">
        {AUTHORITY_CHECKS.map((check) => {
          const mark = marks.checks[check.id];
          const suggestion = suggestions[check.id];
          return (
            <div className="va-id-check" key={check.id} data-mark={mark ?? 'unset'}>
              <div className="va-id-check-copy">
                <span className="va-id-check-label">
                  {check.label}
                  {suggestion && mark !== suggestion.mark ? (
                    <Badge intent="info" size="sm" icon="auto_awesome">
                      Suggested: {CHECK_MARKS.find((m) => m.id === suggestion.mark)?.label}
                    </Badge>
                  ) : null}
                </span>
                {/* THE EVIDENCE, not just the verdict. A suggestion the reviewer cannot check is one
                    they have to redo by hand anyway. */}
                <span className="va-id-check-value">
                  {suggestion
                    ? suggestion.because
                    : 'Not in the warehouse — read it from the application and the files.'}
                </span>
              </div>
              <CaseMarkGroup
                ariaLabel={check.label}
                options={CHECK_MARKS}
                value={mark ?? null}
                onChange={(next) => setCheck(check.id, next)}
              />
            </div>
          );
        })}
        <div className="va-id-check" data-mark={marks.relatedCompany ?? 'unset'}>
          <div className="va-id-check-copy">
            <span className="va-id-check-label">Related-company structure</span>
            <span className="va-id-check-value">Corporate Guarantee if a related company is in the picture</span>
          </div>
          <CaseMarkGroup
            ariaLabel="Related-company structure"
            options={STRUCTURE_MARKS}
            value={marks.relatedCompany}
            onChange={(next) => onMarks({ ...marks, relatedCompany: next })}
          />
        </div>
        <div className="va-id-check" data-mark={marks.thirdParty ?? 'unset'}>
          <div className="va-id-check-copy">
            <span className="va-id-check-label">Third-party carrier</span>
            <span className="va-id-check-value">Lease agreement and unit information if they are not the authority holder</span>
          </div>
          <CaseMarkGroup
            ariaLabel="Third-party carrier"
            options={STRUCTURE_MARKS}
            value={marks.thirdParty}
            onChange={(next) => onMarks({ ...marks, thirdParty: next })}
          />
        </div>
      </div>
    </div>
  );
}

const TYPE_OPTIONS = [
  { value: 'owner_operator', label: 'Owner-Operator / Individual' },
  { value: 'carrier', label: 'Carrier (Company)' },
] as const;

function typeValue(raw: string): VerificationApplicantType {
  return raw === 'owner_operator' ? 'owner_operator' : 'carrier';
}

/**
 * Phase 4 when the rail says N/A — still let the desk correct the fields that decide applicability.
 * Type + MC/USDOT only; attachments stay on the aside.
 */
export function AuthorityFallbackPane({
  detail,
  closed,
  busy,
  skipReason,
  onSave,
}: {
  detail: VerificationDeskDetail;
  closed: boolean;
  busy: boolean;
  skipReason: string | null;
  onSave: (body: Record<string, unknown>) => Promise<void>;
}) {
  const c = detail.case as VerificationDeskDetail['case'] & Record<string, unknown>;
  const [applicantType, setApplicantType] = useState(
    typeValue(String(c.applicantType ?? 'owner_operator')),
  );
  const [mc, setMc] = useState(c.mc == null ? '' : String(c.mc));
  const [dot, setDot] = useState(c.dot == null ? '' : String(c.dot));

  const disabled = closed || busy;

  return (
    <div className="va-skipped" data-fill>
      <div className="va-skipped-lead">
        <span className="va-skipped-glyph" aria-hidden="true">
          <Icon name="block" size="sm" />
        </span>
        <span className="va-skipped-text">
          <span className="va-skipped-title">Not applicable to this applicant</span>
          <span className="va-pane-body">
            {skipReason ?? 'This phase does not apply to this applicant type.'}
          </span>
        </span>
      </div>
      <p className="va-pane-body">
        If they hold MC/DOT authority after all, correct the type and numbers. Saving does not touch
        the rest of the application or the files.
      </p>
      <div className="va-fields">
        <div className="va-field">
          <label className="va-field-label" htmlFor="va-p4-type">
            Applicant type
          </label>
          <select
            id="va-p4-type"
            aria-label="Applicant type"
            className="va-type-select"
            value={applicantType}
            disabled={disabled}
            onChange={(e) => setApplicantType(typeValue(e.currentTarget.value))}
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="va-field">
          <label className="va-field-label" htmlFor="va-p4-mc">
            MC number
          </label>
          <Input
            id="va-p4-mc"
            value={mc}
            placeholder="Not recorded"
            disabled={disabled}
            fullWidth
            onChange={(e) => setMc(e.currentTarget.value)}
          />
        </div>
        <div className="va-field">
          <label className="va-field-label" htmlFor="va-p4-dot">
            USDOT
          </label>
          <Input
            id="va-p4-dot"
            value={dot}
            placeholder="Not recorded"
            disabled={disabled}
            fullWidth
            onChange={(e) => setDot(e.currentTarget.value)}
          />
        </div>
      </div>
      {closed ? null : (
        <div className="va-save">
          <Button
            variant="primary"
            icon="save"
            loading={busy}
            disabled={disabled}
            onClick={() =>
              void onSave({
                applicantType,
                mc: mc.trim() === '' ? null : mc.trim(),
                dot: dot.trim() === '' ? null : dot.trim(),
              })
            }
          >
            Save corrections
          </Button>
        </div>
      )}
    </div>
  );
}
