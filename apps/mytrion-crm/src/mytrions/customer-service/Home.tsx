/**
 * Home panel — 1:1 re-skin onto the zoho-octane widget's home-panel template
 * (cs-home-* classes, Paper White / Royal Blue). Data stays on the live loadHome()
 * adapter; the greeting/initials stay getSession()-based. The "Open Tickets by
 * Priority" block (live data the widget didn't have) is kept, rendered with the
 * widget's activity-list idiom.
 */
import type { CSSProperties, ReactNode } from 'react';

import { getSession } from '@/api/session';
import { greeting, type ActivityRow, type PriorityRow } from './data';
import { loadHome, useLoad } from './live';

/** Widget stageColors (hex dots), keyed by our ActivityRow tone. */
const DOT_COLORS: Record<ActivityRow['dot'], string> = {
  good: '#16A34A',
  bad: '#DC2626',
  orange: '#EA580C',
  sky: '#2563EB',
  purple: '#8B5CF6',
};

const PRIORITY_COLORS: Record<PriorityRow['tone'], string> = {
  bad: '#DC2626',
  warn: '#D97706',
  info: '#2563EB',
  neutral: '#9CA3AF',
};

const TODAY_LABEL = new Date().toLocaleDateString('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

export function Home() {
  const home = useLoad(loadHome, []);
  const worker = getSession()?.worker;
  const name = worker?.userName ?? 'Agent';
  const firstName = name.split(/\s+/)[0] ?? name;
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || 'CS';
  const role = worker?.role ?? worker?.profile ?? 'Customer Service';

  const loading = home.loading;
  const activity: ActivityRow[] = home.data?.activity ?? [];
  const priorities: PriorityRow[] = home.data?.byPriority ?? [];
  const totalOpen = priorities.reduce((sum, p) => sum + p.count, 0);

  return (
    <div className="cs-panel cs-home-panel">
      {/* ── Header ── */}
      <div className="cs-header-row">
        <div>
          <h2 className="cs-title">Home</h2>
          <div className="cs-subtitle">{TODAY_LABEL} — Customer Service Dashboard</div>
        </div>
        <button className="cs-refresh-btn" onClick={home.reload} disabled={loading} title="Refresh">
          <svg
            width="13"
            height="13"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            className={loading ? 'spin-icon' : undefined}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-14.357-2m14.357 2H15"
            />
          </svg>
          Refresh
        </button>
      </div>

      {/* ── Welcome banner ── */}
      <div className="cs-home-welcome">
        <div className="cs-home-welcome-left">
          <div className="cs-home-welcome-avatar">{initials}</div>
          <div>
            <div className="cs-home-welcome-greeting">
              {greeting()}, {firstName}
            </div>
            <div className="cs-home-welcome-sub">{role} · Ready to help</div>
          </div>
        </div>
        <span className="cs-badge cs-badge-info" style={{ fontSize: '0.625rem', letterSpacing: '0.12em' }}>
          ● LIVE
        </span>
      </div>

      {/* ── Quick stats ── */}
      <div className="cs-home-section-label">Team Overview</div>
      <div className="cs-home-stats">
        <StatCard
          variant="cs-home-stat-blue"
          iconBg="rgba(37,99,235,0.08)"
          icon={
            <svg width="16" height="16" fill="none" stroke="currentColor" style={{ color: 'var(--cs-accent)' }} viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"
              />
            </svg>
          }
          loading={loading}
          value={home.data?.team.openTickets ?? '—'}
          label="Open Tickets"
          hint="Active support cases"
        />
        <StatCard
          variant="cs-home-stat-amber"
          iconBg="rgba(245,158,11,0.12)"
          icon={
            <svg width="16" height="16" fill="none" stroke="currentColor" style={{ color: 'var(--cs-warning)' }} viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          }
          loading={loading}
          value={home.data?.team.pendingApps ?? '—'}
          label="Pending Apps"
          hint="Awaiting carrier ID"
        />
        <StatCard
          variant="cs-home-stat-green"
          iconBg="rgba(46,204,113,0.12)"
          icon={
            <svg width="16" height="16" fill="none" stroke="currentColor" style={{ color: 'var(--cs-success)' }} viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          }
          loading={loading}
          value={home.data?.team.activeClients ?? '—'}
          label="Active Clients"
          hint="With carrier ID"
        />
        <StatCard
          variant="cs-home-stat-orange"
          iconBg="rgba(251,146,60,0.12)"
          icon={
            <svg width="16" height="16" fill="none" stroke="currentColor" style={{ color: 'var(--cs-orange)' }} viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          }
          loading={loading}
          value={home.data?.team.maintenance ?? '—'}
          label="Maintenance"
          hint="This month"
        />
      </div>

      {/* ── My Performance ── */}
      <div className="cs-home-section-label" style={{ marginTop: '1.25rem' }}>
        My Performance
      </div>
      <div className="cs-home-perf-strip">
        <PerfItem loading={loading} value={home.data?.my.pendingApps ?? '—'} label="My Pending Apps" />
        <PerfItem loading={loading} value={home.data?.my.activeClients ?? '—'} label="My Active Clients" />
        <PerfItem loading={loading} value={home.data?.my.ticketsMonth ?? '—'} label="My Tickets (Month)" />
        <PerfItem loading={loading} value={home.data?.my.ticketsLastMonth ?? '—'} label="Last Month" />
      </div>

      {/* ── Recent Activity ── */}
      <div className="cs-home-section-label" style={{ marginTop: '1.25rem' }}>
        Recent Activity
      </div>
      <div className="cs-home-activity">
        {loading ? (
          [1, 2, 3, 4].map((i) => <SkeletonActivityItem key={i} />)
        ) : activity.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
            No recent activity
          </div>
        ) : (
          activity.map((item) => (
            <div key={item.id} className="cs-home-activity-item">
              <div
                className="cs-home-activity-dot"
                style={{ background: DOT_COLORS[item.dot], color: DOT_COLORS[item.dot] }}
              />
              <div className="cs-home-activity-body">
                <div className="cs-home-activity-text">{item.text}</div>
                <div className="cs-home-activity-sub">{item.sub}</div>
              </div>
              <div className="cs-home-activity-time">{item.time}</div>
            </div>
          ))
        )}
      </div>

      {/* ── Open Tickets by Priority (live extra; widget activity-list idiom) ── */}
      <div className="cs-home-section-label" style={{ marginTop: '1.25rem' }}>
        Open Tickets by Priority
      </div>
      <div className="cs-home-activity">
        {loading ? (
          [1, 2].map((i) => <SkeletonActivityItem key={i} />)
        ) : priorities.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
            No priority breakdown available
          </div>
        ) : (
          <>
            {priorities.map((p) => (
              <div key={p.label} className="cs-home-activity-item">
                <div
                  className="cs-home-activity-dot"
                  style={{ background: PRIORITY_COLORS[p.tone], color: PRIORITY_COLORS[p.tone] }}
                />
                <div className="cs-home-activity-body">
                  <div className="cs-home-activity-text">{p.label}</div>
                </div>
                <div className="cs-home-activity-time" style={{ fontVariantNumeric: 'tabular-nums' }}>{p.count}</div>
              </div>
            ))}
            <div className="cs-home-activity-item">
              <div className="cs-home-activity-body">
                <div className="cs-home-activity-text">Total open</div>
              </div>
              <div
                className="cs-home-activity-time"
                style={{ color: 'var(--text-primary)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
              >
                {totalOpen}
              </div>
            </div>
          </>
        )}
      </div>

      {/* error notice */}
      {home.error ? (
        <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--cs-warning)', textAlign: 'center' }}>
          ⚠ Some metrics unavailable — {home.error}
        </div>
      ) : null}
    </div>
  );
}

function StatCard({
  variant,
  iconBg,
  icon,
  loading,
  value,
  label,
  hint,
}: {
  variant: string;
  iconBg: string;
  icon: ReactNode;
  loading: boolean;
  value: string;
  label: string;
  hint: string;
}) {
  return (
    <div className={`cs-home-stat-card ${variant}`}>
      <div className="cs-home-stat-icon" style={{ background: iconBg }}>
        {icon}
      </div>
      <div className="cs-home-stat-value">
        {loading ? <span className="cs-home-stat-skeleton" /> : <span>{value}</span>}
      </div>
      <div className="cs-home-stat-label">{label}</div>
      <div className="cs-home-stat-hint">{hint}</div>
    </div>
  );
}

function PerfItem({ loading, value, label }: { loading: boolean; value: string; label: string }) {
  let body: ReactNode;
  if (loading) {
    body = <span className="cs-home-stat-skeleton" style={{ width: '36px', height: '22px' }} />;
  } else if (value === '—') {
    // Widget renders unavailable perf values muted and smaller.
    body = <span style={{ color: 'var(--text-muted)', fontSize: '1rem' }}>—</span>;
  } else {
    body = <span>{value}</span>;
  }
  return (
    <div className="cs-home-perf-item">
      <div className="cs-home-perf-value">{body}</div>
      <div className="cs-home-perf-label">{label}</div>
    </div>
  );
}

function SkeletonActivityItem() {
  const skeleton: CSSProperties = { height: '12px', width: '70%', marginBottom: '4px' };
  return (
    <div className="cs-home-activity-item">
      <div className="cs-home-activity-dot" style={{ background: 'var(--check-border)' }} />
      <div className="cs-home-activity-body">
        <div className="cs-home-stat-skeleton" style={skeleton} />
        <div className="cs-home-stat-skeleton" style={{ height: '10px', width: '40%' }} />
      </div>
    </div>
  );
}
