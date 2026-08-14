/**
 * The 10-phase rail — one pane at a time.
 *
 * This is the direct answer to the standing P1 on this desk ("Pipeline + Plaid + files still one
 * scroll"). The old modal stacked every stage vertically; here the rail is the navigation and the
 * pane beside it shows only the phase you are on, so the case never becomes a scroll to read.
 *
 * A skipped phase is rendered as SKIPPED with its reason, never omitted and never green. A rail
 * that quietly hid Phase 4 for an owner-operator would read as "authority was checked".
 */
import { Icon } from '../../sales/redesign/icons';
import { s } from './style';
import type { VerificationPhaseStatus, VerificationRailPhase } from '@/api/verificationFlow';

interface StatusVisual {
  label: string;
  fg: string;
  bg: string;
  bd: string;
  icon: 'check' | 'clock' | 'warn' | 'ban' | 'doc' | 'panel';
}

const STATUS: Record<VerificationPhaseStatus, StatusVisual> = {
  not_started: {
    label: 'Not started',
    fg: 'var(--text-muted)',
    bg: 'transparent',
    bd: 'var(--border)',
    icon: 'panel',
  },
  in_progress: {
    label: 'In progress',
    fg: 'var(--accent)',
    bg: 'var(--accent-soft)',
    bd: 'var(--accent)',
    icon: 'clock',
  },
  passed: {
    label: 'Passed',
    fg: 'var(--success)',
    bg: 'var(--intent-success-bg)',
    bd: 'var(--intent-success-bd)',
    icon: 'check',
  },
  pending_docs: {
    label: 'Pending documents',
    fg: 'var(--warning)',
    bg: 'var(--intent-warning-bg)',
    bd: 'var(--intent-warning-bd)',
    icon: 'doc',
  },
  manager_review: {
    label: 'Manager review',
    fg: 'var(--warning)',
    bg: 'var(--intent-warning-bg)',
    bd: 'var(--intent-warning-bd)',
    icon: 'warn',
  },
  failed: {
    label: 'Declined',
    fg: 'var(--danger)',
    bg: 'var(--intent-danger-bg)',
    bd: 'var(--intent-danger-bd)',
    icon: 'ban',
  },
  skipped: {
    label: 'Not applicable',
    fg: 'var(--text-muted)',
    bg: 'transparent',
    bd: 'var(--border)',
    icon: 'ban',
  },
};

export function phaseVisual(status: VerificationPhaseStatus): StatusVisual {
  return STATUS[status] ?? STATUS.not_started;
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
    <nav aria-label="Underwriting phases" style={s('display:grid;gap:6px;align-content:start')}>
      {rail.map((phase) => {
        const visual = phaseVisual(phase.status);
        const active = phase.code === activeCode;
        const isCurrent = phase.code === currentCode;
        return (
          <button
            key={phase.code}
            type="button"
            onClick={() => onSelect(phase.code)}
            aria-current={active ? 'step' : undefined}
            style={s(
              `display:grid;grid-template-columns:26px 1fr;gap:10px;align-items:start;text-align:left;padding:10px 12px;border-radius:var(--radius-md);cursor:pointer;background:${
                active ? 'var(--surface-alt)' : 'transparent'
              };border:1px solid ${active ? 'var(--accent)' : 'transparent'}`,
            )}
          >
            <span
              style={s(
                `display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:var(--radius-full);font-size:11px;font-weight:800;color:${visual.fg};background:${visual.bg};border:1px solid ${visual.bd}`,
              )}
            >
              {phase.status === 'passed' ? (
                <Icon name="check" size={13} strokeWidth={2.6} />
              ) : (
                phase.order
              )}
            </span>
            <span style={s('display:grid;gap:2px;min-width:0')}>
              <span
                style={s(
                  `font-size:13px;font-weight:${active ? '800' : '600'};color:${
                    phase.applies ? 'var(--text-primary)' : 'var(--text-muted)'
                  };line-height:1.35`,
                )}
              >
                {phase.label}
              </span>
              <span style={s(`font-size:11px;color:${visual.fg};font-weight:700`)}>
                {visual.label}
                {isCurrent && phase.applies ? ' · current' : ''}
              </span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}

/** The skip explanation, stated where the phase would have been worked. */
export function SkippedPane({ phase }: { phase: VerificationRailPhase }) {
  return (
    <div
      style={s(
        'display:grid;gap:10px;padding:20px;border-radius:var(--radius-md);border:1px dashed var(--border);background:var(--surface-alt)',
      )}
    >
      <span style={s('display:flex;align-items:center;gap:9px;font-size:14px;font-weight:800;color:var(--text-secondary)')}>
        <Icon name="ban" size={16} color="var(--text-muted)" />
        {phase.label} — not applicable
      </span>
      <p style={s('margin:0;font-size:13px;color:var(--text-muted);line-height:1.55')}>
        {phase.skipReason ?? 'This phase does not apply to this applicant type.'}
      </p>
    </div>
  );
}
