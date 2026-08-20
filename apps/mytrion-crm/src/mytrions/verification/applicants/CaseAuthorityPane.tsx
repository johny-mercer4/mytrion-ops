/**
 * Phase 4 working pane — the FMCSA register and census, then mark authority.
 *
 * AUTOMATED NOW, AND HONEST ABOUT WHICH HALF ANSWERED. `runAuthorityLookup` reads four sources: the
 * QCMobile register (source of truth for MC/USDOT status, operating authority and INSURANCE), the
 * FMCSA census (live, and the only offline source carrying MC status — the DWH snapshot has no MC
 * column at all), the insurance filing history (FROZEN, labelled as such) and the DWH broker snapshot
 * this pane already read. Between them they answer five of the six checks; `history` stays a judgement.
 *
 * THE REGISTER IS UNREACHABLE OFF-RENDER, and that is a first-class state rather than an error. Every
 * fmcsa.dot.gov host denies non-US egress at the edge, so `reason: 'blocked'` means "we could not ask",
 * which says nothing whatever about the carrier. It gets the same treatment Phase 3 gives an
 * unreadable ban list: ONE collapsed banner listing what went quiet, and the suggestion withheld.
 *
 * SUGGESTIONS ARE PER CHECK, and per check is the point. This pane used to offer a single "Apply N
 * suggestions" button, so a reviewer either took the warehouse's word on everything or typed all six
 * by hand. Each row now carries its own evidence and its own control, matching the Phase 3 screening
 * pane — and nothing is ever marked on its own, because a check nobody performed must not carry
 * somebody's name.
 *
 * WHAT WAS ALSO WRONG HERE: the pane took no `canAct` and no `pending`, so every mark group stayed
 * live on a case that had already been decided, and the three-column prose block printed the same
 * facts as sentences at three different x-positions.
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
  authorityRunFrom,
  authoritySuggestions,
  authoritySuggestionsFromRun,
  authorityUnreachable,
  formatDollars,
  type AuthorityMark,
  type AuthorityMarks,
  type AuthoritySuggestion,
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

/**
 * `na` and `ok` were BOTH `check_circle` with tone `good`, so "does not apply" and "on file and
 * acceptable" were distinguishable only by their label — colour as the sole channel, which the house
 * accessibility floor forbids. `na` is now a block glyph: it is the absence of a requirement, not the
 * satisfaction of one.
 */
const STRUCTURE_MARKS: ReadonlyArray<MarkOption<StructureMark>> = [
  { id: 'na', label: 'N/A', icon: 'block', tone: 'good', hint: 'Does not apply to this applicant' },
  {
    id: 'needed',
    label: 'Needed',
    icon: 'cloud_upload',
    tone: 'warn',
    hint: 'Requests the document from Sales',
  },
  { id: 'ok', label: 'On file', icon: 'check_circle', tone: 'good', hint: 'Attached and acceptable' },
];

/** Short local timestamp for "when the register was read". Empty on anything unparseable. */
function whenText(iso: string | null): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

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
  canAct,
  canScreen,
  running,
  onRun,
}: {
  detail: VerificationDeskDetail;
  caseId: string;
  marks: AuthorityMarks;
  onMarks: (next: AuthorityMarks) => void;
  /** Whether the case is DECIDABLE. False on a red or decided case — the marks go read-only. */
  canAct: boolean;
  /** Whether the register may be READ. Weaker than `canAct`: only a decided case is out of reach. */
  canScreen: boolean;
  running: boolean;
  onRun: () => void;
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
  const phase = detail.rail.find((p) => p.code === 'p4_authority');
  const run = authorityRunFrom(phase?.findings);
  /**
   * THE REGISTER WINS WHERE IT ANSWERED, the warehouse fills the rest.
   *
   * Both are suggestion sources and they overlap on `dot` / `operating` / `authority_age`. The register
   * and the census are the federal record; `stg_broker_snapshot` is a lagging warehouse copy that
   * matched about a quarter of cases. So the run is spread LAST and takes precedence per check — and
   * the row shows whichever one produced the value, so provenance is never guessed.
   */
  const suggestions: Record<string, AuthoritySuggestion> = {
    ...authoritySuggestions(snapshot, now),
    ...authoritySuggestionsFromRun(run, now),
  };
  const ageYears = authorityAgeYears(snapshot?.authorityAddedOn ?? null, now);
  const outstanding = Object.entries(suggestions).filter(([id, s]) => marks.checks[id] !== s.mark);
  const unreachable = authorityUnreachable(run);
  // Deliberately NOT a second loading affordance: the pane already has one, on the Run control. This
  // only distinguishes "the warehouse answered and had nothing" from "we have not asked yet".
  const warehouseSilent = snapState === 'none';
  const registerName = run?.register.legalName ?? null;

  const applyAll = (): void => {
    const next = { ...marks.checks };
    for (const [id, s] of outstanding) next[id] = s.mark;
    onMarks({ ...marks, checks: next });
  };

  return (
    <div className="va-stack">
      <div className="va-pane-head">
        <h3 className="t-eyebrow va-pane-kicker">Authority &amp; operating status</h3>
        <span className="va-pane-note">
          {run
            ? `Register read ${whenText(run.ranAt)}${registerName ? ` · ${registerName}` : ''}`
            : 'Read the FMCSA register, then rule on what it found'}
        </span>
      </div>

      {/* THE IDENTIFIERS THE LOOKUP USES, stated once as a grid rather than three columns of prose.
          Values scanned for agreement are read by their values, and a label-per-line puts every value
          at a different x — the same reason the Phase 3 pane collapsed its two fact columns into one. */}
      <div className="va-recorded" data-stack="true">
        <div className="va-pane-head">
          <h4 className="t-eyebrow va-pane-kicker">Authority numbers</h4>
          <Button
            variant={run ? 'secondary' : 'primary'}
            size="sm"
            icon="restart_alt"
            loading={running}
            disabled={!canScreen}
            onClick={onRun}
          >
            {run ? 'Read the register again' : 'Read the register'}
          </Button>
        </div>
        <div className="va-figs">
          <span className="va-fig">
            <span className="t-eyebrow">Company</span>
            <span className="va-fig-v" data-wrap data-empty={c.companyName ? undefined : true}>
              {text(c.companyName)}
            </span>
          </span>
          <span className="va-fig">
            <span className="t-eyebrow">MC</span>
            <span className="va-fig-v" data-empty={c.mc ? undefined : true}>{text(c.mc)}</span>
          </span>
          <span className="va-fig">
            <span className="t-eyebrow">USDOT</span>
            <span className="va-fig-v" data-empty={c.dot ? undefined : true}>{text(c.dot)}</span>
          </span>
          <span className="va-fig">
            <span className="t-eyebrow">Warehouse USDOT</span>
            <span className="va-fig-v" data-empty={snapshot?.dotNumber ? undefined : true}>
              {text(snapshot?.dotNumber)}
            </span>
          </span>
          <span className="va-fig">
            <span className="t-eyebrow">Fleet (register)</span>
            <span className="va-fig-v" data-empty={run?.register.totalPowerUnits == null ? true : undefined}>
              {run?.register.totalPowerUnits ?? run?.census.powerUnits ?? '—'}
            </span>
          </span>
          <span className="va-fig">
            <span className="t-eyebrow">Authority since</span>
            <span
              className="va-fig-v"
              data-empty={run?.census.addDate ?? snapshot?.authorityAddedOn ? undefined : true}
            >
              {/* The census fills this on 100% of its rows; the warehouse date is the fallback, and
                  its age is worth printing because Phase 9 reads authority age again for the tier. */}
              {run?.census.addDate ??
                (snapshot?.authorityAddedOn
                  ? `${snapshot.authorityAddedOn}${ageYears === null ? '' : ` · ~${ageYears}y`}`
                  : '—')}
            </span>
          </span>
        </div>

        {/* WHY THE CONTROL IS OFF, when it is. `runAuthorityLookup` goes through `loadScreenable`,
            which allows a case Sales has not finished and refuses a DECIDED one — re-reading the
            register afterwards would rewrite the findings the decision was recorded against. */}
        {!canScreen ? (
          <p className="va-aside-note">
            This application has been decided, so the register can no longer be read — it would
            rewrite the findings the decision rests on.
          </p>
        ) : !canAct ? (
          <p className="va-aside-note">
            Sales has not submitted this application yet. The register still reads — MC and USDOT
            arrive with the Deal — but the marks below need the complete file.
          </p>
        ) : null}

        {/* WHAT IS ALREADY ON FILE. Phase 4 asks for an authority document and an insurance
            certificate when a check comes back missing, so the reviewer needs to see what has already
            arrived without leaving for the Documents pane. One line, not a third column. */}
        <p className="va-aside-note">
          {received.length === 0
            ? 'No documents received yet — a missing mark below requests one from Sales.'
            : `On file: ${received
                .map((d) => d.label ?? d.fileName ?? d.docType)
                .join(' · ')}`}
        </p>

        {/* TWO AUTHORITY NUMBERS THAT AGREE ARE ONE NUMBER. Measured: 10 of our 15 both-filled cases
            have identical digits in the MC and USDOT columns, so "we checked both" would be false. */}
        {run?.keys.authorityNumbersIdentical ? (
          <p className="va-aside-note">
            The MC and USDOT columns hold the <strong>same digits</strong>, so this is one authority
            number in two boxes — not two independent confirmations.
          </p>
        ) : null}
        {run?.keys.carrierDotDisagrees ? (
          <p className="va-aside-note">
            The application&rsquo;s USDOT and the warehouse&rsquo;s disagree
            {run.keys.dot && run.keys.carrierDot ? ` (${run.keys.dot} vs ${run.keys.carrierDot})` : ''}.
            Worth settling before trusting either &mdash; a mistyped authority number reads as a clean
            lookup of somebody else.
          </p>
        ) : null}
      </div>

      {warehouseSilent && !run ? (
        <p className="va-aside-note">
          No warehouse match for this carrier, and the register has not been read yet.
        </p>
      ) : null}

      {/* WHAT THE RUN COULD NOT REACH — ONE banner, however many sources went quiet, polite rather
          than assertive because it is the result of a button the reviewer just pressed. Two live
          regions announce over each other; the sources are a list so the count is one glance. */}
      {unreachable.length > 0 ? (
        <div className="va-banner" data-tone="warning" role="status">
          <span className="va-banner-glyph" aria-hidden="true">
            <Icon name="warning" size="sm" />
          </span>
          <span className="va-banner-text">
            <span className="va-banner-title">
              {unreachable.length === 1
                ? `${unreachable[0]!.label} was not read`
                : `${unreachable.length} of this run\u2019s sources were not read`}
            </span>
            <p className="va-banner-body">
              Nothing was cleared there, so those checks stay yours. Suggestions are withheld for them.
            </p>
            <ul className="va-banner-list">
              {unreachable.map((source) => (
                <li key={source.id}>
                  <strong>{source.label}</strong> &mdash; {source.detail}
                </li>
              ))}
            </ul>
          </span>
        </div>
      ) : null}

      {/* THE REGISTER SAID THIS CARRIER DOES NOT EXIST. A clean not-found is an ANSWER, and a strong
          one on a carrier application — distinct from a lookup that failed, which is the banner above. */}
      {run?.register.available && run.register.notFound ? (
        <div className="va-banner" data-tone="danger">
          <span className="va-banner-glyph" aria-hidden="true">
            <Icon name="block" size="sm" />
          </span>
          <span className="va-banner-text">
            <span className="va-banner-title">The FMCSA register has no such carrier</span>
            <p className="va-banner-body">
              The lookup succeeded and returned nothing for
              {run.keys.dot ? ` USDOT ${run.keys.dot}` : ''}
              {run.keys.mc ? `${run.keys.dot ? ' or' : ''} MC ${run.keys.mc}` : ''}. That is an answer,
              not a failure &mdash; an applicant claiming authority they do not hold.
            </p>
          </span>
        </div>
      ) : null}

      {/* MORE THAN ONE CANDIDATE IS A QUESTION, NOT A MATCH. The name rung never auto-picks. */}
      {run && run.register.candidateCount > 0 && run.register.matchedOn === null ? (
        <p className="va-aside-note">
          The register matched <strong>{run.register.candidateCount}</strong> carriers by name and no
          single one by number, so nothing was resolved. Settle the MC or USDOT first.
        </p>
      ) : null}

      {/* THE FROZEN FEED, labelled at the point of use. It is corroboration and history, never a
          current insurance status — the live answer is the register's own BIPD amount. */}
      {run?.insurance.available && run.insurance.frozen ? (
        <p className="va-aside-note">
          Insurance filing history is a <strong>frozen snapshot</strong>
          {run.insurance.dataAsOf ? ` as of ${run.insurance.dataAsOf}` : ''} and will not update again
          &mdash; {run.insurance.bipdActive} active BIPD filing
          {run.insurance.bipdActive === 1 ? '' : 's'}
          {run.insurance.bipdCoverageDollars === null
            ? ''
            : `, newest at ${formatDollars(run.insurance.bipdCoverageDollars)}`}
          . Treat it as history; current cover is the register&rsquo;s.
        </p>
      ) : null}

      {/* TAKE THEM ALL, or take them one at a time on the rows below. The bulk control stays because
          five agreeing sources are five clicks otherwise, but it is no longer the ONLY way in — a
          reviewer who agrees with four of five had no way to say so. Never applied on its own either
          way: the reviewer's name goes on the phase decision, so the marks have to be theirs. */}
      {outstanding.length > 0 ? (
        <div className="va-ask">
          <span className="va-aside-note">
            {outstanding.length} of these {AUTHORITY_CHECKS.length} checks have a suggestion. Applying
            fills the mark; the evidence stays on the row.
          </span>
          <div className="va-ask-actions">
            <Button
              variant="secondary"
              size="sm"
              icon="check"
              disabled={!canAct}
              onClick={applyAll}
            >
              Apply all {outstanding.length}
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
                  {/* A badge is a `<span>`, so it can never be the affordance. It states the
                      suggestion; the button beside the row takes it. */}
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
                disabled={!canAct}
                onChange={(next) => setCheck(check.id, next)}
              />
              {suggestion && mark !== suggestion.mark && canAct ? (
                <Button
                  variant="ghost"
                  size="sm"
                  icon="check"
                  onClick={() => setCheck(check.id, suggestion.mark)}
                >
                  Use {CHECK_MARKS.find((m) => m.id === suggestion.mark)?.label}
                </Button>
              ) : null}
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
            disabled={!canAct}
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
            disabled={!canAct}
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
