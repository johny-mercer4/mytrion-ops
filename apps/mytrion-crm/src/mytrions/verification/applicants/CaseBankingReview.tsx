/**
 * Phase 6, banking side — the last three months, as fields that persist.
 *
 * THE WEEKLY NET CASH FLOW IS THE POINT OF THIS SCREEN. Phase 7 refuses a standard unsecured LOC when
 * it is not above zero, and Phase 9 builds adjusted capacity from it plus the weekly fuel expense. The
 * server DERIVES it from the two recurring inputs and will not accept it from here, so the figure is
 * computed live beside them: a reviewer typing income and expenses should see the hard stop coming,
 * not discover it after saving.
 *
 * NO STATEMENT PARSING. The three-statement read is done externally for now and typed in here; every
 * field is the reviewer's own, and every one is editable at any time while the case is open.
 */
import { useMemo, useState } from 'react';
import { Badge, Button, Icon } from '@/ds';
import { saveBankingReview } from '@/api/verificationFlow';
import type { VerificationBankingReview, VerificationDeskDetail } from '@/api/verificationFlow';
import { CaseMarkGroup, type MarkOption } from './CaseMarkGroup';
import { ReviewFieldGrid, ReviewSelect, ReviewToggle } from './CaseReviewFields';
import {
  BANKING_CHECKS,
  BANKING_FIELDS,
  BANKING_FIELD_GROUPS,
  bankingValuesFrom,
  filledCount,
  reviewBody,
  weeklyNetCashFlow,
  type BankingMark,
  type CreditBankingMarks,
  type ReviewValues,
} from './caseCreditBanking';

/** `missing` is the mark that asks Sales for statements — see `missingBankingDocs`. */
const MARKS: ReadonlyArray<MarkOption<BankingMark>> = [
  { id: 'ok', label: 'OK', icon: 'check_circle', tone: 'good', hint: 'Read and consistent' },
  {
    id: 'missing',
    label: 'Missing',
    icon: 'cloud_upload',
    tone: 'warn',
    hint: 'Requests the statements from Sales',
  },
  {
    id: 'concern',
    label: 'Concern',
    icon: 'warning',
    tone: 'bad',
    hint: 'Read, and a manager should weigh it',
  },
];

const TRENDS = [
  { value: 'improving' as const, label: 'Improving' },
  { value: 'stable' as const, label: 'Stable' },
  { value: 'deteriorating' as const, label: 'Deteriorating' },
];
const VOLATILITY = [
  { value: 'low' as const, label: 'Low' },
  { value: 'moderate' as const, label: 'Moderate' },
  { value: 'high' as const, label: 'High' },
];

type Trend = 'improving' | 'stable' | 'deteriorating';
type Volatility = 'low' | 'moderate' | 'high';

function trendOf(review: VerificationBankingReview | null): Trend | null {
  const raw = (review as { revenueTrend?: string } | null)?.revenueTrend;
  return raw === 'improving' || raw === 'stable' || raw === 'deteriorating' ? raw : null;
}
function volatilityOf(review: VerificationBankingReview | null): Volatility | null {
  const raw = (review as { cashFlowVolatility?: string } | null)?.cashFlowVolatility;
  return raw === 'low' || raw === 'moderate' || raw === 'high' ? raw : null;
}
function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

const money = (n: number): string =>
  n.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 0,
  });

export function BankingReviewStep({
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
  const stored = detail.banking;
  const row = (stored ?? {}) as unknown as Record<string, unknown>;
  const [values, setValues] = useState<ReviewValues>(() => bankingValuesFrom(stored));
  const [periodStart, setPeriodStart] = useState(text(row.periodStart));
  const [periodEnd, setPeriodEnd] = useState(text(row.periodEnd));
  const [trend, setTrend] = useState<Trend | null>(() => trendOf(stored));
  const [volatility, setVolatility] = useState<Volatility | null>(() => volatilityOf(stored));
  const [ownershipVerified, setOwnershipVerified] = useState(
    (row.accountOwnershipVerified as boolean | undefined) ?? false,
  );
  const [inconsistent, setInconsistent] = useState(
    (row.bankingInconsistentWithOperations as boolean | undefined) ?? false,
  );
  const [unusual, setUnusual] = useState(text(row.unusualTransactions));
  const [note, setNote] = useState(text(row.note));

  const { body, rejected } = useMemo(() => reviewBody(BANKING_FIELDS, values), [values]);
  const invalid = useMemo(() => {
    const bad = new Set<string>();
    for (const field of BANKING_FIELDS) if (rejected.includes(field.label)) bad.add(field.id);
    return bad;
  }, [rejected]);

  const net = weeklyNetCashFlow(values);
  const filled = filledCount(BANKING_FIELDS, values);
  const disabled = !canAct || busy;

  const save = (): void => {
    onSaved('banking', () =>
      saveBankingReview(caseId, {
        ...body,
        periodStart: periodStart.trim() === '' ? null : periodStart.trim(),
        periodEnd: periodEnd.trim() === '' ? null : periodEnd.trim(),
        revenueTrend: trend,
        cashFlowVolatility: volatility,
        accountOwnershipVerified: ownershipVerified,
        bankingInconsistentWithOperations: inconsistent,
        unusualTransactions: unusual.trim() === '' ? null : unusual.trim(),
        note: note.trim() === '' ? null : note.trim(),
      }),
    );
  };

  return (
    <div className="va-stack">
      <div className="va-pane-head">
        <h4 className="t-eyebrow va-pane-kicker">Banking review — last 3 months</h4>
        <span className="va-pane-note">
          {filled} of {BANKING_FIELDS.length} recorded · statements read outside Mytrion, typed here
        </span>
      </div>

      {/* THE DERIVED FIGURE, ABOVE THE FIELDS THAT MAKE IT. The server computes it from exactly the
          two inputs below and refuses it from the client, so showing it here is the only way the
          reviewer learns the Phase 7 verdict before they commit to it. */}
      <div
        className="va-order-card"
        data-tone={net === null ? undefined : net > 0 ? 'good' : 'bad'}
        /* Polite, and only while there is a verdict: this figure changes as the reviewer types, and an
           assertive region would interrupt them on every keystroke. */
        role={net === null ? undefined : 'status'}
      >
        <span className="va-order-kicker">Average weekly net cash flow</span>
        <strong className="va-order-value">{net === null ? 'Not yet' : money(net)}</strong>
        <p className="va-pane-body">
          {net === null
            ? 'Recurring weekly income minus expenses. Both are needed — a subtraction with one side blank is not a zero.'
            : net > 0
              ? 'Above zero, so Phase 7’s cash-flow hard stop does not fire.'
              : 'Not above zero — Phase 7 refuses a standard unsecured LOC and routes to deposit 1:1, prepaid or manager review.'}
        </p>
      </div>

      {BANKING_FIELD_GROUPS.map((group) => (
        <div className="va-field-group" key={group.id}>
          <div className="va-pane-head" data-stack="true">
            <h5 className="t-eyebrow va-pane-kicker">{group.title}</h5>
          </div>
          {group.note ? <p className="va-aside-note">{group.note}</p> : null}
          <ReviewFieldGrid
            fields={group.fields}
            values={values}
            disabled={disabled}
            idPrefix={`va-p6-bank-${group.id}`}
            invalid={invalid}
            onChange={(id, next) => setValues((prev) => ({ ...prev, [id]: next }))}
          />
        </div>
      ))}

      <div className="va-field-group">
        <div className="va-pane-head" data-stack="true">
          <h5 className="t-eyebrow va-pane-kicker">Statement window and judgements</h5>
        </div>
        <div className="va-fields">
          <div className="va-field">
            <label className="va-field-label" htmlFor="va-p6-bank-from">
              Period from
            </label>
            <input
              id="va-p6-bank-from"
              type="date"
              className="va-type-select"
              value={periodStart}
              disabled={disabled}
              onChange={(e) => setPeriodStart(e.currentTarget.value)}
            />
          </div>
          <div className="va-field">
            <label className="va-field-label" htmlFor="va-p6-bank-to">
              Period to
            </label>
            <input
              id="va-p6-bank-to"
              type="date"
              className="va-type-select"
              value={periodEnd}
              disabled={disabled}
              onChange={(e) => setPeriodEnd(e.currentTarget.value)}
            />
          </div>
          <ReviewSelect
            id="va-p6-bank-trend"
            label="Revenue trend"
            value={trend}
            options={TRENDS}
            disabled={disabled}
            placeholder="Not assessed"
            onChange={setTrend}
          />
          <ReviewSelect
            id="va-p6-bank-volatility"
            label="Cash-flow volatility"
            value={volatility}
            options={VOLATILITY}
            disabled={disabled}
            placeholder="Not assessed"
            onChange={setVolatility}
          />
        </div>
        <ReviewToggle
          id="va-p6-bank-ownership"
          label="Account ownership verified"
          hint="The applicant or company name on the statements matches the application."
          checked={ownershipVerified}
          disabled={disabled}
          onChange={setOwnershipVerified}
        />
        <ReviewToggle
          id="va-p6-bank-inconsistent"
          label="Banking inconsistent with reported operations"
          hint="A manager-review indicator — recorded, not an automatic decline."
          checked={inconsistent}
          disabled={disabled}
          onChange={setInconsistent}
        />
        <div className="va-field">
          <label className="va-field-label" htmlFor="va-p6-bank-unusual">
            Unusual transactions / related-account transfers
          </label>
          <textarea
            id="va-p6-bank-unusual"
            className="va-textarea"
            rows={2}
            value={unusual}
            placeholder="What you saw, in your own words"
            disabled={disabled}
            onChange={(e) => setUnusual(e.currentTarget.value)}
          />
        </div>
        <div className="va-field">
          <label className="va-field-label" htmlFor="va-p6-bank-note">
            Note
          </label>
          <textarea
            id="va-p6-bank-note"
            className="va-textarea"
            rows={2}
            value={note}
            placeholder="Anything the numbers do not carry"
            disabled={disabled}
            onChange={(e) => setNote(e.currentTarget.value)}
          />
        </div>
      </div>

      {/* THE FOUR ROWS THAT ARE A JUDGEMENT, NOT A NUMBER. `missing` is the only thing on this pane
          that can ask Sales for the statements, which is why these keep a mark rather than a field. */}
      <div className="va-field-group">
        <div className="va-pane-head" data-stack="true">
          <h5 className="t-eyebrow va-pane-kicker">Read and consistent?</h5>
        </div>
        <div className="va-id-checks">
          {BANKING_CHECKS.map((check) => {
            const mark = marks.banking[check.id];
            return (
              <div className="va-id-check" key={check.id} data-mark={mark ?? 'unset'}>
                <div className="va-id-check-copy">
                  <span className="va-id-check-label">{check.label}</span>
                  {mark === 'missing' ? (
                    <span className="va-id-check-value">
                      Passing the phase requests the statements from Sales.
                    </span>
                  ) : null}
                </div>
                <CaseMarkGroup
                  ariaLabel={check.label}
                  options={MARKS}
                  value={mark ?? null}
                  disabled={!canAct}
                  onChange={(next) =>
                    onMarks({ ...marks, banking: { ...marks.banking, [check.id]: next } })
                  }
                />
              </div>
            );
          })}
        </div>
      </div>

      {rejected.length > 0 ? (
        <p className="va-aside-note">
          Not saved: {rejected.join(', ')} —{' '}
          {rejected.length === 1 ? 'that field is' : 'those fields are'} not a number. Everything else
          on this step still saves.
        </p>
      ) : null}

      {inconsistent ? (
        <div className="va-banner" data-tone="warning" role="status">
          <span className="va-banner-glyph" aria-hidden="true">
            <Icon name="warning" size="sm" />
          </span>
          <span className="va-banner-text">
            <span className="va-banner-title">Recorded as a manager-review indicator</span>
            <p className="va-banner-body">
              Not an automatic decline on its own — Phase 7 lists it alongside the other indicators a
              human weighs.
            </p>
          </span>
        </div>
      ) : null}

      {canAct ? (
        <div className="va-save">
          <Button variant="secondary" icon="save" loading={busy} disabled={disabled} onClick={save}>
            Save banking review
          </Button>
          {net !== null && net <= 0 ? (
            <Badge intent="danger" size="sm" icon="block">
              Hard stop at Phase 7
            </Badge>
          ) : null}
        </div>
      ) : (
        <p className="va-aside-note">
          This case is not open for editing, so the review is read-only.
        </p>
      )}
    </div>
  );
}
