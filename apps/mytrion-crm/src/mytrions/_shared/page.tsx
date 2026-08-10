/**
 * The page contract: one head, one panel, one KPI tile, across twelve workspaces.
 *
 * These live in `_shared` (CSS Modules) rather than `components/mytrion` (Tailwind over @base-ui)
 * because `_shared` is where every module already looks, and the Tailwind set has ~zero adoption —
 * four importers app-wide. Putting the one page head for twelve workspaces on a stack eight of them
 * do not use would mean adopting a second system in order to standardise the first.
 *
 * Adoption is deliberately incremental: ModuleShell adopts these (which converts Verification and
 * Trailhead for free), each bespoke workspace adopts as it folds in, and everything else adopts on
 * next touch. A 120-page sweep with no visual-regression gate is a diff nobody can review.
 */
import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import styles from './page.module.css';

/**
 * The measure. Replaces `.ms-page`'s 1280, Sales' inline 1180 and Billing's none — a workspace hop
 * that visibly narrows the content by 100px is exactly the drift this contract removes.
 *
 * `busy` is the SINGLE aria-busy owner for a page. Nesting them is how a screen ends up announcing
 * "busy" three times for one fetch.
 */
export function PageShell({
  children,
  width = 'measure',
  busy,
}: {
  children: ReactNode;
  /** 'bleed' for surfaces that legitimately run edge to edge (a console, a virtualised ledger). */
  width?: 'measure' | 'bleed';
  busy?: boolean | undefined;
}) {
  return (
    <div
      className={`${styles.page} ${width === 'bleed' ? styles.bleed : ''}`}
      {...(busy === undefined ? {} : { 'aria-busy': busy })}
    >
      {children}
    </div>
  );
}

/** Every page opens the same way: uppercase kicker, 32px title, one line of description. */
export function PageHead({
  kicker,
  title,
  description,
  actions,
}: {
  kicker: string;
  title: string;
  description?: string | undefined;
  /** Right-aligned on the title row. Use PageAction so the pair reads as one set. */
  actions?: ReactNode;
}) {
  return (
    <header className={styles.head}>
      <div className={styles.headText}>
        <p className={styles.kicker}>{kicker}</p>
        <h1 className={styles.title}>{title}</h1>
        {description ? <p className={styles.description}>{description}</p> : null}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  );
}

export function PageAction({
  variant = 'secondary',
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' }) {
  return (
    <button type="button" className={`${styles.action} ${styles[variant]}`} {...rest}>
      {children}
    </button>
  );
}

/** 8px glass, 1px border, inset glare. No drop shadow at rest — depth is refraction. */
export function Panel({
  title,
  actions,
  padding = 'normal',
  className,
  children,
}: {
  title?: string | undefined;
  actions?: ReactNode;
  /** 'none' when a table must reach the panel edge. */
  padding?: 'normal' | 'none';
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <section className={`${styles.panel} ${className ?? ''}`}>
      {title || actions ? (
        <div className={styles.panelHead}>
          {title ? <h2 className={styles.panelTitle}>{title}</h2> : <span />}
          {actions ? <div className={styles.panelActions}>{actions}</div> : null}
        </div>
      ) : null}
      <div className={padding === 'none' ? styles.panelBodyFlush : styles.panelBody}>{children}</div>
    </section>
  );
}

/** 4-up, 2 under 1024px, 1 under 560px. */
export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className={styles.kpis}>{children}</div>;
}

export interface KpiDelta {
  /** Pre-formatted by the caller: "+2.4%", "−18.2%", "−0.8". */
  value: string;
  /** Which way the number moved. Picks the ARROW. */
  direction: 'up' | 'down' | 'flat';
  /** Whether that direction is good FOR THIS METRIC. Picks the COLOUR. */
  healthy: boolean;
  /** "vs last week". */
  caption?: string | undefined;
}

/**
 * Direction and sentiment are INDEPENDENT axes, and that is the whole API decision here.
 *
 * A single signed number cannot express "unmatched invoices fell 18%" — a DOWN arrow that is GREEN.
 * Driving both from one value puts the glyph and the meaning in contradiction on every metric where
 * lower is better, which is precisely why each workspace ended up writing its own tile instead of
 * reusing one.
 */
export function KpiTile({
  label,
  value,
  icon,
  delta,
}: {
  label: string;
  /** Caller formats; rendered in Space Mono with tabular-nums. */
  value: string;
  icon?: ReactNode;
  delta?: KpiDelta | undefined;
}) {
  const Arrow =
    delta?.direction === 'up' ? ArrowUpRight : delta?.direction === 'down' ? ArrowDownRight : ArrowRight;

  return (
    <div className={styles.kpi}>
      <div className={styles.kpiTop}>
        <span className={styles.kpiLabel}>{label}</span>
        {icon ? <span className={styles.kpiIcon}>{icon}</span> : null}
      </div>
      <div className={styles.kpiValue}>{value}</div>
      {delta ? (
        <div className={`${styles.kpiDelta} ${delta.healthy ? styles.good : styles.warn}`}>
          <Arrow size={15} aria-hidden />
          <span className={styles.kpiDeltaValue}>{delta.value}</span>
          {delta.caption ? <span className={styles.kpiCaption}>{delta.caption}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
