/**
 * The desk's own ten-phase spine, read-only on Sales.
 *
 * This is `PhaseSpine` — the same component CaseView renders. A third rail would drift the moment
 * the desk changed a label.
 *
 * The `[data-mytrion='verification']` scope its stylesheet needs comes from the ancestor
 * `VerificationDeskSurface` the case root is wrapped in, so there is nothing to declare here. It used
 * to carry `className="va-case"` to borrow the root's flex column — which nested a second `.va-case`
 * inside the first and re-declared its gap around a single panel.
 */
import type { ApplicationDetail, VerificationRailPhase } from '@/api/verificationFlow';
import { PhaseSpine } from '../../verification/applicants/PhaseSpine';
import { SALES_PHASE_SHORT } from './salesVerificationQueue';
import '../../verification/applicants/applicants.css';
import '../../verification/applicants/applicantsCase.css';

function activeCodeOf(phases: VerificationRailPhase[], fallback: string): string {
  return (
    phases.find((p) => p.status === 'in_progress')?.code ??
    phases.find((p) => p.applies && p.status === 'not_started')?.code ??
    fallback
  );
}

export function VerificationProgress({ detail }: { detail: ApplicationDetail }) {
  const phases = detail.phases ?? [];
  if (phases.length === 0) {
    return <p className="ss-vf-intake-empty">No phases yet.</p>;
  }

  const passed = phases.filter((p) => p.status === 'passed').length;
  const notApplicable = phases.filter((p) => !p.applies || p.status === 'skipped').length;
  const remaining = phases.length - passed - notApplicable;

  return (
    <div className="ss-vf-spine-host">
      <PhaseSpine
        rail={phases}
        activeCode={activeCodeOf(phases, detail.case.phaseCode)}
        passed={passed}
        remaining={remaining}
        notApplicable={notApplicable}
        /* The desk's own rail, in Sales' words — the phase NUMBERS and states are the desk's, the
           names are not. See `SALES_PHASE_LABEL`. */
        labels={SALES_PHASE_SHORT}
      />
    </div>
  );
}
