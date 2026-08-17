/**
 * The 10-phase rail — one pane at a time.
 *
 * This answers the standing P1 on this desk ("Pipeline + Plaid + files still one scroll"): the rail
 * is the navigation, so a case never becomes a scroll to read.
 *
 * A skipped phase renders as SKIPPED with its reason, never omitted and never green. A rail that
 * quietly hid Phase 4 for an owner-operator would read as "authority was checked".
 */
import { Check } from 'lucide-react';
import type { VerificationPhaseStatus, VerificationRailPhase } from '@/api/verificationFlow';

/** Short, human labels. A raw status code must never reach a screen. */
const STATE_LABEL: Record<VerificationPhaseStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  passed: 'Passed',
  pending_docs: 'Pending documents',
  manager_review: 'Manager review',
  failed: 'Declined',
  skipped: 'Not applicable',
};

export function phaseStateLabel(status: VerificationPhaseStatus): string {
  return STATE_LABEL[status] ?? 'Not started';
}

export function PhaseRail({
  rail,
  activeCode,
  currentCode,
  onSelect,
}: {
  rail: VerificationRailPhase[];
  activeCode: string;
  /** Where the case actually is, as opposed to which pane the reviewer is reading. */
  currentCode: string;
  onSelect: (code: string) => void;
}) {
  return (
    <nav aria-label="Underwriting phases">
      <ol className="vfx-rail">
        {rail.map((phase) => {
          const active = phase.code === activeCode;
          const isCurrent = phase.code === currentCode && phase.applies;
          return (
            <li key={phase.code}>
              <button
                type="button"
                className="vfx-rail-item"
                data-applies={phase.applies}
                aria-current={active ? 'step' : undefined}
                onClick={() => onSelect(phase.code)}
                title={phase.skipReason ?? phase.description}
              >
                <span className="vfx-rail-n" data-state={phase.status}>
                  {phase.status === 'passed' ? <Check size={13} aria-hidden /> : phase.order}
                </span>
                <span className="vfx-rail-label">
                  <span className="vfx-rail-title">{phase.label}</span>
                  <span className="vfx-rail-sub">
                    {phaseStateLabel(phase.status)}
                    {isCurrent ? ' \u00b7 current' : ''}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** The skip explanation, stated where the phase would have been worked. */
export function SkippedPane({ phase }: { phase: VerificationRailPhase }) {
  return (
    <div className="vfx-pane">
      <div className="vfx-pane-head">
        <span className="vfx-eyebrow">Phase {phase.order} of 10</span>
        <h2 className="vfx-pane-title">{phase.label}</h2>
      </div>
      <div className="vfx-banner">
        <span className="vfx-banner-title">Not applicable to this applicant</span>
        <p className="vfx-banner-body">
          {phase.skipReason ?? 'This phase does not apply to this applicant type.'}
        </p>
      </div>
    </div>
  );
}
