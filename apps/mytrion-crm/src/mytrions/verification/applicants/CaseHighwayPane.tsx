/**
 * Phase 8 — carrier operational review in Highway.
 *
 * THIS PHASE HAD NO PANE AT ALL. It fell through `PhaseBody`'s switch to `RecordedPane`, the generic
 * "here is what has been recorded so far" summary — so the one phase the SOP gives eleven review items
 * offered the reviewer nothing to review with, and the underwriting summary's "Highway findings" line
 * (which `buildSummary` has always read from this phase) was blank on every case.
 *
 * MANUAL, AND SHAPED FOR THE PARSER. There is no Highway API. Every figure is read off Highway by the
 * agent and typed here, and every field is named after the column that already exists in the warehouse
 * Highway snapshot, so wiring a parser later is a mapping rather than a redesign of this screen.
 *
 * THE SOP'S CAVEAT IS THE THING TO GET RIGHT: "Fleet size and requested cards are risk indicators, but
 * do not automatically cap the LOC for legitimate non-carrier or financially strong applicants." The
 * cards-against-fleet reading below is therefore an indicator that takes no part in the pass gate —
 * see `cardsVsFleet` and `highwayCanPass`.
 */
import { useMemo, useState } from 'react';
import { Badge, Button, Icon } from '@/ds';
import { saveHighwayReview } from '@/api/verificationDeskWrites';
import type { VerificationDeskDetail } from '@/api/verificationFlow';
import { CaseMarkGroup, type MarkOption } from './CaseMarkGroup';
import { ReviewFieldGrid, ReviewSelect } from './CaseReviewFields';
import { parseReviewField, reviewBody, type ReviewValues } from './caseCreditBanking';
import {
  cardsVsFleet,
  HIGHWAY_ACTIVITY,
  HIGHWAY_CHECKS,
  HIGHWAY_ELD,
  HIGHWAY_FIELDS,
  HIGHWAY_SAFETY_TRENDS,
  highwayRuled,
  highwayTone,
  highwayValuesFrom,
  type HighwayActivity,
  type HighwayEld,
  type HighwayMark,
  type HighwayMarks,
  type HighwaySafetyTrend,
  type HighwayVerdict,
} from './caseHighway';

const MARKS: ReadonlyArray<MarkOption<HighwayMark>> = [
  { id: 'ok', label: 'OK', icon: 'check_circle', tone: 'good', hint: 'Read and consistent' },
  {
    id: 'concern',
    label: 'Concern',
    icon: 'warning',
    tone: 'bad',
    hint: 'Read, and it does not sit right',
  },
  {
    id: 'missing',
    label: 'Not shown',
    icon: 'block',
    tone: 'warn',
    hint: 'Highway does not carry it — an absence, not a finding',
  },
];

/** The SOP's two branches. `discrepancy` is its words: a SUSPICIOUS discrepancy, not any difference. */
const VERDICTS: ReadonlyArray<MarkOption<HighwayVerdict>> = [
  {
    id: 'consistent',
    label: 'Consistent',
    icon: 'check_circle',
    tone: 'good',
    hint: 'Highway matches the reported business — continue to Phase 9',
  },
  {
    id: 'discrepancy',
    label: 'Suspicious discrepancy',
    icon: 'gavel',
    tone: 'bad',
    hint: 'Goes to Manager Review',
  },
];

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

export function HighwayPane({
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
  marks: HighwayMarks;
  onMarks: (next: HighwayMarks) => void;
  canAct: boolean;
  busy: boolean;
  onSaved: (run: () => Promise<VerificationDeskDetail>) => void;
}) {
  const phase = detail.rail.find((p) => p.code === 'p8_highway');
  const stored = (phase?.findings ?? null) as Record<string, unknown> | null;

  // Seeded ONCE from what a previous sitting recorded — this review is filled across visits.
  const [values, setValues] = useState<ReviewValues>(() => highwayValuesFrom(stored));
  const [safetyRating, setSafetyRating] = useState(text(stored?.safetyRating));
  const [safetyTrend, setSafetyTrend] = useState<HighwaySafetyTrend | null>(
    () => (stored?.safetyTrend as HighwaySafetyTrend | undefined) ?? null,
  );
  const [eldStatus, setEldStatus] = useState<HighwayEld | null>(
    () => (stored?.eldStatus as HighwayEld | undefined) ?? null,
  );
  const [activity, setActivity] = useState<HighwayActivity | null>(
    () => (stored?.currentActivity as HighwayActivity | undefined) ?? null,
  );
  const [operatingStatus, setOperatingStatus] = useState(text(stored?.operatingStatus));
  const [insuranceExpiry, setInsuranceExpiry] = useState(text(stored?.insuranceExpiry));
  const [note, setNote] = useState(text(stored?.note));

  const { body, rejected } = useMemo(() => reviewBody(HIGHWAY_FIELDS, values), [values]);
  const invalid = useMemo(() => {
    const bad = new Set<string>();
    for (const field of HIGHWAY_FIELDS) if (rejected.includes(field.label)) bad.add(field.id);
    return bad;
  }, [rejected]);

  const cards = cardsVsFleet(detail.case.fuelCardsRequested, values.observedPowerUnits);
  const ruled = highwayRuled(marks);
  const disabled = !canAct || busy;

  /**
   * Observed against reported power units — the discrepancy this phase is most likely to turn on, and
   * the one figure Highway gives us twice. Only meaningful when both are recorded.
   */
  const observed = parseReviewField('count', values.observedPowerUnits ?? '');
  const reported = parseReviewField('count', values.reportedPowerUnits ?? '');
  const unitGap =
    typeof observed === 'number' && typeof reported === 'number' ? observed - reported : null;

  const save = (): void => {
    onSaved(() =>
      saveHighwayReview(caseId, {
        ...body,
        safetyRating: safetyRating.trim() === '' ? null : safetyRating.trim(),
        safetyTrend,
        eldStatus,
        currentActivity: activity,
        operatingStatus: operatingStatus.trim() === '' ? null : operatingStatus.trim(),
        insuranceExpiry: insuranceExpiry.trim() === '' ? null : insuranceExpiry.trim(),
        checks: marks.checks,
        verdict: marks.verdict,
        note: note.trim() === '' ? null : note.trim(),
      }),
    );
  };

  return (
    <div className="va-stack">
      <div className="va-pane-head">
        <h3 className="t-eyebrow va-pane-kicker">Highway operational review</h3>
        <span className="va-pane-note">
          {ruled} of {HIGHWAY_CHECKS.length} items ruled on · read in Highway, typed here
        </span>
      </div>

      <p className="va-aside-note">
        There is no Highway integration, so every figure below is what the agent read on the screen.
        The field names match Highway&rsquo;s own, so a parser can fill them later without this pane
        changing.
      </p>

      {/* CARDS AGAINST FLEET — the SOP's named indicator, and the SOP is explicit that it is NOT a cap.
          Rendered as a reading with that sentence attached, and it takes no part in the pass gate. */}
      {cards ? (
        <div className="va-order-card" data-tone={cards.excess > 0 ? undefined : 'good'}>
          <span className="va-order-kicker">Cards requested against fleet</span>
          <strong className="va-order-value">
            {cards.cards} / {cards.units}
          </strong>
          <p className="va-pane-body">{cards.note}</p>
          {cards.excess > 0 ? (
            <p className="va-aside-note">
              Fleet size and requested cards are <strong>risk indicators</strong>. They do not cap the
              limit on their own — a legitimate non-carrier or a financially strong applicant may
              reasonably ask for more.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="va-field-group">
        <div className="va-pane-head" data-stack="true">
          <h4 className="t-eyebrow va-pane-kicker">What Highway shows</h4>
        </div>
        <ReviewFieldGrid
          fields={HIGHWAY_FIELDS}
          values={values}
          disabled={disabled}
          idPrefix="va-p8"
          invalid={invalid}
          onChange={(id, next) => setValues((prev) => ({ ...prev, [id]: next }))}
        />
        {/* THE TWO POWER-UNIT FIGURES DISAGREEING is the discrepancy this phase most often turns on,
            so the subtraction is done here rather than left for the reviewer to spot. */}
        {unitGap !== null && unitGap !== 0 ? (
          <p className="va-aside-note">
            Highway observes <strong>{Math.abs(unitGap)}</strong>{' '}
            {unitGap > 0 ? 'more' : 'fewer'} power unit{Math.abs(unitGap) === 1 ? '' : 's'} than the
            carrier reports. Worth resolving before ruling on consistency.
          </p>
        ) : null}
        <div className="va-fields">
          <div className="va-field">
            <label className="va-field-label" htmlFor="va-p8-safety-rating">
              Safety rating
            </label>
            <input
              id="va-p8-safety-rating"
              className="va-type-select"
              value={safetyRating}
              placeholder="Not recorded"
              disabled={disabled}
              onChange={(e) => setSafetyRating(e.currentTarget.value)}
            />
          </div>
          <ReviewSelect
            id="va-p8-safety-trend"
            label="Safety trend"
            value={safetyTrend}
            options={HIGHWAY_SAFETY_TRENDS}
            disabled={disabled}
            placeholder="Not assessed"
            onChange={setSafetyTrend}
          />
          <ReviewSelect
            id="va-p8-eld"
            label="Logbook / ELD"
            value={eldStatus}
            options={HIGHWAY_ELD}
            disabled={disabled}
            placeholder="Not assessed"
            onChange={setEldStatus}
          />
          <ReviewSelect
            id="va-p8-activity"
            label="Current operating activity"
            value={activity}
            options={HIGHWAY_ACTIVITY}
            disabled={disabled}
            placeholder="Not assessed"
            onChange={setActivity}
          />
          <div className="va-field">
            <label className="va-field-label" htmlFor="va-p8-operating">
              Operating status
            </label>
            <input
              id="va-p8-operating"
              className="va-type-select"
              value={operatingStatus}
              placeholder="Not recorded"
              disabled={disabled}
              onChange={(e) => setOperatingStatus(e.currentTarget.value)}
            />
          </div>
          <div className="va-field">
            <label className="va-field-label" htmlFor="va-p8-ins-exp">
              Insurance expiry
            </label>
            <input
              id="va-p8-ins-exp"
              type="date"
              className="va-type-select"
              value={insuranceExpiry}
              disabled={disabled}
              onChange={(e) => setInsuranceExpiry(e.currentTarget.value)}
            />
          </div>
        </div>
      </div>

      {/* THE SOP'S REVIEW ITEMS. `Not shown` is its own mark rather than a blank, because Highway
          genuinely not carrying a figure is a state the reviewer has established — and it must not
          read as a concern. */}
      <div className="va-field-group">
        <div className="va-pane-head" data-stack="true">
          <h4 className="t-eyebrow va-pane-kicker">Rule on each</h4>
        </div>
        <div className="va-id-checks">
          {HIGHWAY_CHECKS.map((check) => {
            const mark = marks.checks[check.id];
            return (
              <div className="va-id-check" key={check.id} data-mark={highwayTone(mark)}>
                <div className="va-id-check-copy">
                  <span className="va-id-check-label">{check.label}</span>
                  {check.hint ? <span className="va-id-check-value">{check.hint}</span> : null}
                </div>
                <CaseMarkGroup
                  ariaLabel={check.label}
                  options={MARKS}
                  value={mark ?? null}
                  disabled={!canAct}
                  onChange={(next) =>
                    onMarks({ ...marks, checks: { ...marks.checks, [check.id]: next } })
                  }
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="va-field">
        <label className="va-field-label" htmlFor="va-p8-note">
          Note
        </label>
        <textarea
          id="va-p8-note"
          className="va-textarea"
          rows={2}
          value={note}
          placeholder="What Highway showed that the figures do not carry"
          disabled={disabled}
          onChange={(e) => setNote(e.currentTarget.value)}
        />
      </div>

      {/* THE DECISION. The SOP's own question, and its two answers. */}
      <div
        className="va-id-check"
        data-mark={
          marks.verdict === 'consistent' ? 'ok' : marks.verdict === 'discrepancy' ? 'inconsistent' : 'unset'
        }
      >
        <div className="va-id-check-copy">
          <span className="va-id-check-label">
            Highway and operating information consistent?
            {marks.verdict === 'discrepancy' ? (
              <Badge intent="warning" size="sm" icon="gavel">
                Manager Review
              </Badge>
            ) : null}
          </span>
          <span className="va-id-check-value">
            Consistent continues to Phase 9. A suspicious discrepancy goes to the manager — every item
            above has to be ruled on either way.
          </span>
        </div>
        <CaseMarkGroup
          ariaLabel="Highway consistency"
          options={VERDICTS}
          value={marks.verdict}
          disabled={!canAct}
          onChange={(next) => onMarks({ ...marks, verdict: next })}
        />
      </div>

      {rejected.length > 0 ? (
        <p className="va-aside-note">
          Not saved: {rejected.join(', ')} —{' '}
          {rejected.length === 1 ? 'that field is' : 'those fields are'} not a number. Everything else
          on this review still saves.
        </p>
      ) : null}

      {marks.verdict === 'discrepancy' ? (
        <div className="va-banner" data-tone="warning" role="status">
          <span className="va-banner-glyph" aria-hidden="true">
            <Icon name="warning" size="sm" />
          </span>
          <span className="va-banner-text">
            <span className="va-banner-title">This goes to Manager Review, not to a decline</span>
            <p className="va-banner-body">
              A discrepancy in Highway is a question about the operation, and the manager may still
              approve, ask for more, apply conditions, or decline. Record what you saw in the note.
            </p>
          </span>
        </div>
      ) : null}

      {canAct ? (
        <div className="va-save">
          <Button variant="secondary" icon="save" loading={busy} disabled={disabled} onClick={save}>
            Save Highway review
          </Button>
        </div>
      ) : (
        <p className="va-aside-note">This case is not open for editing, so the review is read-only.</p>
      )}
    </div>
  );
}
