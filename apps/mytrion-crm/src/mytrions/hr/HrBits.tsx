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

/**
 * The toolbar, as a skeleton.
 *
 * The header used to be the one part of the page that lied while loading: the filter bar rendered
 * fully-formed with live-looking controls and an authoritative "213 employees" the moment the tab
 * opened, above a grid of shimmering placeholders. Every one of those was inert — the dropdowns had no
 * options and the count was whatever the previous render left. Shaping it like the real bar keeps the
 * page from reflowing when data lands, and keeps it from claiming things it does not know yet.
 *
 * `slots` mirrors the real toolbar's control count so the two line up.
 */
export function HrToolbarSkeleton({ slots = 4 }: { slots?: number }) {
  return (
    <div className="hr-toolbar is-loading" aria-hidden="true">
      <span className="hr-sk-bar hr-sk-search" />
      {Array.from({ length: slots }, (_, i) => (
        <span key={i} className="hr-sk-bar hr-sk-control" />
      ))}
      <span className="hr-sk-bar hr-sk-count" />
    </div>
  );
}

/** The page-head action buttons, as skeletons — same height and gap as the real ones. */
export function HrHeadActionsSkeleton({ buttons = 2 }: { buttons?: number }) {
  return (
    <div className="hr-head-actions" aria-hidden="true">
      {Array.from({ length: buttons }, (_, i) => (
        <span key={i} className="hr-sk-bar hr-sk-btn" />
      ))}
    </div>
  );
}

/**
 * The card-shaped grid skeleton — HR's ONE loader.
 *
 * Kept here rather than inlined per tab so every grid uses the same count and shape, and so no tab
 * grows a spinner beside it. `aria-busy` + a label is what a screen reader gets; the shimmer is
 * decoration and is hidden from the tree.
 */
export function HrCardGridSkeleton({
  count = 8,
  label,
  /** The real grid's class, so the skeleton has the SAME column geometry and the page cannot jump. */
  gridClass = 'hr-empc-grid',
}: {
  count?: number;
  label: string;
  gridClass?: string;
}) {
  return (
    /* role="status" so the label is actually announced — aria-label on a plain div is not. */
    <div className={gridClass} role="status" aria-busy="true" aria-label={label}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="hr-sk" />
      ))}
    </div>
  );
}

/**
 * A small inline spinner for a WRITE in flight.
 *
 * Distinct from the skeletons on purpose: a skeleton stands in for content that does not exist yet,
 * whereas a save has content on screen already and needs to say "working" without replacing it. Used
 * inside buttons and on the card whose row is being saved.
 */
export function HrBusy({ label }: { label?: string }) {
  return (
    <span className="hr-busy" role="status" aria-live="polite">
      <span className="hr-busy-ring" aria-hidden="true" />
      {label ? <span className="hr-busy-label">{label}</span> : <span className="hr-sr">Working…</span>}
    </span>
  );
}
