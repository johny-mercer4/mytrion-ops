import { useId, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Download,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';

import type {
  MytrionUsageBreakdownRow,
  MytrionUsageCoverageStatus,
  MytrionUsageDay,
  MytrionUsageSnapshot,
  SalesAgentUsageRow,
} from '@/api/analytics';

import type { DashboardFilterParams, DateRangePreset } from '../categories';
import { defaultCustomRange } from '../categories';
import { DashboardState } from '../DashboardState';
import {
  formatActivityTime,
  formatCount,
  formatDuration,
  sortUsageAgents,
  totalTickets,
  type UsageSortKey,
} from '../mytrionUsageFormat';
import { exportMytrionUsageXlsx } from '../mytrionUsageExport';
import { useMytrionUsageSnapshot } from '../useMytrionUsageSnapshot';
import styles from './MytrionDashboard.module.css';

export interface MytrionDashboardProps {
  filters: DashboardFilterParams;
  onFiltersChange: (next: DashboardFilterParams) => void;
}

const RANGE_OPTIONS: Array<{ value: DateRangePreset; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'last_7_days', label: 'Last 7 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'custom', label: 'Custom' },
];

const SORT_OPTIONS: Array<{ value: UsageSortKey; label: string }> = [
  { value: 'activeSeconds', label: 'Active time' },
  { value: 'onlineSeconds', label: 'Online time' },
  { value: 'workspaceSessions', label: 'Workspace sessions' },
  { value: 'uiActions', label: 'UI actions' },
  { value: 'workOutcomes', label: 'Work outcomes' },
  { value: 'ticketCreates', label: 'Tickets' },
  { value: 'automationSucceeded', label: 'Automation successes' },
  { value: 'calls', label: 'Calls' },
  { value: 'aiTurns', label: 'AI turns' },
  { value: 'lastActivityAt', label: 'Last activity' },
  { value: 'displayName', label: 'Agent name' },
];

type TrendKey = 'activeAgents' | 'workspaceSessions' | 'onlineSeconds' | 'activeSeconds' | 'uiActions';

const TREND_OPTIONS: Array<{ value: TrendKey; label: string; duration?: boolean }> = [
  { value: 'activeAgents', label: 'Active agents' },
  { value: 'workspaceSessions', label: 'Workspace sessions' },
  { value: 'onlineSeconds', label: 'Online time', duration: true },
  { value: 'activeSeconds', label: 'Active time', duration: true },
  { value: 'uiActions', label: 'UI actions' },
];

function trendLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });
}

function UsageTrend({ days, metric }: { days: MytrionUsageDay[]; metric: TrendKey }) {
  const titleId = useId();
  const descriptionId = useId();
  const option = TREND_OPTIONS.find((candidate) => candidate.value === metric)!;
  const measured = days.map((day) => day[metric]).filter((value): value is number => value != null);
  if (measured.length === 0) {
    return <p className={styles.panelState}>This metric is unavailable for the selected window.</p>;
  }
  const width = 900;
  const height = 210;
  const top = 12;
  const bottom = 28;
  const plot = height - top - bottom;
  const max = Math.max(...measured, 1);
  const slot = width / Math.max(days.length, 1);
  const barWidth = Math.max(5, slot - 3);
  const labelStep = Math.max(1, Math.ceil(days.length / 8));
  const values = days.map((day) => {
    const value = day[metric];
    return {
      ...day,
      displayValue: value == null
        ? 'Unavailable'
        : option.duration ? formatDuration(value) : formatCount(value),
    };
  });

  return (
    <>
      <svg
        className={styles.trend}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        preserveAspectRatio="none"
      >
        <title id={titleId}>{`${option.label} by day`}</title>
        <desc id={descriptionId}>{values.map((day) => `${trendLabel(day.date)}: ${day.displayValue}${day.partial ? ', partial coverage' : ''}`).join('; ')}</desc>
      {[0, 0.5, 1].map((ratio) => {
        const y = top + plot * (1 - ratio);
        return <line key={ratio} className={styles.gridLine} x1="0" x2={width} y1={y} y2={y} />;
      })}
      {days.map((day, index) => {
        const value = day[metric];
        if (value == null) return null;
        const barHeight = Math.max(2, (value / max) * plot);
        return (
          <rect
            key={day.date}
            className={day.partial ? `${styles.trendBar} ${styles.partialBar}` : styles.trendBar}
            x={index * slot + (slot - barWidth) / 2}
            y={top + plot - barHeight}
            width={barWidth}
            height={barHeight}
            rx="3"
          >
            <title>{`${trendLabel(day.date)}: ${option.duration ? formatDuration(value) : formatCount(value)}${day.partial ? ' (partial coverage)' : ''}`}</title>
          </rect>
        );
      })}
      {days.map((day, index) =>
        index % labelStep === 0 || index === days.length - 1 ? (
          <text
            key={day.date}
            className={styles.axisLabel}
            x={index * slot + slot / 2}
            y={height - 8}
            textAnchor="middle"
          >
            {trendLabel(day.date)}
          </text>
        ) : null,
      )}
      </svg>
      <details className={styles.trendValuesToggle}>
        <summary>View daily values</summary>
        <dl className={styles.trendValues}>{values.map((day) => (
          <div key={day.date}><dt>{trendLabel(day.date)}</dt><dd>{day.displayValue}{day.partial ? ' · Partial' : ''}</dd></div>
        ))}</dl>
      </details>
    </>
  );
}

function CoverageStrip({ snapshot }: { snapshot: MytrionUsageSnapshot }) {
  return (
    <section className={styles.coverage} aria-labelledby="usage-coverage-title">
      <div className={styles.coverageHead}>
        <h2 id="usage-coverage-title">Coverage and freshness</h2>
        <span>{`${snapshot.range.from} → ${snapshot.range.to} · ${snapshot.timeZone}`}</span>
      </div>
      <div className={styles.coverageItems}>
        {snapshot.coverage.map((item) => (
          <div key={item.source} className={styles.coverageItem} data-status={item.status}>
            <span className={styles.coverageDot} aria-hidden="true" />
            <span>
              <strong>{item.label}</strong>
              <small>{item.status}</small>
              <small>
                {item.availableFrom || item.availableThrough
                  ? `${item.availableFrom ? formatActivityTime(item.availableFrom, snapshot.timeZone) : 'Unknown'} → ${item.availableThrough ? formatActivityTime(item.availableThrough, snapshot.timeZone) : 'Now'}`
                  : 'No covered interval'}
              </small>
              {item.note ? <small>{item.note}</small> : null}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function BreakdownList({
  title,
  rows,
  emptyText,
  coverageStatus,
}: {
  title: string;
  rows: MytrionUsageBreakdownRow[];
  emptyText: string;
  coverageStatus?: MytrionUsageCoverageStatus | undefined;
}) {
  return (
    <div className={styles.breakdownGroup}>
      <div className={styles.breakdownTitle}><h3>{title}</h3>{coverageStatus === 'partial' ? <span className={styles.partialBadge}>Partial coverage</span> : null}</div>
      {coverageStatus === 'unavailable' ? (
        <p className={styles.panelState} data-state="unavailable">This source is unavailable for the selected window.</p>
      ) : rows.length === 0 ? (
        <p className={styles.panelState}>{emptyText}</p>
      ) : (
        <dl className={styles.breakdownList}>
          {rows.map((row) => (
            <div key={row.key}>
              <dt>{row.label}</dt>
              <dd>{formatCount(row.count)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function sourceStatus(
  snapshot: MytrionUsageSnapshot,
  source: string,
): MytrionUsageCoverageStatus | undefined {
  return snapshot.coverage.find((item) => item.source === source)?.status;
}

function Status({ row }: { row: SalesAgentUsageRow }) {
  return (
    <span className={styles.status} data-status={row.currentStatus ?? 'unavailable'}>
      <span aria-hidden="true" />
      {row.currentStatus ?? '—'}
    </span>
  );
}

function cardMetric(row: SalesAgentUsageRow, sortKey: UsageSortKey, timeZone: string) {
  if (sortKey === 'displayName') return { label: 'Active time', value: formatDuration(row.activeSeconds) };
  if (sortKey === 'activeSeconds') return { label: 'Active time', value: formatDuration(row.activeSeconds) };
  if (sortKey === 'onlineSeconds') return { label: 'Online time', value: formatDuration(row.onlineSeconds) };
  if (sortKey === 'lastActivityAt') return { label: 'Last activity', value: formatActivityTime(row.lastActivityAt, timeZone) };
  if (sortKey === 'ticketCreates') return { label: 'Tickets', value: formatCount(totalTickets(row)) };
  return { label: SORT_OPTIONS.find((option) => option.value === sortKey)?.label ?? 'Usage', value: formatCount(row[sortKey]) };
}

function AgentCards({ rows, timeZone, sortKey }: { rows: SalesAgentUsageRow[]; timeZone: string; sortKey: UsageSortKey }) {
  return (
    <div className={styles.agentCards}>
      {rows.map((row) => {
        const primary = cardMetric(row, sortKey, timeZone);
        return (
        <article key={row.workerId} className={styles.agentCard}>
          <div className={styles.agentCardHead}>
            <strong>{row.displayName}</strong>
            <Status row={row} />
          </div>
          <div className={styles.agentPriority}><span>{primary.label}</span><strong>{primary.value}</strong></div>
          <details className={styles.agentDetails}><summary>All usage metrics</summary><dl className={styles.agentMetrics}>
            <div><dt>Active</dt><dd>{formatDuration(row.activeSeconds)}</dd></div>
            <div><dt>Online</dt><dd>{formatDuration(row.onlineSeconds)}</dd></div>
            <div><dt>Sessions / sign-ins</dt><dd>{formatCount(row.workspaceSessions)} / {formatCount(row.signIns)}</dd></div>
            <div><dt>Active days</dt><dd>{formatCount(row.activeDays)}</dd></div>
            <div><dt>UI / outcomes</dt><dd>{formatCount(row.uiActions)} / {formatCount(row.workOutcomes)}</dd></div>
            <div><dt>Tickets / escalations</dt><dd>{formatCount(row.ticketCreates)} / {formatCount(row.escalationCreates)}</dd></div>
            <div><dt>Automation start / ok / fail</dt><dd>{formatCount(row.automationStarted)} / {formatCount(row.automationSucceeded)} / {formatCount(row.automationFailed)}</dd></div>
            <div><dt>Calls / talk</dt><dd>{formatCount(row.calls)} / {formatDuration(row.talkSeconds)}</dd></div>
            <div><dt>AI turns / tools</dt><dd>{formatCount(row.aiTurns)} / {formatCount(row.aiToolCalls)}</dd></div>
          </dl><p className={styles.lastActivity}>Last activity · {formatActivityTime(row.lastActivityAt, timeZone)}</p></details>
        </article>
        );
      })}
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
}: {
  label: string;
  sortKey: UsageSortKey;
  activeKey: UsageSortKey;
  direction: 'asc' | 'desc';
  onSort: (key: UsageSortKey) => void;
}) {
  const active = sortKey === activeKey;
  return (
    <th aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onSort(sortKey)}>
        {label}
        {active ? direction === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} /> : null}
      </button>
    </th>
  );
}

function AgentTable({
  rows,
  sortKey,
  direction,
  onSort,
  timeZone,
}: {
  rows: SalesAgentUsageRow[];
  sortKey: UsageSortKey;
  direction: 'asc' | 'desc';
  onSort: (key: UsageSortKey) => void;
  timeZone: string;
}) {
  return (
    <div className={styles.tableScroll}>
      <table className={styles.agentTable}>
        <caption>Eligible Sales agents, including agents with zero recorded usage</caption>
        <thead><tr>
          <SortHeader label="Agent" sortKey="displayName" activeKey={sortKey} direction={direction} onSort={onSort} />
          <th>Status</th><th>Sign-ins</th>
          <SortHeader label="Sessions" sortKey="workspaceSessions" activeKey={sortKey} direction={direction} onSort={onSort} />
          <SortHeader label="Online" sortKey="onlineSeconds" activeKey={sortKey} direction={direction} onSort={onSort} />
          <SortHeader label="Active" sortKey="activeSeconds" activeKey={sortKey} direction={direction} onSort={onSort} />
          <SortHeader label="UI actions" sortKey="uiActions" activeKey={sortKey} direction={direction} onSort={onSort} />
          <SortHeader label="Outcomes" sortKey="workOutcomes" activeKey={sortKey} direction={direction} onSort={onSort} />
          <SortHeader label="Tickets" sortKey="ticketCreates" activeKey={sortKey} direction={direction} onSort={onSort} />
          <SortHeader label="Automation" sortKey="automationSucceeded" activeKey={sortKey} direction={direction} onSort={onSort} />
          <SortHeader label="Calls" sortKey="calls" activeKey={sortKey} direction={direction} onSort={onSort} />
          <SortHeader label="AI" sortKey="aiTurns" activeKey={sortKey} direction={direction} onSort={onSort} />
          <SortHeader label="Last activity" sortKey="lastActivityAt" activeKey={sortKey} direction={direction} onSort={onSort} />
        </tr></thead>
        <tbody>{rows.map((row) => (
          <tr key={row.workerId}>
            <td className={styles.agentName}>{row.displayName}</td><td><Status row={row} /></td>
            <td>{formatCount(row.signIns)}</td><td>{formatCount(row.workspaceSessions)}</td>
            <td>{formatDuration(row.onlineSeconds)}</td>
            <td>{formatDuration(row.activeSeconds)}<small>{formatCount(row.activeDays)} days</small></td>
            <td>{formatCount(row.uiActions)}</td><td>{formatCount(row.workOutcomes)}</td>
            <td>{formatCount(totalTickets(row))}<small>{formatCount(row.escalationCreates)} escalations</small></td>
            <td>{formatCount(row.automationSucceeded)} / {formatCount(row.automationFailed)}<small>{formatCount(row.automationStarted)} started</small></td>
            <td>{formatCount(row.calls)}<small>{formatDuration(row.talkSeconds)} talk</small></td>
            <td>{formatCount(row.aiTurns)} / {formatCount(row.aiToolCalls)}<small>turns / tools</small></td>
            <td>{formatActivityTime(row.lastActivityAt, timeZone)}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export function MytrionDashboard({ filters, onFiltersChange }: MytrionDashboardProps) {
  const usage = useMytrionUsageSnapshot(filters);
  const { snapshot, error } = usage.current;
  const [trendMetric, setTrendMetric] = useState<TrendKey>('activeSeconds');
  const [sortKey, setSortKey] = useState<UsageSortKey>('activeSeconds');
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const agents = useMemo(
    () => sortUsageAgents(snapshot?.agents ?? [], sortKey, direction),
    [snapshot?.agents, sortKey, direction],
  );

  const setRange = (range: DateRangePreset): void => {
    if (range === 'custom') {
      const dates = defaultCustomRange();
      onFiltersChange({ ...filters, range, from: filters.from ?? dates.from, to: filters.to ?? dates.to });
    } else {
      onFiltersChange({ ...filters, range, from: null, to: null });
    }
  };
  const chooseSort = (next: UsageSortKey): void => {
    if (next === sortKey) setDirection((current) => current === 'desc' ? 'asc' : 'desc');
    else {
      setSortKey(next);
      setDirection(next === 'displayName' ? 'asc' : 'desc');
    }
  };
  const doExport = async (): Promise<void> => {
    if (!snapshot) return;
    setExporting(true);
    setExportError(null);
    try { await exportMytrionUsageXlsx(snapshot); }
    catch (cause) { setExportError(cause instanceof Error ? cause.message : 'Export failed'); }
    finally { setExporting(false); }
  };

  const busy = usage.loading || !usage.hasAttempted;
  const partial = snapshot?.coverage.some((item) => item.status === 'partial') ?? false;
  const kpis = snapshot ? [
    { label: 'Active agents', value: formatCount(snapshot.summary.activeAgents), hint: `of ${snapshot.summary.eligibleAgents} eligible` },
    { label: 'Workspace sessions', value: formatCount(snapshot.summary.workspaceSessions), hint: '30-minute access windows' },
    { label: 'Online time', value: formatDuration(snapshot.summary.onlineSeconds), hint: 'visible active + idle' },
    { label: 'Active time', value: formatDuration(snapshot.summary.activeSeconds), hint: 'visible recent interaction' },
    { label: 'UI actions', value: formatCount(snapshot.summary.uiActions), hint: 'named semantic actions' },
  ] : [];

  return (
    <div className={`an-page ${styles.page}`} aria-busy={busy || usage.refreshing}>
      <header className={styles.header}>
        <div><h1>Sales Mytrion usage</h1><p>Coverage-first adoption and activity reporting for KPI-eligible Sales agents. No composite score.</p></div>
        <div className={styles.headerActions}>
          {snapshot ? <span className={styles.computed}>Computed {formatActivityTime(snapshot.computedAt, snapshot.timeZone)}</span> : null}
          <button type="button" className={styles.secondaryButton} onClick={() => void usage.refresh()} disabled={busy || usage.refreshing} aria-busy={usage.refreshing}>
            <RefreshCw size={16} className={usage.refreshing && !busy ? styles.spin : undefined} /> {usage.refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <button type="button" className={styles.primaryButton} onClick={() => void doExport()} disabled={!snapshot || exporting}>
            <Download size={16} /> {exporting ? 'Exporting…' : 'Export Excel'}
          </button>
        </div>
      </header>

      <section className={styles.filters} aria-label="Usage date range">
        <div className={styles.rangeButtons}>{RANGE_OPTIONS.map((option) => (
          <button key={option.value} type="button" aria-pressed={filters.range === option.value} onClick={() => setRange(option.value)}>{option.label}</button>
        ))}</div>
        {filters.range === 'custom' ? <div className={styles.customDates}>
          <label>From<input type="date" value={filters.from ?? ''} onChange={(event) => onFiltersChange({ ...filters, from: event.target.value || null })} /></label>
          <span aria-hidden="true">→</span>
          <label>To<input type="date" value={filters.to ?? ''} onChange={(event) => onFiltersChange({ ...filters, to: event.target.value || null })} /></label>
        </div> : null}
      </section>

      {error && snapshot ? <div className={styles.warning} role="alert"><TriangleAlert size={17} /><span><strong>Figures may be stale.</strong> Refresh failed ({error}); the last successful snapshot remains visible.</span></div> : null}
      {partial && snapshot ? <div className={styles.notice} role="status"><TriangleAlert size={17} /><span><strong>Some sources cover only part of this window.</strong> Use the coverage dates before comparing totals.</span></div> : null}
      {exportError ? <div className={styles.warning} role="alert"><TriangleAlert size={17} /><span><strong>Excel export failed.</strong> {exportError}</span></div> : null}

      {!snapshot ? busy ? (
        <DashboardState kind="loading" detail="Building the Sales Mytrion usage snapshot" />
      ) : (
        <DashboardState kind="error" detail={error ?? 'Mytrion usage is unavailable.'} onRetry={() => void usage.refresh()} retrying={usage.refreshing} />
      ) : <>
        <CoverageStrip snapshot={snapshot} />
        {snapshot.population.eligibleAgents === 0 ? (
          <DashboardState kind="empty" detail="No active KPI-eligible Sales Agent users were found for this window. Refresh the Sales directory, then try again." />
        ) : <>
        <section className={styles.kpis} aria-label="Usage summary">{kpis.map((kpi) => (
          <div key={kpi.label}><span>{kpi.label}</span><strong>{kpi.value}</strong><small>{kpi.hint}</small></div>
        ))}</section>

        <section className={styles.panel} aria-labelledby="usage-trend-title">
          <div className={styles.panelHead}><div><h2 id="usage-trend-title">Daily trend</h2><p>One metric at a time; the final day is a live raw-event overlay.</p></div>
            <label className={styles.selectLabel}>Metric<select value={trendMetric} onChange={(event) => setTrendMetric(event.target.value as TrendKey)}>{TREND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          </div>
          <UsageTrend days={snapshot.days} metric={trendMetric} />
        </section>

        <section className={styles.panel} aria-labelledby="agent-comparison-title">
          <div className={styles.panelHead}><div><div className={styles.breakdownTitle}><h2 id="agent-comparison-title">Agent comparison</h2>{partial ? <span className={styles.partialBadge}>Partial coverage</span> : null}</div><p>All eligible agents are included. Choose ascending order to surface least-used accounts.</p></div>
            <div className={styles.sortControls}><label className={styles.selectLabel}>Sort by<select value={sortKey} onChange={(event) => { setSortKey(event.target.value as UsageSortKey); setDirection(event.target.value === 'displayName' ? 'asc' : 'desc'); }}>{SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <button type="button" className={styles.directionButton} onClick={() => setDirection((current) => current === 'desc' ? 'asc' : 'desc')}>{direction === 'desc' ? <ArrowDown size={16} /> : <ArrowUp size={16} />}{direction === 'desc' ? 'Most first' : 'Least first'}</button>
            </div>
          </div>
          <AgentTable rows={agents} sortKey={sortKey} direction={direction} onSort={chooseSort} timeZone={snapshot.timeZone} />
          <AgentCards rows={agents} timeZone={snapshot.timeZone} sortKey={sortKey} />
        </section>

        <div className={styles.breakdownGrid}>
          <section className={styles.panel}><BreakdownList title="Activity" rows={snapshot.breakdowns.activity} coverageStatus={sourceStatus(snapshot, 'ui_activity')} emptyText="No semantic UI actions were recorded in this window." /></section>
          <section className={styles.panel}><BreakdownList title="Work outcomes" rows={snapshot.breakdowns.workOutcomes} coverageStatus={sourceStatus(snapshot, 'work_outcomes')} emptyText="No work outcomes were recorded in this window." /></section>
          <section className={styles.panel}><div className={styles.splitBreakdown}><BreakdownList title="Tickets" rows={snapshot.breakdowns.tickets} coverageStatus={sourceStatus(snapshot, 'tickets')} emptyText="No tickets or escalations were created." /><BreakdownList title="Automations" rows={snapshot.breakdowns.automations} coverageStatus={sourceStatus(snapshot, 'automations')} emptyText="No automation lifecycle outcomes were recorded." /></div></section>
          <section className={styles.panel}><BreakdownList title="AI usage" rows={snapshot.breakdowns.ai} coverageStatus={sourceStatus(snapshot, 'ai')} emptyText="No completed Sales agent turns or dispatched tools were recorded." /></section>
        </div>

        <section className={styles.notes} aria-labelledby="metric-definitions-title"><h2 id="metric-definitions-title">How to read these metrics</h2>
          <dl><div><dt>Sign-ins</dt><dd>Platform authentication events; these are platform-wide, not Sales-only.</dd></div><div><dt>Workspace sessions</dt><dd>Successful Sales access events deduplicated into 30-minute windows.</dd></div><div><dt>Online / active</dt><dd>Unioned visible browser intervals; active additionally requires pointer, keyboard, or scroll activity within five minutes.</dd></div><div><dt>UI actions</dt><dd>Allowlisted navigation, view, record, search, edit-intent, call-intent, and export events—not generic clicks.</dd></div><div><dt>Work outcomes</dt><dd>Calls, edits, tasks, tickets, escalations, and retention use server facts. Automation outcomes use verified-session browser lifecycle events and are not server-correlated.</dd></div><div><dt>AI usage</dt><dd>Completed Sales agent turns and dispatched tool calls attributed to the initiating human.</dd></div><div><dt>Unavailable</dt><dd>An em dash means the source is unavailable. It is never converted into a misleading zero.</dd></div></dl>
        </section>
        </>}
      </>}
    </div>
  );
}
