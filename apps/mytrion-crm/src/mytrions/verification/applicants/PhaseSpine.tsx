/**
 * The ten-phase underwriting spine — one component, both desks.
 *
 * Verification CaseView uses it to jump phases. Sales intake reuses the same markup and CSS so
 * the agent sees the desk's own progress, not a third vertical list. `onPick` is optional: omit
 * it and the steps are not buttons.
 *
 * THE CONNECTOR IS CSS, PER SEGMENT. Each step draws the link to its left from `data-linked` on the
 * step before it — see `.va-steps > li + li::before`. There is no absolutely-positioned progress bar
 * any more; one existed, it began and ended inside the end dots rather than on their centres, and it
 * sat underneath the row where an opaque step background could bury it. Which is exactly what
 * happened when Phase 6's wizard borrowed the `.va-step` class name.
 *
 * `labels` is optional and defaults to the desk's `PHASE_SHORT`. Sales passes its own map, because
 * "Hard stops" / "Highway" / "Risk tier" name the CHECK rather than the stage, and what is being
 * looked for is the credit desk's business — see `SALES_PHASE_LABEL`.
 */
import { Icon } from '@/ds';
import type { VerificationRailPhase } from '@/api/verificationFlow';
import { PHASE_SHORT, PHASE_STATE_LABEL } from './applicantsModel';

export function PhaseSpine({
  rail,
  activeCode,
  passed,
  remaining,
  notApplicable,
  onPick,
  labels = PHASE_SHORT,
}: {
  rail: readonly VerificationRailPhase[];
  activeCode: string;
  passed: number;
  remaining: number;
  notApplicable: number;
  onPick?: (code: string) => void;
  labels?: Record<string, string>;
}) {
  const interactive = onPick != null;

  return (
    <section className="va-spine" aria-label="Underwriting phases">
      <div className="va-spine-head">
        <span className="t-eyebrow">Underwriting phases</span>
        <span className="va-spine-counts">
          <span>
            <strong className="num" data-tone="ok">
              {passed}
            </strong>{' '}
            passed
          </span>
          <span>
            <strong className="num">{remaining}</strong> remaining
          </span>
          <span>
            <strong className="num" data-tone="off">
              {notApplicable}
            </strong>{' '}
            not applicable
          </span>
        </span>
      </div>

      <div className="va-spine-track">
        <ol className="va-steps">
          {rail.map((p) => {
            const isActive = p.code === activeCode;
            const state = p.applies ? p.status : 'skipped';
            const title = `${p.label} — ${PHASE_STATE_LABEL[state]}`;
            const body = (
              <>
                <span className="va-step-dot" aria-hidden="true">
                  {state === 'passed' ? (
                    <Icon name="check" size="sm" />
                  ) : (
                    <span className="num">{p.order}</span>
                  )}
                </span>
                <span className="va-step-text">
                  <span className="va-step-label">{labels[p.code] ?? p.label}</span>
                  <span className="va-step-state">{PHASE_STATE_LABEL[state]}</span>
                </span>
              </>
            );
            return (
              /*
               * `data-linked` is THIS phase's state, read by the NEXT step to colour the link between
               * them. The connector belongs to a pair of phases, not to one, and a single
               * percentage-width bar could not express that: it said how far along the row the last
               * pass fell, which is the same number whether the phase before it passed or was skipped.
               */
              <li key={p.code} data-linked={state}>
                {interactive ? (
                  <button
                    type="button"
                    className="va-step"
                    data-state={state}
                    data-active={isActive}
                    aria-current={isActive ? 'step' : undefined}
                    title={title}
                    onClick={() => onPick(p.code)}
                  >
                    {body}
                  </button>
                ) : (
                  <div
                    className="va-step"
                    data-state={state}
                    data-active={isActive}
                    data-interactive="false"
                    aria-current={isActive ? 'step' : undefined}
                    title={title}
                  >
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
