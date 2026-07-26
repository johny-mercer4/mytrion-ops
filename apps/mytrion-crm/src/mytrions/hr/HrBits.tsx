import type { ReactNode } from 'react';
import { FlaskConical } from 'lucide-react';
import { findHrTab, type HrTabId } from './hrNav';

/**
 * Small shared pieces every HR tab uses — the page head, the preview banner, section headings and
 * the status pill. Kept here so the five tabs stay thin and structurally identical.
 */

/**
 * The honesty notice. HR is UI/UX scaffolding: nothing on any tab reads Zoho People yet, and the
 * rows shown are synthetic (see peoplePreview.ts). This renders on EVERY tab on purpose — a
 * placeholder screen that doesn't announce itself is how mock data ends up quoted as fact.
 */
export function PreviewBanner({ what }: { what: string }) {
  return (
    <div className="hr-banner">
      <FlaskConical size={15} />
      <span>
        <strong>Layout preview.</strong> {what} is not connected to Zoho People yet — the records
        below are placeholders, not real employee data.
      </span>
    </div>
  );
}

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
