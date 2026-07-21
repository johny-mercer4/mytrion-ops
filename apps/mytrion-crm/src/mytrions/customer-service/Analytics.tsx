/**
 * Analytics panel — 1:1 port of the widget's analytics-panel.js template (cs-an-* : KPI
 * grid, SVG spark trend, donut-by-status, leaderboard) over the DONE live-data layer.
 * Sub-tabs (Tickets/Calls/Maintenance) map to the loadAnalytics() blocks; the leaderboard
 * renders only on the backend /cs/context manager verdict (server also enforces it).
 */
import { useMemo, useState } from 'react';

import type { AnalyticsBlock, KpiStat, VolumeDay } from './data';
import { RANGE_LABELS, getCsContext, loadAnalytics, useLoad, type RangeId } from './live';

type SubTab = 'tickets' | 'calls' | 'maintenance';

const SUB_TABS: { id: SubTab; label: string; icon: string }[] = [
  { id: 'tickets', label: 'Tickets', icon: 'M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z' },
  { id: 'calls', label: 'Calls', icon: 'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z' },
  { id: 'maintenance', label: 'Maintenance', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' },
];

const SPARK_H = 60;
const REFRESH_PATH =
  'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-14.357-2m14.357 2H15';

const PALETTE = ['#EAB308', '#16A34A', '#7A52C8', '#EA580C', '#D97706', '#D14B45', '#0E93B0', '#DB2777'];

function labelColor(label: string, idx: number): string {
  const s = label.toLowerCase();
  if (s.includes('closed') || s.includes('resolved')) return '#16A34A';
  if (s.includes('open')) return '#EAB308';
  if (s.includes('hold') || s.includes('pending')) return '#F59E0B';
  if (s.includes('escal') || s.includes('urgent') || s.includes('high')) return '#D14B45';
  return PALETTE[idx % PALETTE.length] as string;
}

function sparkPoints(vol: VolumeDay[]): string {
  if (!vol.length) return '';
  const max = Math.max(1, ...vol.map((d) => d.value));
  const step = vol.length > 1 ? 400 / (vol.length - 1) : 0;
  return vol
    .map((d, i) => {
      const x = i * step;
      const y = SPARK_H - 2 - (d.value / max) * (SPARK_H - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function areaPath(vol: VolumeDay[]): string {
  if (!vol.length) return '';
  const pts = sparkPoints(vol).split(' ');
  const last = (pts[pts.length - 1] ?? '0,0').split(',');
  const first = (pts[0] ?? '0,0').split(',');
  return `M ${pts.join(' L ')} L ${last[0]},${SPARK_H} L ${first[0]},${SPARK_H} Z`;
}

function donutBackground(items: AnalyticsBlock['breakdown']): string {
  const total = items.reduce((s, x) => s + x.value, 0);
  if (!total) return 'var(--surface-raised)';
  let acc = 0;
  const stops = items.map((x, idx) => {
    const start = (acc / total) * 360;
    acc += x.value;
    return `${labelColor(x.label, idx)} ${start.toFixed(1)}deg ${((acc / total) * 360).toFixed(1)}deg`;
  });
  return `conic-gradient(${stops.join(', ')})`;
}

function deltaChip(delta: KpiStat['delta']): { cls: string; text: string } | null {
  if (!delta) return null;
  const d = delta.current - delta.prev;
  const up = d > 0;
  const good = up === delta.higherIsBetter;
  const cls = d === 0 ? 'cs-an-flat' : good ? 'cs-an-up' : 'cs-an-down';
  const text = d === 0 ? '±0' : `${up ? '▲ ' : '▼ '}${Math.abs(d).toLocaleString()}`;
  return { cls, text };
}

function agentInitials(name: string): string {
  if (!name || name.startsWith('#')) return '?';
  return name.trim().split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();
}

const KPI_ICON_CLASS = ['', 'cs-an-icon-warn', 'cs-an-icon-success', 'cs-an-icon-purple'];

export function Analytics() {
  const [subTab, setSubTab] = useState<SubTab>('tickets');
  const [range, setRange] = useState<RangeId>('this_month');

  const ctx = useLoad(getCsContext, []);
  const analytics = useLoad(() => loadAnalytics(range, ctx.data), [range, ctx.data?.isManager ?? null]);

  const isManager = ctx.data?.isManager === true;
  const block: AnalyticsBlock = analytics.data?.[subTab] ?? {
    kpis: [],
    volume: [],
    breakdown: [],
    leaderboardCols: ['', '', ''],
    leaderboard: [],
  };
  const loading = analytics.loading || ctx.loading;
  const donutTotal = useMemo(() => block.breakdown.reduce((s, b) => s + b.value, 0), [block]);
  const maxLead = useMemo(() => Math.max(1, ...block.leaderboard.map((r) => r.col1)), [block]);
  const peak = useMemo(
    () =>
      block.volume.reduce(
        (best, d) => (d.value > best.value ? { value: d.value, label: d.label } : best),
        { value: 0, label: '' },
      ),
    [block],
  );

  const tabCount = (id: SubTab): string => {
    const b = analytics.data?.[id];
    const total = b?.kpis?.[0]?.value;
    return total ?? '0';
  };

  return (
    <div className="cs-panel cs-an-panel">
      {/* ═══ HEADER ═══ */}
      <div className="cs-header-row">
        <div>
          <h2 className="cs-title">Analytics</h2>
          <div className="cs-subtitle">
            {isManager ? 'All agents' : 'Your performance'}
            <span className="cs-an-range-chip">{RANGE_LABELS[range]}</span>
          </div>
        </div>
        <div className="cs-an-header-controls">
          <select
            className="cs-an-range-select"
            value={range}
            onChange={(e) => setRange(e.target.value as RangeId)}
            disabled={loading}
          >
            {(Object.keys(RANGE_LABELS) as RangeId[]).map((r) => (
              <option key={r} value={r}>
                {RANGE_LABELS[r]}
              </option>
            ))}
          </select>
          <button className="cs-refresh-btn" onClick={analytics.reload} disabled={loading}>
            <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24" className={loading ? 'spin-icon' : undefined}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={REFRESH_PATH} />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {analytics.error ? <div className="cs-an-error-card">Failed to load analytics: {analytics.error}</div> : null}
      {analytics.data?.unmatched ? (
        <div className="cs-an-error-card">
          Your account could not be matched to a Desk agent — ticket/call analytics are unavailable.
        </div>
      ) : null}

      {/* ═══ DATA TABS ═══ */}
      <div className="cs-an-datatabs">
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            className={`cs-an-datatab${subTab === t.id ? ' active' : ''}`}
            onClick={() => setSubTab(t.id)}
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={t.icon} />
            </svg>
            {t.label}
            <span className="cs-an-datatab-count">{tabCount(t.id)}</span>
          </button>
        ))}
      </div>

      {/* ═══ KPI CARDS ═══ */}
      <div className="cs-an-kpi-grid">
        {loading && block.kpis.length === 0
          ? Array.from({ length: 4 }, (_, i) => <div key={i} className="cs-skeleton" style={{ height: 96, borderRadius: 12 }} />)
          : block.kpis.map((k, idx) => {
              const chip = deltaChip(k.delta);
              return (
                <div key={k.label} className={`cs-an-kpi-card${idx === 0 ? ' cs-an-kpi-primary' : ''}`}>
                  <div className={`cs-an-kpi-icon-wrap ${KPI_ICON_CLASS[idx] ?? ''}`}>
                    <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={SUB_TABS.find((t) => t.id === subTab)?.icon ?? ''} />
                    </svg>
                  </div>
                  <div className="cs-an-kpi-value">{k.value}</div>
                  <div className="cs-an-kpi-footer">
                    <span className="cs-an-kpi-label">{k.label}</span>
                    {chip ? <span className={`cs-an-delta-chip ${chip.cls}`}>{chip.text}</span> : null}
                  </div>
                  {k.hint ? <div className="cs-an-kpi-hint">{k.hint}</div> : null}
                </div>
              );
            })}
      </div>

      {/* ═══ CHARTS ═══ */}
      <div className="cs-an-charts-grid">
        {/* Daily Trend */}
        <div className="cs-an-chart-card cs-an-chart-wide">
          <div className="cs-an-chart-head">Daily Trend</div>
          {block.volume.length ? (
            <div className="cs-an-spark-wrap">
              <div className="cs-an-trend-peak">
                <span className="cs-an-trend-peak-val">{peak.value.toLocaleString()}</span>
                <span className="cs-an-trend-peak-lbl">peak{peak.label ? ` · ${peak.label}` : ''}</span>
              </div>
              <svg className="cs-an-spark-svg" viewBox={`0 0 400 ${SPARK_H}`} preserveAspectRatio="none">
                <defs>
                  <linearGradient id="csAnGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--cs-accent)" stopOpacity="0.22" />
                    <stop offset="100%" stopColor="var(--cs-accent)" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <line className="cs-an-spark-baseline" x1="0" y1={SPARK_H - 1} x2="400" y2={SPARK_H - 1} />
                <path d={areaPath(block.volume)} fill="url(#csAnGrad)" />
                <polyline className="cs-an-spark-line" points={sparkPoints(block.volume)} fill="none" />
              </svg>
              <div className="cs-an-spark-labels">
                <span>{block.volume[0]?.label}</span>
                <span>{block.volume[block.volume.length - 1]?.label}</span>
              </div>
            </div>
          ) : (
            <div className="cs-an-nodata">{loading ? 'Loading…' : 'No data for this period'}</div>
          )}
        </div>

        {/* Breakdown donut */}
        <div className="cs-an-chart-card">
          <div className="cs-an-chart-head">Breakdown</div>
          {block.breakdown.length ? (
            <div className="cs-an-donut-wrap">
              <div className="cs-an-donut" style={{ background: donutBackground(block.breakdown) }}>
                <div className="cs-an-donut-hole">
                  <div className="cs-an-donut-total">{donutTotal.toLocaleString()}</div>
                  <div className="cs-an-donut-sublabel">total</div>
                </div>
              </div>
              <div className="cs-an-legend">
                {block.breakdown.map((s, idx) => (
                  <div key={s.label} className="cs-an-legend-row">
                    <span className="cs-an-legend-dot" style={{ background: labelColor(s.label, idx) }} />
                    <span className="cs-an-legend-name">{s.label}</span>
                    <span className="cs-an-legend-val">{s.value.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="cs-an-nodata">{loading ? 'Loading…' : 'No data'}</div>
          )}
        </div>
      </div>

      {/* ═══ LEADERBOARD (manager tier only — backend also enforces) ═══ */}
      {isManager ? (
        <div className="cs-an-lb-section">
          <div className="cs-an-section-head">
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Agent Leaderboard
            <span className="cs-an-section-hint">this period</span>
          </div>
          <div className="cs-table-wrap">
            <table className="cs-table cs-an-lb-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Agent</th>
                  <th style={{ textAlign: 'right' }}>{block.leaderboardCols[0]}</th>
                  <th style={{ textAlign: 'right' }}>{block.leaderboardCols[1]}</th>
                  <th style={{ textAlign: 'right' }}>{block.leaderboardCols[2]}</th>
                </tr>
              </thead>
              <tbody>
                {block.leaderboard.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="cs-empty">
                      {loading ? 'Loading…' : 'No agent activity in this range.'}
                    </td>
                  </tr>
                ) : (
                  block.leaderboard.map((a, idx) => (
                    <tr key={`${a.agent}-${idx}`} className="cs-an-lb-row">
                      <td>
                        <span className={`cs-an-rank${idx < 3 ? ' cs-an-rank-top' : ''}`}>
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                      </td>
                      <td>
                        <div className="cs-an-agent-cell">
                          <div className="cs-an-avatar">{agentInitials(a.agent)}</div>
                          <div className="cs-an-agent-info">
                            <div className="cs-an-agent-name">{a.agent}</div>
                            <div className="cs-an-agent-bar-wrap">
                              <div className="cs-an-agent-bar" style={{ width: `${Math.round((a.col1 / maxLead) * 100)}%` }} />
                            </div>
                          </div>
                        </div>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>
                        <strong className="cs-an-lb-num">{a.col1.toLocaleString()}</strong>
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                        {typeof a.col2 === 'number' ? a.col2.toLocaleString() : a.col2}
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{a.col3 || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
