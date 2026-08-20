/**
 * Phase 6 — both reviews, as a two-step sequence in the order Phase 5 decided.
 *
 * THE ORDER WAS DECORATIVE. Phase 5 exists to decide which review runs first — banking for a carrier
 * at or above the truck policy, credit for everyone else — and this pane rendered the two blocks as
 * side-by-side columns, so "banking first" only meant "banking on the left". On a wide screen a
 * reviewer reads both at once and the ordering the previous phase was passed to establish carried no
 * weight at all. It is a real sequence now: one step at a time, step one is whichever review Phase 5
 * put first, and moving on is a deliberate act.
 *
 * AND THE COLUMNS WERE BREAKING. `.va-id-check` is a `space-between` flex row whose mark group is
 * `flex-shrink: 0`; put a four-option group in a half-width grid column and the marks refuse to give
 * ground, so the label beside them collapsed to one word per line and the option labels clipped. One
 * full-width step per review removes the squeeze rather than papering over it.
 *
 * BOTH STEPS STAY REACHABLE. The sequence is guidance, not a lock: a reviewer who has the statements
 * open and the credit report still loading must be able to start on either, and a correction to a
 * saved step cannot require walking the whole flow again.
 */
import { useState } from 'react';
import { Badge, Button, Icon } from '@/ds';
import type { VerificationDeskDetail, VerificationReviewOrder } from '@/api/verificationFlow';
import { BankingReviewStep } from './CaseBankingReview';
import { CreditReviewStep } from './CaseCreditReview';
import { BANKING_CHECKS, bankingComplete, creditSidePass, type CreditBankingMarks } from './caseCreditBanking';
import { reviewOrderLabel } from './caseRouting';

type StepId = 'credit' | 'banking';

export function CreditBankingPane({
  detail,
  caseId,
  order,
  source,
  assumedMissingTrucks,
  marks,
  onMarks,
  canAct,
  busy,
  onSaved,
}: {
  detail: VerificationDeskDetail;
  caseId: string;
  order: VerificationReviewOrder;
  source: 'phase5' | 'computed';
  assumedMissingTrucks: boolean;
  marks: CreditBankingMarks;
  onMarks: (next: CreditBankingMarks) => void;
  canAct: boolean;
  busy: boolean;
  /** Scoped by step: a failed credit save must report beside credit, not beside banking. */
  onSaved: (scope: 'credit' | 'banking', run: () => Promise<VerificationDeskDetail>) => void;
}) {
  const sequence: readonly StepId[] =
    order === 'banking_first' ? ['banking', 'credit'] : ['credit', 'banking'];
  const [active, setActive] = useState<StepId>(() => sequence[0]!);

  /**
   * Done means RECORDED, not merely typed.
   *
   * Credit is done when a verdict passes it; banking when every judgement row has been ruled on. The
   * numeric fields deliberately do not gate a step — a reviewer may legitimately have no figure for
   * mortgages, and requiring one would invent a zero.
   */
  const done: Record<StepId, boolean> = {
    credit: creditSidePass(marks.credit),
    banking: bankingComplete(marks.banking),
  };
  const ruled = BANKING_CHECKS.filter((c) => marks.banking[c.id] !== undefined).length;

  const label: Record<StepId, string> = {
    credit: 'Credit report review',
    banking: 'Banking — last 3 months',
  };
  const activeIndex = sequence.indexOf(active);
  const next = sequence[activeIndex + 1];

  return (
    <div className="va-stack">
      <div className="va-pane-head">
        {/* `t-eyebrow va-pane-kicker` like every sibling pane; `va-phase-title` is the rail's class. */}
        <h3 className="t-eyebrow va-pane-kicker">Credit &amp; banking</h3>
        <span className="va-pane-note">
          Both reviews before Phase 7, unless the applicant is declined earlier
        </span>
      </div>

      {/* WHY THIS ORDER, stated once. It is Phase 5's decision, and a reviewer who cannot see the
          reason cannot tell a deliberate sequence from an arbitrary one. */}
      <p className="va-aside-note">
        {reviewOrderLabel(order)} —{' '}
        {source === 'phase5' ? 'confirmed in Routing' : 'the same rule as Routing, not yet confirmed'}
        {detail.case.trucksCount == null ? '' : ` · ${detail.case.trucksCount} trucks on file`}
        {assumedMissingTrucks ? ' · truck count missing, so credit leads until one is saved' : ''}
      </p>

      {/* THE STEPS. A real tablist, so arrow keys and screen readers get the sequence too — not two
          divs that only look like tabs. */}
      <div className="va-steps" role="tablist" aria-label="Phase 6 reviews">
        {sequence.map((step, index) => (
          <button
            key={step}
            type="button"
            role="tab"
            id={`va-p6-tab-${step}`}
            className="va-step"
            aria-selected={active === step}
            aria-controls={`va-p6-panel-${step}`}
            data-active={active === step || undefined}
            data-done={done[step] || undefined}
            onClick={() => setActive(step)}
          >
            <span className="va-step-index" aria-hidden="true">
              {done[step] ? <Icon name="check" size="sm" /> : index + 1}
            </span>
            <span className="va-step-copy">
              <span className="va-step-label">{label[step]}</span>
              <span className="va-step-note">
                {step === 'credit'
                  ? done.credit
                    ? 'Passes this side'
                    : marks.credit
                      ? 'Recorded — does not pass'
                      : 'No verdict yet'
                  : done.banking
                    ? 'All rows ruled on'
                    : `${ruled} of ${BANKING_CHECKS.length} rows ruled on`}
              </span>
            </span>
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`va-p6-panel-${active}`}
        aria-labelledby={`va-p6-tab-${active}`}
        className="va-step-panel"
      >
        {active === 'credit' ? (
          <CreditReviewStep
            detail={detail}
            caseId={caseId}
            marks={marks}
            onMarks={onMarks}
            canAct={canAct}
            busy={busy}
            onSaved={onSaved}
          />
        ) : (
          <BankingReviewStep
            detail={detail}
            caseId={caseId}
            marks={marks}
            onMarks={onMarks}
            canAct={canAct}
            busy={busy}
            onSaved={onSaved}
          />
        )}
      </div>

      {/* MOVING ON IS EXPLICIT, and only offered when there is somewhere to move to. A reviewer who
          finished step one should not have to work out that the tab above is now their job. */}
      {next ? (
        <div className="va-ask">
          <span className="va-aside-note">
            {done[active]
              ? `${label[active]} is recorded.`
              : `${label[active]} is not finished — you can come back to it.`}
          </span>
          <div className="va-ask-actions">
            <Button variant="secondary" size="sm" icon="check" onClick={() => setActive(next)}>
              Go to {label[next]}
            </Button>
          </div>
        </div>
      ) : done.credit && done.banking ? (
        <div className="va-ask">
          <span className="va-aside-note">
            Both reviews recorded — Phase 7 reads the numbers above for its hard stops.
          </span>
          <div className="va-ask-actions">
            <Badge intent="success" size="sm" icon="check_circle">
              Ready to pass
            </Badge>
          </div>
        </div>
      ) : null}
    </div>
  );
}
