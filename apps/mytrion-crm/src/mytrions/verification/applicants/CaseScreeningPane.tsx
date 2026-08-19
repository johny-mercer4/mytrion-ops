/**
 * Phase 3 working pane — Check A (blacklist) and Check B (active customer / duplicate).
 *
 * ONE FACTS BLOCK, NOT TWO. This was two columns side by side, each printing the same eight
 * identifiers, because both checks compare the same row against a different list. Eight facts rendered
 * twice is eight facts the reviewer reads twice to notice they are identical. Stated once, with the two
 * checks under them as rows in Phase 2's shape.
 *
 * CHECK A IS AUTOMATED NOW, and reachable. `runScreening` existed as a route and a client function that
 * NOTHING called, and it matched against `verification_blacklist_entries` in our own Postgres — 0 rows,
 * so it returned "no match" on every case. It now unions that with the credit platform's own
 * `public.blacklist_entries` (6,803 active entries) and this pane is where a reviewer sets it going,
 * reads the hits, and rules on each one.
 *
 * THE MARKS STILL DECIDE. The run SUGGESTS Check A's mark and the reviewer can overrule it — and when
 * the ban-list lookup is unavailable it suggests nothing at all, because a failed lookup that reads as
 * a clear is the bug this phase already had. Passing the phase remains a human act either way.
 *
 * CHECK B IS FLAGGED, deliberately. The SOP's pre-stop check is duplicates AND Citifuel, and Citifuel
 * is undefined — so what runs today is a scan for other cases in this tenant sharing an identifier,
 * which is a useful signal and not the check. The pane says so rather than presenting a partial
 * implementation as the finished one.
 */
import { Badge, Button, Icon } from '@/ds';
import type { VerificationDeskDetail, VerificationScreeningHit } from '@/api/verificationFlow';
import { CaseMarkGroup, type MarkOption } from './CaseMarkGroup';
import {
  blacklistMarkFromRun,
  screeningIdentityFacts,
  screeningRunFrom,
  type ScreeningBlacklistMark,
  type ScreeningDuplicateMark,
  type ScreeningMarks,
} from './caseScreening';

/**
 * `possible` is `warn`, `confirmed` is `bad`, and the difference is what happens next: a possible match
 * is the reviewer's to resolve, while a confirmed one takes the `decline_blacklist` door — it adds
 * blacklist entries and informs Collections (`screeningDeclineOutcome`).
 */
const BLACKLIST: ReadonlyArray<MarkOption<ScreeningBlacklistMark>> = [
  { id: 'none', label: 'No match', icon: 'check_circle', tone: 'good', hint: 'Nothing on either list' },
  {
    id: 'possible',
    label: 'Possible',
    icon: 'warning',
    tone: 'warn',
    hint: 'Something looks close — resolve it before passing',
  },
  {
    id: 'confirmed',
    label: 'Confirmed',
    icon: 'block',
    tone: 'bad',
    hint: 'Declines the case and informs Collections',
  },
];

const DUPLICATE: ReadonlyArray<MarkOption<ScreeningDuplicateMark>> = [
  { id: 'no', label: 'No duplicate', icon: 'check_circle', tone: 'good', hint: 'Not an existing customer' },
  {
    id: 'yes',
    label: 'Duplicate',
    icon: 'block',
    tone: 'bad',
    hint: 'Already a customer, or a second application for the same carrier',
  },
];

const VERDICTS: ReadonlyArray<MarkOption<'false_match' | 'confirmed'>> = [
  { id: 'false_match', label: 'False match', icon: 'check_circle', tone: 'good', hint: 'Not this applicant' },
  { id: 'confirmed', label: 'Real match', icon: 'block', tone: 'bad', hint: 'This applicant is on the list' },
];

const ENTRY_LABEL: Record<string, string> = {
  name: 'Name',
  ein: 'EIN',
  ssn: 'SSN (last 4)',
  phone: 'Phone',
  email: 'Email',
  address: 'Address',
  ip: 'IP',
  mc: 'MC',
  usdot: 'USDOT',
};

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

function HitRow({
  hit,
  busy,
  onVerdict,
}: {
  hit: VerificationScreeningHit;
  busy: boolean;
  onVerdict: (hitId: string, verdict: 'confirmed' | 'false_match') => void;
}) {
  const ruled = hit.verdict !== 'unverified';
  return (
    <div
      className="va-id-check"
      data-mark={hit.verdict === 'confirmed' ? 'inconsistent' : hit.verdict === 'false_match' ? 'ok' : 'missing'}
    >
      <div className="va-id-check-copy">
        <span className="va-id-check-label">
          {ENTRY_LABEL[hit.entryType] ?? hit.entryType} · {hit.matchedValueDisplay ?? '—'}
        </span>
        {/* WHICH LIST, and why it is on it. The note carries the platform's own reason and who added
            it; without it a hit is an assertion the reviewer cannot check. */}
        <span className="va-id-check-value">
          {hit.note?.trim() ? hit.note.trim() : 'Listed on this desk’s own blacklist'}
        </span>
      </div>
      {ruled ? (
        <Badge intent={hit.verdict === 'confirmed' ? 'danger' : 'success'} size="sm" icon={hit.verdict === 'confirmed' ? 'block' : 'check_circle'}>
          {hit.verdict === 'confirmed' ? 'Real match' : 'False match'}
        </Badge>
      ) : (
        <CaseMarkGroup
          ariaLabel={`Verdict for ${ENTRY_LABEL[hit.entryType] ?? hit.entryType}`}
          options={VERDICTS}
          value={null}
          disabled={busy}
          onChange={(next) => onVerdict(hit.id, next)}
        />
      )}
    </div>
  );
}

export function ScreeningPane({
  detail,
  marks,
  onMarks,
  canAct,
  running,
  verdictBusy,
  onRun,
  onVerdict,
}: {
  detail: VerificationDeskDetail;
  marks: ScreeningMarks;
  onMarks: (next: ScreeningMarks) => void;
  canAct: boolean;
  running: boolean;
  verdictBusy: boolean;
  onRun: () => void;
  onVerdict: (hitId: string, verdict: 'confirmed' | 'false_match') => void;
}) {
  const c = detail.case as VerificationDeskDetail['case'] & Record<string, unknown>;
  const facts = screeningIdentityFacts(c, detail.principals);
  const phase = detail.rail.find((p) => p.code === 'p3_screening');
  const run = screeningRunFrom(phase?.findings);
  const suggested = blacklistMarkFromRun(run);

  const blacklistHits = detail.screening.hits.filter((h) => h.checkType === 'blacklist');
  const duplicateHits = detail.screening.hits.filter((h) => h.checkType === 'duplicate');
  const banUnavailable = run?.banList != null && !run.banList.available;

  return (
    <div className="va-stack">
      <div className="va-pane-head">
        <h3 className="t-eyebrow va-pane-kicker">Internal screening</h3>
        <span className="va-pane-note">
          {run
            ? `Check A ran ${whenText(run.ranAt)} · ${run.identifiersScreened ?? 0} identifiers`
            : 'Check A is automated — run it, then rule on anything it finds'}
        </span>
      </div>

      {/* The identifiers BOTH checks read. A key/value grid rather than a column of sentences: eight
          facts scanned for a match are read by their values, and a label-per-line puts every value at a
          different x. */}
      <div className="va-recorded" data-stack="true">
        <div className="va-pane-head">
          <h4 className="t-eyebrow va-pane-kicker">Identifiers to compare</h4>
          <Button
            variant={run ? 'secondary' : 'primary'}
            size="sm"
            icon="restart_alt"
            loading={running}
            disabled={!canAct}
            onClick={onRun}
          >
            {run ? 'Run Check A again' : 'Run Check A'}
          </Button>
        </div>
        <div className="va-figs">
          {facts.map((f) => (
            <span className="va-fig" key={f.id}>
              <span className="t-eyebrow">{f.label}</span>
              {/* An email or an address is longer than any sensible track, so those wrap rather than
                  ellipsise — a truncated identifier is one the reviewer cannot compare. */}
              <span
                className="va-fig-v"
                data-empty={f.value === '—' || undefined}
                data-wrap={f.id === 'email' || f.id === 'address' || f.id === 'name' || undefined}
                title={f.value}
              >
                {f.value}
              </span>
            </span>
          ))}
        </div>
        {/* WHY THE BUTTON IS OFF, when it is. `runScreening` goes through `loadWorkable`, which refuses
            a case still with Sales — so a locked case cannot be screened, and a disabled control with no
            reason is the reviewer's dead end. The marks below stay available either way. */}
        {!canAct ? (
          <p className="va-aside-note">
            Check A cannot run while the case is still with Sales, or once it is decided. Mark it by
            hand — the phase does not need the automation to pass.
          </p>
        ) : null}

        {/* IP IS NEVER CAPTURED. The SOP screens on it and the ban list holds 697 IP entries, but no
            column on the case carries one — so this identifier is dead until intake records it. Said
            here rather than left as a silent dash. */}
        <p className="va-aside-note">
          IP is on the SOP’s list and on the ban list, but nothing captures the applicant’s IP today —
          that identifier is never screened.
        </p>
      </div>

      {/* WHETHER THE LIST WAS READ. A lookup that failed must not read as a clear, so it gets a banner
          of its own rather than a quiet absence of hits. */}
      {banUnavailable ? (
        <div className="va-banner" data-tone="danger" role="alert">
          <span className="va-banner-glyph" aria-hidden="true">
            <Icon name="error" size="sm" />
          </span>
          <span className="va-banner-text">
            <span className="va-banner-title">The ban list could not be read — this is not a clear</span>
            <p className="va-banner-body">
              {run?.banList?.error ?? 'The credit platform did not answer.'} Check A found nothing
              because it could not look, so mark it by hand or run it again.
            </p>
          </span>
        </div>
      ) : null}

      <div className="va-id-checks">
        <div
          className="va-id-check"
          data-mark={marks.blacklist === 'none' ? 'ok' : marks.blacklist ? 'inconsistent' : 'unset'}
        >
          <div className="va-id-check-copy">
            <span className="va-id-check-label">Check A — Blacklist</span>
            <span className="va-id-check-value">
              {run && !banUnavailable
                ? blacklistHits.length === 0
                  ? `No match across ${run.identifiersScreened ?? 0} identifiers — the credit platform ban list and this desk’s own.`
                  : `${blacklistHits.length} hit${blacklistHits.length === 1 ? '' : 's'} to rule on below.`
                : 'Any of the identifiers above against the ban list.'}
            </span>
          </div>
          <CaseMarkGroup
            ariaLabel="Blacklist"
            options={BLACKLIST}
            value={marks.blacklist}
            onChange={(next) => onMarks({ ...marks, blacklist: next })}
          />
        </div>

        {/* The suggestion, and the button that takes it. Never applied silently: the SOP puts a human
            between the run and the mark, and a mark that appeared on its own is one nobody owns. */}
        {suggested && marks.blacklist !== suggested ? (
          <div className="va-ask">
            <span className="va-aside-note">
              The run suggests <strong>{BLACKLIST.find((b) => b.id === suggested)?.label}</strong> for
              Check A.
            </span>
            <div className="va-ask-actions">
              <Button
                variant="secondary"
                size="sm"
                icon="check"
                onClick={() => onMarks({ ...marks, blacklist: suggested })}
              >
                Use it
              </Button>
            </div>
          </div>
        ) : null}

        {blacklistHits.length > 0 ? (
          <div className="va-stack">
            <h4 className="t-eyebrow va-pane-kicker">Ban-list hits — rule on each</h4>
            {blacklistHits.map((hit) => (
              <HitRow key={hit.id} hit={hit} busy={verdictBusy || !canAct} onVerdict={onVerdict} />
            ))}
          </div>
        ) : null}

        <div
          className="va-id-check"
          data-mark={marks.duplicate === 'no' ? 'ok' : marks.duplicate ? 'inconsistent' : 'unset'}
        >
          <div className="va-id-check-copy">
            <span className="va-id-check-label">
              Check B — Active customer / duplicate
              {/* FLAGGED. The SOP's pre-stop is duplicates AND Citifuel; Citifuel is undefined, so what
                  runs is an identifier scan over this tenant's other cases. A partial implementation
                  presented as the finished check is how a gap becomes invisible. */}
              <Badge intent="warning" size="sm" icon="warning">
                Pre-stop — not final
              </Badge>
            </span>
            <span className="va-id-check-value">
              {duplicateHits.length > 0
                ? `${duplicateHits.length} other case${duplicateHits.length === 1 ? '' : 's'} share an identifier.`
                : 'The same identifiers against carriers already on the books.'}
            </span>
          </div>
          <CaseMarkGroup
            ariaLabel="Duplicate"
            options={DUPLICATE}
            value={marks.duplicate}
            onChange={(next) => onMarks({ ...marks, duplicate: next })}
          />
        </div>

        <p className="va-aside-note">
          Check B is a <strong>pre-stop placeholder</strong>. The SOP pairs the duplicate scan with a
          Citifuel check that is not defined yet, so what runs today is a scan for other cases in this
          tenant sharing an identifier. Treat the mark as your own judgement, not an automated verdict.
        </p>

        {duplicateHits.length > 0 ? (
          <div className="va-stack">
            <h4 className="t-eyebrow va-pane-kicker">Cases sharing an identifier</h4>
            {duplicateHits.map((hit) => (
              <div className="va-id-check" key={hit.id} data-mark="missing">
                <div className="va-id-check-copy">
                  <span className="va-id-check-label">
                    {ENTRY_LABEL[hit.entryType] ?? hit.entryType} · {hit.matchedCaseLabel ?? hit.matchedValueDisplay ?? '—'}
                  </span>
                  <span className="va-id-check-value">Another application in this tenant</span>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
