/**
 * Shared Retention board chrome — hero, metric strip, column headers, cards.
 * Patterns: CRM kanban (count + aggregate in headers) + 4-up headline KPIs.
 */
import type { ReactNode } from 'react';
import { s } from './dc';
import {
  breachSeverity,
  cadenceExplain,
  deadlineCaption,
  freqLabel,
  isOverdue,
  quietCaption,
  type RetentionBoardStats,
  type RetentionCaseRow,
} from './retentionData';

export function fmtGal(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  return Math.round(n).toLocaleString();
}

type MetricTone = 'accent' | 'warn' | 'danger' | 'ok' | undefined;

export function RetentionMetric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: MetricTone;
}) {
  return (
    <div className="ss-ret-metric">
      <div className="ss-ret-metric-lbl">{label}</div>
      <div className={`ss-ret-metric-val${tone ? ` is-${tone}` : ''}`}>{value}</div>
      {hint ? <div className="ss-ret-metric-hint">{hint}</div> : null}
    </div>
  );
}

export function RetentionCasesMetrics({ stats }: { stats: RetentionBoardStats }) {
  return (
    <div className="ss-ret-metrics" aria-label="Board summary">
      <RetentionMetric
        label="Active"
        value={String(stats.openActive)}
        tone="accent"
        hint="Open on your board"
      />
      <RetentionMetric
        label="Overdue"
        value={String(stats.overdue)}
        tone={stats.overdue > 0 ? 'danger' : undefined}
        hint="Past current deadline"
      />
      <RetentionMetric
        label="Gal at risk"
        value={fmtGal(stats.gallonsAtRisk)}
        tone={stats.gallonsAtRisk > 0 ? 'warn' : undefined}
        hint="90d gallons · active cases"
      />
      <RetentionMetric
        label="High freq"
        value={String(stats.highFreq)}
        hint="Expected ≤2d cadence"
      />
    </div>
  );
}

export function RetentionPoolMetrics({
  available,
  selected,
  gallons,
  avgQuietDays,
}: {
  available: number;
  selected: number;
  gallons: number;
  avgQuietDays: number | null;
}) {
  return (
    <div className="ss-ret-metrics" aria-label="Open Pool summary">
      <RetentionMetric label="Available" value={String(available)} tone="ok" hint="Ready to claim" />
      <RetentionMetric
        label="Selected"
        value={String(selected)}
        tone={selected > 0 ? 'accent' : undefined}
        hint="In this claim batch"
      />
      <RetentionMetric
        label="Gal in pool"
        value={fmtGal(gallons)}
        tone={gallons > 0 ? 'warn' : undefined}
        hint="90d · listed deals"
      />
      <RetentionMetric
        label="Avg quiet"
        value={avgQuietDays == null ? '—' : `${avgQuietDays}d`}
        hint="Days since last fuel"
      />
    </div>
  );
}

export function RetentionHero({
  title,
  sub,
  actions,
  children,
}: {
  title: string;
  sub: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="ss-ret-hero">
      <div style={s('display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap')}>
        <div style={s('min-width:0')}>
          <div className="ss-ret-hero-title">{title}</div>
          <div className="ss-ret-hero-sub">{sub}</div>
        </div>
        {actions ? <div style={s('display:flex;align-items:center;gap:8px;flex-shrink:0')}>{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function RetentionColHead({
  label,
  hint,
  color,
  count,
  gallons,
}: {
  label: string;
  hint: string;
  color: string;
  count: number;
  gallons: number;
}) {
  return (
    <div className="ss-ret-col-head">
      <div>
        <div className="ss-ret-col-title" style={{ color: 'var(--text2)' }}>
          <span className="ss-ret-col-dot" style={{ background: color }} />
          {label}
        </div>
        <div className="ss-ret-col-hint">{hint}</div>
      </div>
      <div className="ss-ret-col-meta">
        <strong>{count}</strong>
        {count > 0 ? <span>{fmtGal(gallons)} gal</span> : <span>—</span>}
      </div>
    </div>
  );
}

export function RetentionFreqBadge({ f }: { f: RetentionCaseRow['transactionFrequency'] }) {
  const col =
    f === 'high' ? 'var(--danger)' : f === 'medium' ? 'var(--warn)' : f === 'low' ? 'var(--accent)' : 'var(--muted)';
  return (
    <span
      title={cadenceExplain(f)}
      style={s(
        `display:inline-flex;padding:2px 8px;border-radius:99px;background:color-mix(in srgb,${col} 14%,transparent);color:${col};font-size:10px;font-weight:800;letter-spacing:.02em`,
      )}
    >
      {freqLabel(f)}
    </span>
  );
}

export function attemptPips(n: number): string {
  const filled = Math.min(5, Math.max(0, n));
  return `${'●'.repeat(filled)}${'○'.repeat(5 - filled)}`;
}

export function RetentionCaseCard({
  row,
  colColor,
  onOpen,
  index = 0,
}: {
  row: RetentionCaseRow;
  colColor: string;
  onOpen: () => void;
  index?: number;
}) {
  const overdue = isOverdue(row);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`ss-ret-card${overdue ? ' is-overdue' : ''}`}
      style={{ ['--ret-col' as string]: colColor, animationDelay: `${Math.min(index, 8) * 0.04}s` }}
    >
      <div style={s('display:flex;justify-content:space-between;gap:6px;align-items:flex-start')}>
        <div style={s('font-size:13px;font-weight:700;line-height:1.3;overflow:hidden;text-overflow:ellipsis')}>
          {row.companyName || '—'}
        </div>
        <RetentionFreqBadge f={row.transactionFrequency} />
      </div>
      <div style={s("font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text2)")}>{row.carrierId}</div>
      <div
        style={s(
          `font-size:12px;font-weight:600;color:${breachSeverity(row) > 0 ? 'var(--warn)' : 'var(--text2)'}`,
        )}
      >
        {quietCaption(row)}
      </div>
      <div style={s('display:flex;justify-content:space-between;align-items:center;gap:6px;font-size:11px')}>
        <span style={s('color:var(--text2);font-family:JetBrains Mono,monospace')}>
          {row.gallons90d != null ? `${fmtGal(row.gallons90d)} gal` : '—'}
        </span>
        <span style={s(`font-weight:700;color:${overdue ? 'var(--danger)' : 'var(--muted)'}`)}>
          {deadlineCaption(row)}
        </span>
      </div>
      {row.outOfReachAttempts > 0 && (
        <div className="ss-ret-pips" title={`${row.outOfReachAttempts}/5 Out of Reach attempts`}>
          {attemptPips(row.outOfReachAttempts)}
        </div>
      )}
    </button>
  );
}

export function RetentionEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="ss-ret-empty">
      <div className="ss-ret-empty-title">{title}</div>
      <div className="ss-ret-empty-body">{body}</div>
    </div>
  );
}
