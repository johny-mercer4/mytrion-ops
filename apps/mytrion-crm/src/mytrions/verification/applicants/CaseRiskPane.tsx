/**
 * Phase 9 — risk tier and credit capacity.
 *
 * WHAT WAS WRONG. The pane was three tier buttons, a free-text note and a compute button, built from
 * inline `style={s('padding:14px;font-size:14px')}` strings — a different visual language from every
 * `.va-*` pane, and one that bypasses the type scale. Three things it did not do:
 *
 *  - THE TIER HAD NO BASIS. The SOP assigns it from six named inputs; there was nowhere to record any
 *    of them, so a tier was a button click with no working shown.
 *  - IT DEFAULTED TO STRONG. A reviewer who saved without thinking priced the case at the most
 *    generous factor in policy. It starts unset now.
 *  - THREE FIELDS WERE ACCEPTED, STORED, AND NEVER SENT. `businessAgeMonths`, `authorityAgeMonths` and
 *    `keyRisks` all exist on the route and in the table, and "key risks" is one of the sixteen lines
 *    the SOP requires of the underwriting summary. The pane sent none of them.
 *
 * AND THE CAPACITY WAS INVISIBLE UNTIL AFTER SAVING. The figures rendered only once a limit had been
 * computed, so the reviewer chose a tier without seeing what it would price. The three SOP steps are
 * shown live off the stored banking review now — as a PREVIEW, because the server computes the stored
 * answer from the same figures and its version is the one that counts.
 */
import { useMemo, useState } from 'react';
import { Badge, Button, Icon, Input } from '@/ds';
import type { VerificationDeskDetail, VerificationRiskTier } from '@/api/verificationFlow';
import { CaseMarkGroup, type MarkOption } from './CaseMarkGroup';
import {
  capacityPreview,
  reviewsOutstanding,
  riskInputsFor,
  riskInputsRead,
  riskMoney,
  riskReadTone,
  tierFromReads,
  type RiskMarks,
  type RiskRead,
} from './caseRisk';

/** The three reads an input can get — the same words as the tier, because that is what they feed. */
const READS: ReadonlyArray<MarkOption<RiskRead>> = [
  { id: 'strong', label: 'Strong', icon: 'check_circle', tone: 'good' },
  { id: 'moderate', label: 'Moderate', icon: 'warning', tone: 'warn' },
  { id: 'weak', label: 'Weak', icon: 'block', tone: 'bad' },
];

const TIERS: readonly VerificationRiskTier[] = ['strong', 'moderate', 'weak'];

/** Exactly what `POST /risk` accepts. Every optional field is one the pane never used to send. */
export interface RiskAssessmentBody {
  riskTier: VerificationRiskTier;
  businessAgeMonths?: number;
  authorityAgeMonths?: number;
  analystRecommendation?: string;
  keyRisks?: string[];
}

const TIER_COPY: Record<VerificationRiskTier, string> = {
  strong: 'Up to approximately 80% of adjusted weekly capacity.',
  moderate: 'Factor subject to approved policy.',
  weak: 'Factor subject to approved policy.',
};

function parseCount(raw: string): number | null {
  const t = raw.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export function RiskPane({
  detail,
  marks,
  onMarks,
  canAct,
  busy,
  onSave,
}: {
  detail: VerificationDeskDetail;
  marks: RiskMarks;
  onMarks: (next: RiskMarks) => void;
  canAct: boolean;
  busy: boolean;
  /** Typed to the route's own body: a `Record<string, unknown>` here would let a missing tier ship. */
  onSave: (body: RiskAssessmentBody) => void;
}) {
  const stored = detail.risk;
  const applicantType = detail.case.applicantType;
  const inputs = riskInputsFor(applicantType);

  const [businessAge, setBusinessAge] = useState(
    stored?.businessAgeMonths == null ? '' : String(stored.businessAgeMonths),
  );
  const [authorityAge, setAuthorityAge] = useState(
    stored?.authorityAgeMonths == null ? '' : String(stored.authorityAgeMonths),
  );
  const [note, setNote] = useState(stored?.analystRecommendation ?? '');
  const [risks, setRisks] = useState<string[]>(() => stored?.keyRisks ?? []);
  const [riskDraft, setRiskDraft] = useState('');

  const preview = useMemo(() => capacityPreview(detail, marks.tier), [detail, marks.tier]);
  const suggested = tierFromReads(marks, applicantType);
  const outstanding = reviewsOutstanding(detail);
  const read = riskInputsRead(marks, applicantType);
  const disabled = !canAct || busy;

  const addRisk = (): void => {
    const v = riskDraft.trim();
    if (v === '' || risks.includes(v)) return;
    setRisks((prev) => [...prev, v]);
    setRiskDraft('');
  };

  const save = (): void => {
    if (marks.tier === null) return;
    const business = parseCount(businessAge);
    const authority = parseCount(authorityAge);
    onSave({
      riskTier: marks.tier,
      ...(business === null ? {} : { businessAgeMonths: business }),
      ...(authority === null ? {} : { authorityAgeMonths: authority }),
      ...(note.trim() === '' ? {} : { analystRecommendation: note.trim() }),
      ...(risks.length === 0 ? {} : { keyRisks: risks }),
    });
  };

  return (
    <div className="va-stack">
      <div className="va-pane-head">
        <h3 className="t-eyebrow va-pane-kicker">Risk tier &amp; credit capacity</h3>
        <span className="va-pane-note">
          {read} of {inputs.length} inputs read
          {marks.tier ? ` · ${marks.tier}` : ' · no tier assigned'}
        </span>
      </div>

      {/* THE SERVER REFUSES WITHOUT BOTH REVIEWS, and says so on click. Saying it here instead means
          the reviewer is not sent to fetch something after choosing a tier. */}
      {outstanding.length > 0 ? (
        <div className="va-banner" data-tone="warning" role="status">
          <span className="va-banner-glyph" aria-hidden="true">
            <Icon name="warning" size="sm" />
          </span>
          <span className="va-banner-text">
            <span className="va-banner-title">
              Both Phase 6 reviews are needed before a capacity can be computed
            </span>
            <p className="va-banner-body">
              The {outstanding.join(' and ')} review {outstanding.length === 1 ? 'is' : 'are'} still
              outstanding. A capacity built on banking alone looks just as authoritative as a complete
              one, which is why it is refused rather than estimated.
            </p>
          </span>
        </div>
      ) : null}

      {/* THE THREE SOP STEPS, LIVE. Income − expenses, plus fuel back, times the factor. Shown before
          the reviewer commits to a tier, because choosing one blind is the thing this replaces. */}
      {preview ? (
        <div className="va-field-group">
          <div className="va-pane-head" data-stack="true">
            <h4 className="t-eyebrow va-pane-kicker">Capacity preview</h4>
            <span className="va-pane-note">From the recorded banking review</span>
          </div>
          <div className="va-figs">
            <span className="va-fig">
              <span className="t-eyebrow">Weekly net cash flow</span>
              <span className="va-fig-v">{riskMoney(preview.netCashFlow)}</span>
            </span>
            <span className="va-fig">
              <span className="t-eyebrow">+ weekly fuel</span>
              <span className="va-fig-v">{riskMoney(preview.fuel)}</span>
            </span>
            <span className="va-fig">
              <span className="t-eyebrow">Adjusted weekly capacity</span>
              <span className="va-fig-v">{riskMoney(preview.adjustedCapacity)}</span>
            </span>
            <span className="va-fig">
              <span className="t-eyebrow">Risk factor</span>
              <span className="va-fig-v" data-empty={preview.riskFactor === null ? true : undefined}>
                {preview.riskFactor === null ? '—' : preview.riskFactor}
              </span>
            </span>
          </div>

          {/* FUEL IS ADDED BACK, NOT ADDED TWICE — the SOP says so, and the server refuses a 422 when
              it is violated. Better learned here than after a click. */}
          {preview.fuelDoubleCounted ? (
            <div className="va-banner" data-tone="danger" role="status">
              <span className="va-banner-glyph" aria-hidden="true">
                <Icon name="error" size="sm" />
              </span>
              <span className="va-banner-text">
                <span className="va-banner-title">Fuel is being double-counted</span>
                <p className="va-banner-body">
                  Recorded weekly fuel ({riskMoney(preview.fuel)}) exceeds total recurring weekly
                  expenses ({riskMoney(preview.expenses)}), so fuel was entered outside those expenses
                  — adding it back inflates the limit. Correct it in the banking review; this will be
                  refused otherwise.
                </p>
              </span>
            </div>
          ) : (
            <p className="va-aside-note">
              Fuel is added back because the card displaces that spend, and it must already be inside
              recurring expenses — otherwise step 2 adds capacity step 1 never subtracted.
            </p>
          )}

          <div className="va-order-card" data-tone={preview.recommendedLimit === null ? undefined : 'good'}>
            <span className="va-order-kicker">Recommended limit</span>
            <strong className="va-order-value">
              {preview.recommendedLimit === null ? 'No factor' : riskMoney(preview.recommendedLimit)}
            </strong>
            <p className="va-pane-body">
              {marks.tier === null
                ? 'Assign a tier below to price the capacity.'
                : preview.recommendedLimit === null
                  ? `No approved risk factor is set for the ${marks.tier} tier, so no limit can be recommended. An admin sets it in Verification policy — the calculator will not guess one.`
                  : `${riskMoney(preview.adjustedCapacity)} × ${preview.riskFactor} on the ${marks.tier} tier.`}
            </p>
            {detail.case.requestedLimit ? (
              <p className="va-aside-note">
                Requested: {riskMoney(Number(detail.case.requestedLimit))}
                {preview.recommendedLimit !== null &&
                Number(detail.case.requestedLimit) > preview.recommendedLimit
                  ? ' — above what the capacity supports.'
                  : ''}
              </p>
            ) : null}
          </div>
        </div>
      ) : outstanding.length === 0 ? (
        <p className="va-aside-note">
          The banking review has not recorded recurring weekly income, expenses and fuel, so no
          capacity can be computed yet.
        </p>
      ) : null}

      {/* THE SIX SOP INPUTS. This is what a tier is assigned FROM, and there was nowhere to put any
          of it — so a tier was a button click with no working shown. */}
      <div className="va-field-group">
        <div className="va-pane-head" data-stack="true">
          <h4 className="t-eyebrow va-pane-kicker">Read each input</h4>
          {applicantType !== 'carrier' ? (
            <span className="va-pane-note">Authority age and Highway do not apply here</span>
          ) : null}
        </div>
        <div className="va-id-checks">
          {inputs.map((input) => {
            const value = marks.inputs[input.id];
            return (
              <div className="va-id-check" key={input.id} data-mark={riskReadTone(value)}>
                <div className="va-id-check-copy">
                  <span className="va-id-check-label">{input.label}</span>
                  {input.hint ? <span className="va-id-check-value">{input.hint}</span> : null}
                </div>
                <CaseMarkGroup
                  ariaLabel={input.label}
                  options={READS}
                  value={value ?? null}
                  disabled={!canAct}
                  onChange={(next) =>
                    onMarks({ ...marks, inputs: { ...marks.inputs, [input.id]: next } })
                  }
                />
              </div>
            );
          })}
        </div>
        <div className="va-fields">
          <div className="va-field">
            <label className="va-field-label" htmlFor="va-p9-business-age">
              Business age<span className="va-field-unit"> · mo</span>
            </label>
            <Input
              id="va-p9-business-age"
              value={businessAge}
              placeholder="Not recorded"
              inputMode="numeric"
              disabled={disabled}
              fullWidth
              onChange={(e) => setBusinessAge(e.currentTarget.value)}
            />
          </div>
          {applicantType === 'carrier' ? (
            <div className="va-field">
              <label className="va-field-label" htmlFor="va-p9-authority-age">
                Authority age<span className="va-field-unit"> · mo</span>
              </label>
              <Input
                id="va-p9-authority-age"
                value={authorityAge}
                placeholder="Not recorded"
                inputMode="numeric"
                disabled={disabled}
                fullWidth
                onChange={(e) => setAuthorityAge(e.currentTarget.value)}
              />
            </div>
          ) : null}
        </div>
      </div>

      {/* THE TIER. Unset until chosen, and each option states what the policy actually allows for it —
          "subject to approved policy" is the SOP's own wording for moderate and weak. */}
      <div className="va-field-group">
        <div className="va-pane-head" data-stack="true">
          <h4 className="t-eyebrow va-pane-kicker">Assign the tier</h4>
        </div>
        {/* A REAL radiogroup. `role="radio"` outside one is not a group at all — arrow keys do not
            traverse it and a screen reader announces three unrelated radios. */}
        <div className="va-id-checks" role="radiogroup" aria-label="Risk tier">
          {TIERS.map((t) => {
            const priceable = detail.policy.tierPriceable[t];
            const active = marks.tier === t;
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={active}
                className="va-review-step"
                data-active={active || undefined}
                disabled={!canAct}
                onClick={() => onMarks({ ...marks, tier: t })}
              >
                <span className="va-review-step-copy">
                  <span className="va-review-step-label" style={{ textTransform: 'capitalize' }}>
                    {t}
                  </span>
                  <span className="va-review-step-note">
                    {TIER_COPY[t]}
                    {priceable ? '' : ' No factor set.'}
                  </span>
                </span>
                {priceable ? (
                  <Badge intent="success" size="sm" icon="check_circle">
                    Priceable
                  </Badge>
                ) : (
                  <Badge intent="warning" size="sm" icon="warning">
                    No factor
                  </Badge>
                )}
              </button>
            );
          })}
        </div>

        {/* WHAT THE SIX READS POINT AT. Never applied — the SOP has a human assign the tier — and the
            rule is the conservative one: a tier cannot be better than its worst input. */}
        {suggested && marks.tier !== suggested ? (
          <div className="va-ask">
            <span className="va-aside-note">
              The inputs read <strong>{suggested}</strong> — a tier cannot be better than its weakest
              input.
            </span>
            <div className="va-ask-actions">
              <Button
                variant="secondary"
                size="sm"
                icon="check"
                disabled={!canAct}
                onClick={() => onMarks({ ...marks, tier: suggested })}
              >
                Use {suggested}
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {/* KEY RISKS — one of the sixteen lines the SOP requires of the underwriting summary, accepted by
          the route and stored in the table, and captured nowhere until now. */}
      <div className="va-field-group">
        <div className="va-pane-head" data-stack="true">
          <h4 className="t-eyebrow va-pane-kicker">Key risks</h4>
          <span className="va-pane-note">
            {risks.length === 0 ? 'None recorded' : `${risks.length} recorded`}
          </span>
        </div>
        {risks.length > 0 ? (
          <ul className="va-banner-list">
            {risks.map((r) => (
              <li key={r}>
                {r}
                {canAct ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="close"
                    aria-label={`Remove ${r}`}
                    onClick={() => setRisks((prev) => prev.filter((x) => x !== r))}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {canAct ? (
          <div className="va-ask">
            <Input
              value={riskDraft}
              placeholder="A risk this file carries"
              disabled={disabled}
              fullWidth
              onChange={(e) => setRiskDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addRisk();
                }
              }}
            />
            <div className="va-ask-actions">
              <Button
                variant="secondary"
                size="sm"
                icon="check"
                disabled={disabled || riskDraft.trim() === ''}
                onClick={addRisk}
              >
                Add
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="va-field">
        <label className="va-field-label" htmlFor="va-p9-note">
          Analyst recommendation
        </label>
        <textarea
          id="va-p9-note"
          className="va-textarea"
          rows={3}
          value={note}
          placeholder="What you would do with this file, and why"
          disabled={disabled}
          onChange={(e) => setNote(e.currentTarget.value)}
        />
      </div>

      {canAct ? (
        <div className="va-save">
          <Button
            variant="secondary"
            icon="save"
            loading={busy}
            disabled={disabled || marks.tier === null || outstanding.length > 0}
            onClick={save}
          >
            Assess risk &amp; compute limit
          </Button>
          {marks.tier === null ? (
            <span className="va-save-hint">Assign a tier first.</span>
          ) : preview?.recommendedLimit === null ? (
            <span className="va-save-hint">
              Saves the assessment; no limit until the {marks.tier} factor is set in policy.
            </span>
          ) : null}
        </div>
      ) : (
        <p className="va-aside-note">This case is not open for editing, so the assessment is read-only.</p>
      )}

      {/* WHAT WAS ACTUALLY STORED, once it has been. The preview above is arithmetic; this is the
          record Phase 10 prices the approval from. */}
      {stored?.recommendedLimit ? (
        <p className="va-aside-note">
          Stored: {stored.riskTier} tier, factor {stored.riskFactor ?? '—'}, capacity{' '}
          {stored.adjustedWeeklyCapacity ?? '—'}, recommended {stored.recommendedLimit}
          {stored.computedAt ? ` · computed ${new Date(stored.computedAt).toLocaleString()}` : ''}
        </p>
      ) : null}
    </div>
  );
}
