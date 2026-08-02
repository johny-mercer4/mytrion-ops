/**
 * Sales Mytrion — the shared page scaffold every tab is built from.
 *
 * Two rules this file exists to enforce:
 *
 * 1. ONE title per screen. The shell's top bar owns the section NAME ("My Tasks"); a tab never
 *    repeats it. Before this, the top bar printed "MY TASKS · Assignments" and the page under it
 *    printed the chip "ASSIGNMENTS" over the heading "MY TASKS" — the same two words three times.
 *    A tab supplies a `description` (what the screen is for), `actions`, and `metrics`; a `title` is
 *    only for a genuine SUB-view (a record being inspected), never for the section itself.
 *
 * 2. ONE mount animation. `SalesPage`'s root carries `ss-fu`, and it stays mounted across
 *    loading → loaded, so the entry slide runs once per tab open. Skeletons and content bodies must
 *    NOT carry `ss-fu` of their own: two animated roots swapping was the "flicker" — the page slid
 *    in, then slid in again when the data landed.
 *
 * Layout classes live in ./sales-page.css.
 */
import type { CSSProperties, ReactNode } from 'react';
import { Icon, type IconName } from './icons';

export type SalesMetricTone = 'accent' | 'ok' | 'warn' | 'danger';

/**
 * `| undefined` is spelled out on every optional prop in this file on purpose: the app builds with
 * `exactOptionalPropertyTypes`, so `hint?: string` would reject `hint={maybeUndefined}` and force
 * every call site into conditional spreads for what is genuinely optional data.
 */
export interface SalesMetric {
  label: string;
  value: string | number;
  hint?: string | undefined;
  tone?: SalesMetricTone | undefined;
}

/**
 * Page wrapper. `width`:
 *  - `default` — inherits the shell's 1180px measure (every data screen).
 *  - `narrow`  — 1080px for form-shaped screens, where a full-width field row reads badly.
 * Nothing else: per-tab max-widths (1100 here, 1080 there) made the content box visibly jump
 * left and right as the user moved between tabs.
 */
export function SalesPage({
  children,
  width = 'default',
  busy,
  className,
}: {
  children: ReactNode;
  width?: 'default' | 'narrow' | undefined;
  /**
   * The page is the SINGLE `aria-busy` owner — pass it for both the cold load and a background
   * revalidation. Skeletons under it are `aria-hidden`, so assistive tech hears "busy" once instead
   * of once per placeholder block.
   */
  busy?: boolean | undefined;
  className?: string | undefined;
}) {
  return (
    <div
      className={`ss-page ss-fu${width === 'narrow' ? ' is-narrow' : ''}${className ? ` ${className}` : ''}`}
      aria-busy={busy || undefined}
    >
      {children}
    </div>
  );
}

/**
 * The one page header. `title` is deliberately optional and deliberately rare — see the note at the
 * top of this file. `eyebrow` is for live state that earns its place (e.g. "3 new"), not for a
 * restatement of the section name.
 */
export function SalesPageHead({
  description,
  title,
  eyebrow,
  eyebrowIcon,
  eyebrowTone,
  actions,
  metrics,
  children,
}: {
  description?: ReactNode;
  title?: string | undefined;
  eyebrow?: ReactNode;
  eyebrowIcon?: IconName | undefined;
  eyebrowTone?: SalesMetricTone | undefined;
  actions?: ReactNode;
  metrics?: SalesMetric[] | undefined;
  children?: ReactNode;
}) {
  const hasHeadline = Boolean(title || eyebrow || description || actions);
  return (
    <div className="ss-page-head">
      {hasHeadline && (
        <div className="ss-page-head-row">
          <div className="ss-page-head-copy">
            {eyebrow ? (
              <span className={`ss-page-eyebrow${eyebrowTone ? ` is-${eyebrowTone}` : ''}`}>
                {eyebrowIcon ? <Icon name={eyebrowIcon} size={13} /> : null}
                {eyebrow}
              </span>
            ) : null}
            {title ? <h2 className="ss-page-title">{title}</h2> : null}
            {description ? <p className="ss-page-desc">{description}</p> : null}
          </div>
          {actions ? <div className="ss-page-actions">{actions}</div> : null}
        </div>
      )}
      {metrics && metrics.length > 0 ? <SalesMetrics items={metrics} /> : null}
      {children}
    </div>
  );
}

/** The metric strip — one shape for every tab's summary figures. */
export function SalesMetrics({
  items,
  label,
}: {
  items: SalesMetric[];
  label?: string | undefined;
}) {
  return (
    <div className="ss-metrics" aria-label={label} role={label ? 'group' : undefined}>
      {items.map((m) => (
        <div key={m.label} className="ss-metric">
          <div className="ss-metric-lbl">{m.label}</div>
          <div className={`ss-metric-val${m.tone ? ` is-${m.tone}` : ''}`}>{m.value}</div>
          {m.hint ? <div className="ss-metric-hint">{m.hint}</div> : null}
        </div>
      ))}
    </div>
  );
}

export interface SalesSubTab<T extends string> {
  id: T;
  label: string;
  icon?: IconName | undefined;
  count?: number | undefined;
  /** Rendered disabled with a SOON tag; not selectable. */
  soon?: boolean | undefined;
}

/**
 * The one segmented sub-tab control. Sales previously shipped five different looks for the same
 * job — pills with `aria-pressed`, a boxed segment group, a bare button row, two hand-rolled
 * `role="tablist"`s — so switching tabs changed the shape of the control that switches tabs.
 */
export function SalesSubTabs<T extends string>({
  items,
  value,
  onChange,
  label,
  size = 'md',
}: {
  items: ReadonlyArray<SalesSubTab<T>>;
  value: T;
  onChange: (next: T) => void;
  label: string;
  size?: 'sm' | 'md' | undefined;
}) {
  return (
    <div className={`ss-subtabs${size === 'sm' ? ' is-sm' : ''}`} role="tablist" aria-label={label}>
      {items.map((t) => {
        const on = value === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            disabled={t.soon === true}
            title={t.soon ? `${t.label} — coming soon` : undefined}
            className={`ss-subtab${on ? ' is-on' : ''}`}
            onClick={t.soon ? undefined : () => onChange(t.id)}
          >
            {t.icon ? <Icon name={t.icon} size={15} /> : null}
            <span>{t.label}</span>
            {t.soon ? (
              <span className="ss-subtab-soon">Soon</span>
            ) : t.count != null ? (
              <span className="ss-subtab-count">{t.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** The one empty state. */
export function SalesEmpty({
  icon,
  tone = 'accent',
  title,
  body,
  action,
}: {
  icon: IconName;
  tone?: SalesMetricTone | undefined;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`ss-empty is-${tone}`} role="status">
      <span className="ss-empty-ico" aria-hidden="true">
        <Icon name={icon} size={26} />
      </span>
      <div className="ss-empty-title">{title}</div>
      {body ? <p className="ss-empty-body">{body}</p> : null}
      {action ? <div className="ss-empty-action">{action}</div> : null}
    </div>
  );
}

/**
 * The one error note. `inline` keeps stale rows on screen underneath (a failed background refresh
 * must not blank a working screen); the default fills the content slot.
 */
export function SalesErrorNote({
  children,
  inline = false,
}: {
  children: ReactNode;
  inline?: boolean | undefined;
}) {
  return (
    <div className={`ss-error-note${inline ? ' is-inline' : ''}`} role="alert">
      <Icon name="alert" size={16} />
      <span>{children}</span>
    </div>
  );
}

/** Shared "n of m" pager. One control, so page footers stop drifting per tab. */
export function SalesPager({
  page,
  pageCount,
  onPage,
  summary,
  nextDisabled,
}: {
  page: number;
  pageCount: number;
  onPage: (next: number) => void;
  summary?: ReactNode;
  /** Extra gate for cursor-paged lists, which can't step forward without a server cursor. */
  nextDisabled?: boolean | undefined;
}): JSX.Element {
  return (
    <div className="ss-pager">
      <span className="ss-pager-summary">{summary}</span>
      <div className="ss-pager-controls">
        <button
          type="button"
          className="ss-pager-btn"
          disabled={page <= 1}
          onClick={() => onPage(Math.max(1, page - 1))}
        >
          Previous
        </button>
        <span className="ss-pager-pos">
          Page {page} of {pageCount}
        </span>
        <button
          type="button"
          className="ss-pager-btn"
          disabled={page >= pageCount || nextDisabled === true}
          onClick={() => onPage(Math.min(pageCount, page + 1))}
        >
          Next
        </button>
      </div>
    </div>
  );
}

/** A single shimmer block — the only loading primitive in the module. */
export function Skel({
  w,
  h,
  radius,
  style,
}: {
  w: string;
  h: string;
  radius?: string | undefined;
  style?: CSSProperties | undefined;
}) {
  return (
    <div
      className="ss-skel"
      style={{ width: w, height: h, borderRadius: radius ?? 'var(--radius-md)', ...style }}
    />
  );
}
