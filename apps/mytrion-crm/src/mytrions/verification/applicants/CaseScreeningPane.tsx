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
 * CHECK B IS THE WHOLE CHECK NOW — duplicates AND Citifuel, which is what the SOP's pre-stop asks
 * for. Three sources feed it and the pane keeps them apart, because none is a superset of the others:
 * our own cases are the only place an EIN or a normalised phone can match, Zoho Deals is the only
 * place an applicant who never reached underwriting exists, and `Deals.citifuel_Status` is the
 * Citifuel half. An absence from one is not an absence, so a quiet source gets a banner and the
 * suggestion is withheld — the same rule Check A follows when the ban list cannot be read.
 *
 * THE RUN BUTTON IS LIVE ON A LOCKED CASE. Screening is the one desk call that does not need Sales to
 * have finished: it needs a name, an email and a phone, all of which arrive with the Deal, and the
 * answer is worth having before a week of document-chasing. `canScreen` is therefore a different prop
 * from `canAct` — the marks and the verdicts below still need a green case.
 */
import { Badge, Button, Icon } from '@/ds';
import type { VerificationDeskDetail, VerificationScreeningHit } from '@/api/verificationFlow';
import { CaseMarkGroup, type MarkOption } from './CaseMarkGroup';
import {
  blacklistMarkFromRun,
  citifuelSentence,
  duplicateMarkFromRun,
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
  canScreen,
  running,
  verdictBusy,
  onRun,
  onVerdict,
}: {
  detail: VerificationDeskDetail;
  marks: ScreeningMarks;
  onMarks: (next: ScreeningMarks) => void;
  canAct: boolean;
  /** Undecided is enough to SCREEN; `canAct` additionally requires Sales to have submitted. */
  canScreen: boolean;
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
  /**
   * WHICH POPULATION a duplicate came from, off the id prefix the run wrote.
   *
   * A Deal hit is `deal:<zoho id>` in `matchedEntryId`; a case hit carries `matchedCaseId`. Split
   * because the two mean different things to a reviewer: another CASE is a live application on this
   * desk, another DEAL may be a closed application from last quarter that never reached underwriting.
   */
  const dealDuplicates = duplicateHits.filter((h) => (h.matchedEntryId ?? '').startsWith('deal:'));
  const caseDuplicates = duplicateHits.filter((h) => !(h.matchedEntryId ?? '').startsWith('deal:'));
  const dealsUnavailable = run != null && (!run.duplicateScan || !run.duplicateScan.dealsAvailable);
  const citifuel = run ? citifuelSentence(run.citifuel) : null;
  /**
   * Every source this run did not reach, named with what it costs — so the banner says what is MISSING
   * rather than repeating "this is not a clear" once per source. Each entry answers the reviewer's real
   * question: what would I have seen if it had worked?
   */
  const unreachable = [
    banUnavailable
      ? {
          id: 'ban',
          label: 'The ban list',
          detail:
            run?.banList?.error ??
            'the credit platform did not answer, so 6,803 listed identifiers went unchecked',
        }
      : null,
    dealsUnavailable
      ? {
          id: 'deals',
          label: 'Zoho Deals',
          detail:
            run?.duplicateScan?.dealsError ??
            'an earlier application that never reached underwriting would not appear',
        }
      : null,
  ].filter((source): source is { id: string; label: string; detail: string } => source !== null);
  const suggestedDuplicate = duplicateMarkFromRun(run);
  const runLabel = run ? 'Run screening again' : 'Run screening';

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
            disabled={!canScreen}
            onClick={onRun}
          >
            {runLabel}
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
        {/* WHY THE BUTTON IS OFF, when it is — and it is now off for one reason only. `runScreening`
            goes through `loadScreenable`, which allows a case still with Sales and refuses a DECIDED
            one; re-screening after the fact would rewrite the findings the decision was recorded
            against. A disabled control with no reason is the reviewer's dead end. */}
        {!canScreen ? (
          <p className="va-aside-note">
            This application has been decided, so screening can no longer run — re-running it would
            rewrite the findings the decision was recorded against.
          </p>
        ) : !canAct ? (
          <p className="va-aside-note">
            Sales has not submitted this application yet. Screening still runs — that is the point of
            running it early — but ruling on a hit needs the complete file.
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

      {/* WHAT THE RUN COULD NOT REACH — ONE banner, however many sources went quiet.
          A failed lookup must never read as a clear, and the first version of this said so twice: a
          `role="alert"` for the ban list and a `role="status"` for the Deal scan, both titled
          "— this is not a clear". Two live regions announce over each other, and two paragraphs of the
          same disclaimer is the shape a reviewer learns to skip. One region, polite (this is the
          result of a button the reviewer just pressed, not an unsolicited alarm), and the sources are
          a LIST — so "both lists were down" is one glance instead of two banners to compare. */}
      {unreachable.length > 0 ? (
        <div className="va-banner" data-tone={banUnavailable ? 'danger' : 'warning'} role="status">
          <span className="va-banner-glyph" aria-hidden="true">
            <Icon name={banUnavailable ? 'error' : 'warning'} size="sm" />
          </span>
          <span className="va-banner-text">
            <span className="va-banner-title">
              {unreachable.length === 1
                ? `${unreachable[0]!.label} was not checked`
                : `${unreachable.length} of this run’s sources were not checked`}
            </span>
            <p className="va-banner-body">
              Screening found nothing there because it could not look, so mark those checks by hand or
              run it again.
            </p>
            <ul className="va-banner-list">
              {unreachable.map((source) => (
                <li key={source.id}>
                  <strong>{source.label}</strong> — {source.detail}
                </li>
              ))}
            </ul>
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
                Use for Check A
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
            <span className="va-id-check-label">Check B — Active customer / duplicate</span>
            <span className="va-id-check-value">
              {run
                ? duplicateHits.length > 0
                  ? `${caseDuplicates.length} case${caseDuplicates.length === 1 ? '' : 's'} and ${dealDuplicates.length} Deal${dealDuplicates.length === 1 ? '' : 's'} share an identifier.`
                  : 'No duplicate across this desk’s cases or the Deal history.'
                : 'The same identifiers against carriers already on the books, and Citifuel.'}
            </span>
          </div>
          <CaseMarkGroup
            ariaLabel="Duplicate"
            options={DUPLICATE}
            value={marks.duplicate}
            onChange={(next) => onMarks({ ...marks, duplicate: next })}
          />
        </div>

        {/* CITIFUEL, the other half of the pre-stop. Its own row rather than a sentence appended to the
            duplicate copy: it is a separate finding with a separate source, and the reviewer needs to
            see the RAW value — `yes` and `active` both mean an existing relationship, and the check
            this replaced compared only the exact string `Lead Converted`. */}
        {citifuel ? (
          <div
            className="va-id-check"
            /* `neutral` is NOT `missing`. Most Deals carry no Citifuel status at all — 83 of
               thousands — and an amber edge on every one of those trains the reviewer to ignore the
               colour that means "look at this". Absent gets no edge; only `unknown` and unavailable
               earn amber. */
            data-mark={
              citifuel.tone === 'good'
                ? 'ok'
                : citifuel.tone === 'bad'
                  ? 'inconsistent'
                  : citifuel.tone === 'warn'
                    ? 'missing'
                    : 'unset'
            }
          >
            <div className="va-id-check-copy">
              <span className="va-id-check-label">
                Citifuel
                {run?.citifuel?.status ? (
                  <Badge
                    intent={
                      citifuel.tone === 'good' ? 'success' : citifuel.tone === 'bad' ? 'danger' : 'warning'
                    }
                    size="sm"
                  >
                    {run.citifuel.status}
                  </Badge>
                ) : null}
              </span>
              <span className="va-id-check-value">{citifuel.text}</span>
            </div>
          </div>
        ) : null}

        {/* Check B's suggestion, withheld whenever a source went quiet — see `duplicateMarkFromRun`. */}
        {suggestedDuplicate && marks.duplicate !== suggestedDuplicate ? (
          <div className="va-ask">
            <span className="va-aside-note">
              The run suggests{' '}
              <strong>{DUPLICATE.find((d) => d.id === suggestedDuplicate)?.label}</strong> for Check B.
            </span>
            <div className="va-ask-actions">
              <Button
                variant="secondary"
                size="sm"
                icon="check"
                onClick={() => onMarks({ ...marks, duplicate: suggestedDuplicate })}
              >
                Use for Check B
              </Button>
            </div>
          </div>
        ) : null}

        {caseDuplicates.length > 0 ? (
          <div className="va-stack">
            <h4 className="t-eyebrow va-pane-kicker">Cases sharing an identifier</h4>
            {caseDuplicates.map((hit) => (
              <div className="va-id-check" key={hit.id} data-mark="missing">
                <div className="va-id-check-copy">
                  <span className="va-id-check-label">
                    {ENTRY_LABEL[hit.entryType] ?? hit.entryType} ·{' '}
                    {hit.matchedCaseLabel ?? hit.matchedValueDisplay ?? '—'}
                  </span>
                  <span className="va-id-check-value">Another application on this desk</span>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {dealDuplicates.length > 0 ? (
          <div className="va-stack">
            <h4 className="t-eyebrow va-pane-kicker">Deals sharing an identifier</h4>
            {dealDuplicates.map((hit) => (
              <div className="va-id-check" key={hit.id} data-mark="missing">
                <div className="va-id-check-copy">
                  <span className="va-id-check-label">
                    {ENTRY_LABEL[hit.entryType] ?? hit.entryType} ·{' '}
                    {hit.matchedCaseLabel ?? hit.matchedValueDisplay ?? '—'}
                  </span>
                  {/* The note carries the Deal id, its stage, when it was applied for and its own
                      Citifuel status — everything the reviewer needs to open it in Zoho and judge
                      whether this is the same applicant twice or two carriers with one name. */}
                  <span className="va-id-check-value">
                    {hit.note?.trim() ? hit.note.trim() : 'An earlier Zoho Deal'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {/* WHAT CHECK B CANNOT SEE, stated where it is relevant rather than left to be inferred from a
            clean result. Zoho Deals has no EIN column and no phone COQL can normalise, so those two
            identifiers are matched against this desk's cases only — which reach back only as far as
            the poller's watermark. */}
        {run ? (
          <p className="va-aside-note">
            EIN and phone duplicates are found among this desk’s own cases only — Zoho Deals carries
            neither in a form the query can compare. The Deal scan matches on email, MC, USDOT and
            company name{run.duplicateScan?.dealsTruncated ? ', and hit its 50-row cap on this run' : ''}.
          </p>
        ) : null}
      </div>
    </div>
  );
}
