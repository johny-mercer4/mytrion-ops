import type { ReactNode } from 'react';
import { findHrTab, type HrTabId } from './hrNav';

/**
 * Small shared pieces every HR tab uses — the page head, section headings and the status pill.
 * Kept here so the tabs stay thin and structurally identical.
 *
 * There is deliberately no placeholder-data banner any more: no HR tab renders invented rows, so
 * there is nothing to disclaim. Unbuilt tabs use the shared <ComingSoon /> instead.
 */

/** Kicker → title → sub, matching the Manager page head so the two modules read as one product. */
export function HrPageHead({ tab, actions }: { tab: HrTabId; actions?: ReactNode }) {
  const meta = findHrTab(tab);
  return (
    <header className="hr-head">
      <div>
        <div className="hr-kicker">People Operations</div>
        <h1 className="hr-title">{meta.label}</h1>
        <p className="hr-sub">{meta.description}</p>
      </div>
      {actions ? <div className="hr-head-actions">{actions}</div> : null}
    </header>
  );
}

export function HrSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="hr-section">
      <div className="hr-section-head">
        <h2 className="hr-section-title">{title}</h2>
        <span className="hr-section-line" />
      </div>
      {children}
    </section>
  );
}

/** Status pill. `tone` is a CSS colour/token — set as --p, which the one pill recipe reads. */
export function Pill({ label, tone }: { label: string; tone: string }) {
  return (
    <span className="hr-pill" style={{ ['--p' as string]: tone }}>
      {label}
    </span>
  );
}

/** Shared tone map so a status is the same colour on every tab. */
export const STATUS_TONE: Record<string, string> = {
  Active: 'var(--success)',
  Terminated: 'var(--text-muted)',
  Present: 'var(--success)',
  Late: 'var(--warning)',
  Absent: 'var(--danger)',
  Leave: 'var(--tone-violet)',
  Pending: 'var(--warning)',
  Approved: 'var(--success)',
  Rejected: 'var(--danger)',
};

export const toneFor = (status: string): string => STATUS_TONE[status] ?? 'var(--accent)';

/**
 * The state every tab lands in once the placeholders are removed and before the fetch exists.
 * Exported so wiring a tab up is "delete the preview block", not "invent an empty state".
 */
export function HrEmpty({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="hr-empty">
      {icon}
      <div className="hr-empty-title">{title}</div>
      <p className="hr-empty-body">{body}</p>
    </div>
  );
}
