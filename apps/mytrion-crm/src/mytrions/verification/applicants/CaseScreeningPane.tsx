/**
 * Phase 3 working pane — two manual checks against the application facts. No vendor query.
 *
 * ONE FACTS BLOCK, NOT TWO. This was two columns side by side, each printing the same eight
 * identifiers — name, tax id, phone, email, address, IP, MC, USDOT — because both checks compare the
 * same row against a different list. Eight facts rendered twice is eight facts the reviewer reads
 * twice to notice they are identical, and it left the two verdicts in separate columns where nothing
 * showed that they gate the same Pass. The identifiers are stated once, and the two checks sit under
 * them as rows in the same shape Phase 2 uses — so a reviewer moving between the phases is working one
 * control, not two.
 */
import type { VerificationDeskDetail } from '@/api/verificationFlow';
import { CaseMarkGroup, type MarkOption } from './CaseMarkGroup';
import {
  screeningIdentityFacts,
  type ScreeningBlacklistMark,
  type ScreeningDuplicateMark,
  type ScreeningMarks,
} from './caseScreening';

/**
 * `possible` is `warn`, `confirmed` is `bad`, and the difference is what happens next: a possible match
 * is the reviewer's to resolve, while a confirmed one takes the `decline_blacklist` door — it adds
 * blacklist entries and informs Collections (`screeningDeclineOutcome`). The control says so on hover
 * rather than making the reviewer learn it from the decision bar.
 */
const BLACKLIST: ReadonlyArray<MarkOption<ScreeningBlacklistMark>> = [
  { id: 'none', label: 'No match', icon: 'check_circle', tone: 'good', hint: 'Nothing on any list' },
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

export function ScreeningPane({
  detail,
  marks,
  onMarks,
}: {
  detail: VerificationDeskDetail;
  marks: ScreeningMarks;
  onMarks: (next: ScreeningMarks) => void;
}) {
  const c = detail.case as VerificationDeskDetail['case'] & Record<string, unknown>;
  const facts = screeningIdentityFacts(c, detail.principals);

  return (
    <div className="va-stack">
      <div className="va-pane-head">
        <h3 className="t-eyebrow va-pane-kicker">Internal screening</h3>
        <span className="va-pane-note">Manual — compare the application against your lists</span>
      </div>

      {/* The identifiers BOTH checks read. A key/value grid rather than a column of sentences: eight
          facts scanned for a match are read by their values, and a label-per-line puts every value at a
          different x. */}
      {/* `data-stack` because it carries a heading — see the note on `.va-recorded` in the stylesheet. */}
      <div className="va-recorded" data-stack="true">
        <h4 className="t-eyebrow va-pane-kicker">Identifiers to compare</h4>
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
      </div>

      {/* The two verdicts, as rows in Phase 2's shape — they gate the same Pass, so they belong in one
          column rather than in two panels that look like separate jobs. */}
      <div className="va-id-checks">
        <div className="va-id-check" data-mark={marks.blacklist === 'none' ? 'ok' : marks.blacklist ? 'inconsistent' : 'unset'}>
          <div className="va-id-check-copy">
            <span className="va-id-check-label">Check A — Blacklist</span>
            <span className="va-id-check-value">
              Any of the identifiers above against the blacklist
            </span>
          </div>
          <CaseMarkGroup
            ariaLabel="Blacklist"
            options={BLACKLIST}
            value={marks.blacklist}
            onChange={(next) => onMarks({ ...marks, blacklist: next })}
          />
        </div>
        <div className="va-id-check" data-mark={marks.duplicate === 'no' ? 'ok' : marks.duplicate ? 'inconsistent' : 'unset'}>
          <div className="va-id-check-copy">
            <span className="va-id-check-label">Check B — Active customer / duplicate</span>
            <span className="va-id-check-value">
              The same identifiers against carriers already on the books
            </span>
          </div>
          <CaseMarkGroup
            ariaLabel="Duplicate"
            options={DUPLICATE}
            value={marks.duplicate}
            onChange={(next) => onMarks({ ...marks, duplicate: next })}
          />
        </div>
      </div>
    </div>
  );
}
