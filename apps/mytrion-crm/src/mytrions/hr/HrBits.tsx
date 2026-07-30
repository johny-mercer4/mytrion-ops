import type { ReactNode } from 'react';
import { MytrionPageLoader } from '../_shared/MytrionPageLoader';
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

export interface HrSummaryItem {
  label: string;
  value: string | number;
  detail: string;
  icon: ReactNode;
  tone?: string;
}

/**
 * One readable KPI treatment for the data-heavy HR tabs.
 *
 * The short label says what is counted, the large value supports scanning, and `detail` explains
 * the number without making the user infer it from neighboring filters.
 */
export function HrSummaryTiles({
  items,
  label = 'Workspace summary',
}: {
  items: HrSummaryItem[];
  label?: string;
}) {
  return (
    <section className="hr-summary-tiles" aria-label={label}>
      {items.map((item) => (
        <article
          key={item.label}
          className="hr-summary-tile"
          style={item.tone ? { ['--hr-summary-tone' as string]: item.tone } : undefined}
        >
          <span className="hr-summary-icon" aria-hidden="true">
            {item.icon}
          </span>
          <span className="hr-summary-copy">
            <span className="hr-summary-label">{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.detail}</small>
          </span>
        </article>
      ))}
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

/** The single full-surface loading state used when an HR tab has no cached content yet. */
export function HrPageLoader({ label }: { label: string }) {
  return <MytrionPageLoader label={label} detail="Preparing the latest HR workspace data" />;
}

/**
 * A small inline spinner for a WRITE in flight.
 *
 * Distinct from the page loader on purpose: a save has content on screen already and needs to say
 * "working" without replacing it. Used inside buttons and on the card whose row is being saved.
 */
export function HrBusy({ label }: { label?: string }) {
  return (
    <span className="hr-busy" role="status" aria-live="polite">
      <span className="hr-busy-ring" aria-hidden="true" />
      {label ? (
        <span className="hr-busy-label">{label}</span>
      ) : (
        <span className="hr-sr">Working…</span>
      )}
    </span>
  );
}
