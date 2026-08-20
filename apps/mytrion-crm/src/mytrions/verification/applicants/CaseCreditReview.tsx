/**
 * Phase 6, credit side — the twelve SOP lines as fields that persist, and the verdict that routes.
 *
 * These were a dead `<ul>`: twelve criteria printed as bullets, with one verdict control beside them
 * and nowhere to put a single number. Every field here maps to a column in
 * `verification_credit_reviews` that already existed, and `bureauNoHit` in particular is a PHASE 7
 * HARD STOP — "no information found in the credit bureau" — which had no way to be recorded at all.
 *
 * NO BUREAU PULL. The credit-platform endpoints cost money per call and are deliberately not wired;
 * everything here is what the reviewer read off the report themselves.
 */
import { useMemo, useState } from 'react';
import { Badge, Button, Icon } from '@/ds';
import { saveCreditReview } from '@/api/verificationFlow';
import type { VerificationCreditReview, VerificationDeskDetail } from '@/api/verificationFlow';
import { CaseMarkGroup, type MarkOption } from './CaseMarkGroup';
import { ReviewFieldGrid, ReviewSelect, ReviewToggle } from './CaseReviewFields';
import {
  CREDIT_FIELDS,
  creditValuesFrom,
  filledCount,
  reviewBody,
  type CreditBankingMarks,
  type CreditVerdict,
  type ReviewValues,
} from './caseCreditBanking';

/**
 * The verdict, as the same `CaseMarkGroup` every other phase uses.
 *
 * It was four raw `ds/Button`s in a hand-rolled row with `flex-shrink: 0`, sitting in a half-width
 * column — which is why "Borderline / Mixed" and "Unacceptable" were clipped and the label beside
 * them collapsed to one word per line. `CaseMarkGroup` is a real radio group, gives each option a
 * glyph so tone is never colour alone, and wraps.
 */
const VERDICTS: ReadonlyArray<MarkOption<CreditVerdict>> = [
  { id: 'strong', label: 'Strong', icon: 'check_circle', tone: 'good', hint: 'Passes this side' },
  { id: 'acceptable', label: 'Acceptable', icon: 'check', tone: 'good', hint: 'Passes this side' },
  {
    id: 'borderline',
    label: 'Borderline',
    icon: 'gavel',
    tone: 'warn',
    hint: 'Goes to Manager Review',
  },
  {
    id: 'unacceptable',
    label: 'Unacceptable',
    icon: 'block',
    tone: 'bad',
    hint: 'Becomes a deposit / prepaid offer',
  },
];

const TRENDS = [
  { value: 'improving' as const, label: 'Improving' },
  { value: 'stable' as const, label: 'Stable' },
  { value: 'deteriorating' as const, label: 'Deteriorating' },
];

type Trend = 'improving' | 'stable' | 'deteriorating';

function trendOf(review: VerificationCreditReview | null): Trend | null {
  const raw = review?.recentTrend;
  return raw === 'improving' || raw === 'stable' || raw === 'deteriorating' ? raw : null;
}

export function CreditReviewStep({
  detail,
  caseId,
  marks,
  onMarks,
  canAct,
  busy,
  onSaved,
}: {
  detail: VerificationDeskDetail;
  caseId: string;
  marks: CreditBankingMarks;
  onMarks: (next: CreditBankingMarks) => void;
  canAct: boolean;
  busy: boolean;
  onSaved: (scope: 'credit' | 'banking', run: () => Promise<VerificationDeskDetail>) => void;
}) {
  const stored = detail.credit;
  // Seeded from the stored review ONCE. Re-seeding on every render would overwrite what the reviewer
  // is typing the moment any parent state changed.
  const [values, setValues] = useState<ReviewValues>(() => creditValuesFrom(stored));
  const [behavior, setBehavior] = useState(stored?.repaymentBehavior ?? '');
  const [trend, setTrend] = useState<Trend | null>(() => trendOf(stored));
  const [bureauNoHit, setBureauNoHit] = useState(stored?.bureauNoHit ?? false);
  const [note, setNote] = useState(stored?.note ?? '');

  const { body, rejected } = useMemo(() => reviewBody(CREDIT_FIELDS, values), [values]);
  const invalid = useMemo(() => {
    const bad = new Set<string>();
    for (const field of CREDIT_FIELDS) {
      if (rejected.includes(field.label)) bad.add(field.id);
    }
    return bad;
  }, [rejected]);

  const filled = filledCount(CREDIT_FIELDS, values);
  const disabled = !canAct || busy;

  const save = (): void => {
    onSaved('credit', () =>
      saveCreditReview(caseId, {
        ...body,
        repaymentBehavior: behavior.trim() === '' ? null : behavior.trim(),
        recentTrend: trend,
        bureauNoHit,
        note: note.trim() === '' ? null : note.trim(),
      }),
    );
  };

  return (
    <div className="va-stack">
      <div className="va-pane-head">
        <h4 className="t-eyebrow va-pane-kicker">Credit report review</h4>
        <span className="va-pane-note">
          {filled} of {CREDIT_FIELDS.length} recorded · read from the report, no bureau pull
        </span>
      </div>

      {/* THE PHASE 7 HARD STOP, first, because it overrides everything below it. "No information
          found in the credit bureau" is not a low score — it is a case with no credit file at all,
          and it takes the same deposit/prepaid door as negative cash flow. */}
      <ReviewToggle
        id="va-p6-bureau-nohit"
        label="No credit file found at the bureau"
        hint="A Phase 7 hard stop on its own — no standard unsecured LOC, whatever the fields below say."
        checked={bureauNoHit}
        disabled={disabled}
        onChange={setBureauNoHit}
      />

      {bureauNoHit ? (
        <div className="va-banner" data-tone="warning" role="status">
          <span className="va-banner-glyph" aria-hidden="true">
            <Icon name="warning" size="sm" />
          </span>
          <span className="va-banner-text">
            <span className="va-banner-title">This is a hard stop at Phase 7</span>
            <p className="va-banner-body">
              Record whatever the file does show, but the outcome is a deposit, prepaid, or manager
              review — not a standard line.
            </p>
          </span>
        </div>
      ) : null}

      <ReviewFieldGrid
        fields={CREDIT_FIELDS}
        values={values}
        disabled={disabled}
        idPrefix="va-p6-credit"
        invalid={invalid}
        onChange={(id, next) => setValues((prev) => ({ ...prev, [id]: next }))}
      />

      <div className="va-fields">
        <ReviewSelect
          id="va-p6-credit-trend"
          label="Recent trend"
          value={trend}
          options={TRENDS}
          disabled={disabled}
          placeholder="Not assessed"
          onChange={setTrend}
        />
        <div className="va-field" data-span="2">
          <label className="va-field-label" htmlFor="va-p6-credit-behavior">
            Overall repayment behaviour
          </label>
          <textarea
            id="va-p6-credit-behavior"
            className="va-textarea"
            rows={2}
            value={behavior}
            placeholder="What the payment history actually shows"
            disabled={disabled}
            onChange={(e) => setBehavior(e.currentTarget.value)}
          />
        </div>
      </div>

      <div className="va-field">
        <label className="va-field-label" htmlFor="va-p6-credit-note">
          Note
        </label>
        <textarea
          id="va-p6-credit-note"
          className="va-textarea"
          rows={2}
          value={note}
          placeholder="Anything the numbers do not carry"
          disabled={disabled}
          onChange={(e) => setNote(e.currentTarget.value)}
        />
      </div>

      <div className="va-id-check" data-mark={verdictMark(marks.credit)}>
        <div className="va-id-check-copy">
          <span className="va-id-check-label">
            Credit profile result
            {marks.credit === 'borderline' ? (
              <Badge intent="warning" size="sm" icon="gavel">
                Manager Review
              </Badge>
            ) : marks.credit === 'unacceptable' ? (
              <Badge intent="danger" size="sm" icon="block">
                Deposit / prepaid
              </Badge>
            ) : null}
          </span>
          <span className="va-id-check-value">
            Strong or Acceptable passes this side. Borderline goes to the manager; Unacceptable
            becomes a deposit or prepaid offer.
          </span>
        </div>
        <CaseMarkGroup
          ariaLabel="Credit profile result"
          options={VERDICTS}
          value={marks.credit}
          disabled={!canAct}
          onChange={(next) => onMarks({ ...marks, credit: next })}
        />
      </div>

      {rejected.length > 0 ? (
        <p className="va-aside-note">
          Not saved: {rejected.join(', ')} — {rejected.length === 1 ? 'that field is' : 'those fields are'}{' '}
          not a number. Everything else on this step still saves.
        </p>
      ) : null}

      {canAct ? (
        <div className="va-save">
          <Button variant="secondary" icon="save" loading={busy} disabled={disabled} onClick={save}>
            Save credit review
          </Button>
        </div>
      ) : (
        <p className="va-aside-note">
          This case is not open for editing, so the review is read-only.
        </p>
      )}
    </div>
  );
}

/**
 * The verdict → the three tones `.va-id-check[data-mark]` actually styles.
 *
 * It used to pass `strong` / `acceptable` / `borderline` / `unacceptable` straight through, none of
 * which have a rule — so the row carried no edge at all whatever the reviewer chose.
 */
function verdictMark(verdict: CreditVerdict | null): string {
  if (verdict === 'strong' || verdict === 'acceptable') return 'ok';
  if (verdict === 'borderline') return 'missing';
  if (verdict === 'unacceptable') return 'inconsistent';
  return 'unset';
}
