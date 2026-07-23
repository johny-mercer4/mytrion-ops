/**
 * Home — CSMYTRION layout, live data only (no streak / CSAT / fake queue / leaderboard).
 */
import type { CSSProperties, ReactNode } from 'react';

import { getSession } from '@/api/session';
import type { CsSectionId } from './csNav';
import { greeting, type ActivityRow, type PriorityRow } from './data';
import { loadHome, useLoad } from './live';

const PRIORITY_COLORS: Record<PriorityRow['tone'], string> = {
  bad: 'var(--cs-danger)',
  warn: 'var(--cs-warning)',
  info: 'var(--cs-sky)',
  neutral: 'var(--text-muted)',
};

const DOT_COLORS: Record<ActivityRow['dot'], string> = {
  good: 'var(--cs-success)',
  bad: 'var(--cs-danger)',
  orange: 'var(--cs-orange)',
  sky: 'var(--cs-sky)',
  purple: 'var(--cs-purple)',
};

/** Status pill color — Escalated/Overdue red, On Hold amber, Open green, Closed muted, else sky. */
function ticketStatusColor(status: string | null, statusType: string | null): string {
  if (statusType && statusType.toLowerCase() === 'closed') return 'var(--text-muted)';
  const s = (status ?? '').toLowerCase();
  if (s.includes('escalat') || s.includes('overdue')) return 'var(--cs-danger)';
  if (s.includes('hold')) return 'var(--cs-warning)';
  if (s.includes('open')) return 'var(--cs-success)';
  return 'var(--cs-sky)';
}

const TODAY_LABEL = new Date().toLocaleDateString('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

const ICONS = {
  ticket:
    'M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z',
  apps: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  clients:
    'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
  wrench:
    'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
  shield:
    'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  chart:
    'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  retain:
    'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  refresh:
    'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-14.357-2m14.357 2H15',
};

interface HomeProps {
  onNavigate: (id: CsSectionId) => void;
}

export function Home({ onNavigate }: HomeProps) {
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
  const openTicketRows = home.data?.openTicketRows ?? [];
  const totalOpen = priorities.reduce((sum, p) => sum + p.count, 0);
  const maxPriority = Math.max(1, ...priorities.map((p) => p.count));

  const quickActions: Array<{
    id: CsSectionId;
    label: string;
    sub: string;
    icon: string;
    chip: string;
  }> = [
    {
      id: 'applications',
      label: 'Applications',
      sub: loading ? 'Loading…' : `${home.data?.team.pendingApps ?? '—'} pending`,
      icon: ICONS.apps,
      chip: 'var(--cs-warning-soft)',
    },
    {
      id: 'open-pool',
      label: 'Open Pool',
      sub: 'Readonly Sales pool',
      icon: ICONS.shield,
      chip: 'var(--cs-accent-soft)',
    },
    {
      id: 'retention-cases',
      label: 'Retention Cases',
      sub: 'Phase 2 desk',
      icon: ICONS.retain,
      chip: 'var(--cs-sky-soft)',
    },
    {
      id: 'analytics',
      label: 'Analytics',
      sub: 'Tickets · calls · maintenance',
      icon: ICONS.chart,
      chip: 'var(--cs-purple-soft)',
    },
  ];

  const teamKpis = [
    {
      label: 'Open Tickets',
      hint: 'Active support cases',
      value: home.data?.team.openTickets ?? '—',
      icon: ICONS.ticket,
      chipBg: 'var(--cs-sky-soft)',
      chipColor: 'var(--cs-sky)',
      meter: 'var(--cs-sky)',
    },
    {
      label: 'Pending Apps',
      hint: 'Awaiting carrier ID',
      value: home.data?.team.pendingApps ?? '—',
      icon: ICONS.apps,
      chipBg: 'var(--cs-warning-soft)',
      chipColor: 'var(--cs-warning)',
      meter: 'var(--cs-warning)',
    },
    {
      label: 'Active Clients',
      hint: 'With carrier ID',
      value: home.data?.team.activeClients ?? '—',
      icon: ICONS.clients,
      chipBg: 'var(--cs-success-soft)',
      chipColor: 'var(--cs-success)',
      meter: 'var(--cs-success)',
    },
    {
      label: 'Maintenance',
      hint: 'This month',
      value: home.data?.team.maintenance ?? '—',
      icon: ICONS.wrench,
      chipBg: 'var(--cs-accent-soft)',
      chipColor: 'var(--cs-orange)',
      meter: 'var(--cs-orange)',
    },
  ];

  const myPerf = [
    { label: 'My Pending Apps', value: home.data?.my.pendingApps ?? '—' },
    { label: 'My Active Clients', value: home.data?.my.activeClients ?? '—' },
    { label: 'My Tickets (Month)', value: home.data?.my.ticketsMonth ?? '—' },
    { label: 'Last Month', value: home.data?.my.ticketsLastMonth ?? '—' },
  ];

  return (
    <div className="cs-panel cs-home-panel">
      <div className="cs-header-row">
        <div>
          <h2 className="cs-title">Home</h2>
          <div className="cs-subtitle">{TODAY_LABEL} · Customer Service dashboard</div>
        </div>
        <button
          type="button"
          className="cs-refresh-btn"
          onClick={home.reload}
          disabled={loading}
          title="Refresh"
        >
          <svg
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            className={loading ? 'spin-icon' : undefined}
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={ICONS.refresh} />
          </svg>
          Refresh
        </button>
      </div>

      <div className="cs-home-hero">
        <div className="cs-home-hero-glow" aria-hidden />
        <div className="cs-home-hero-inner">
          <div className="cs-home-welcome-left">
            <div className="cs-home-welcome-avatar">{initials}</div>
            <div>
              <div className="cs-home-welcome-greeting">
                {greeting()}, {firstName}
              </div>
              <div className="cs-home-welcome-sub">
                <span className="cs-home-live-dot" aria-hidden />
                {role} · ready to help
              </div>
            </div>
          </div>
        </div>
      </div>

      <div>
        <div className="cs-home-section-label">Jump back in</div>
        <div className="cs-home-qa-grid">
          {quickActions.map((qa) => (
            <button
              key={qa.id}
              type="button"
              className="cs-home-qa-card"
              onClick={() => onNavigate(qa.id)}
            >
              <span className="cs-home-qa-chip" style={{ background: qa.chip }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d={qa.icon} />
                </svg>
              </span>
              <span>
                <span className="cs-home-qa-label">{qa.label}</span>
                <span className="cs-home-qa-sub">{qa.sub}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="cs-home-section-label">
          Team overview
          <span className="cs-home-live-pill">
            <span className="cs-home-live-dot" aria-hidden />
            live
          </span>
        </div>
        <div className="cs-home-stats">
          {teamKpis.map((k) => (
            <div key={k.label} className="cs-home-stat-card">
              <div className="cs-home-stat-top">
                <span className="cs-home-stat-icon" style={{ background: k.chipBg, color: k.chipColor }}>
                  <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={k.icon} />
                  </svg>
                </span>
              </div>
              <div className="cs-home-stat-value">
                {loading ? <span className="cs-home-stat-skeleton" /> : k.value}
              </div>
              <div className="cs-home-stat-label">{k.label}</div>
              <div className="cs-home-stat-hint">{k.hint}</div>
              <div className="cs-home-stat-meter">
                <div style={{ background: k.meter, width: loading ? '40%' : '72%' }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="cs-home-section-label">My performance</div>
        <div className="cs-home-perf-strip">
          {myPerf.map((p) => (
            <PerfItem key={p.label} loading={loading} value={p.value} label={p.label} />
          ))}
        </div>
      </div>

      <div className="cs-home-split">
        <div className="cs-home-card">
          <div className="cs-home-card-head">
            <div className="cs-home-card-title">
              <span className="cs-home-live-dot" aria-hidden />
              Open tickets
            </div>
            <span className="cs-home-card-meta">
              {loading ? '…' : `${home.data?.team.openTickets ?? totalOpen} open`}
            </span>
          </div>
          {loading ? (
            [1, 2, 3].map((i) => <SkeletonActivityItem key={i} />)
          ) : priorities.length === 0 && openTicketRows.length === 0 ? (
            <div className="cs-home-empty">No open tickets</div>
          ) : (
            <>
              {priorities.length > 0 ? (
                <div className="cs-home-priority-list">
                  {priorities.map((p) => (
                    <div key={p.label} className="cs-home-priority-row">
                      <div className="cs-home-priority-labels">
                        <span>{p.label}</span>
                        <span className="cs-home-mono">{p.count}</span>
                      </div>
                      <div className="cs-home-priority-track">
                        <div
                          style={{
                            width: `${Math.round((p.count / maxPriority) * 100)}%`,
                            background: PRIORITY_COLORS[p.tone],
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              {openTicketRows.length > 0 ? (
                <div className="cs-home-ticket-list">
                  {openTicketRows.map((t) => (
                    <div key={t.id} className="cs-home-ticket-row">
                      <span className="cs-home-ticket-num">#{t.ticketNumber ?? t.id}</span>
                      <span className="cs-home-ticket-subject" title={t.subject ?? undefined}>
                        {t.subject ?? '—'}
                      </span>
                      <span
                        className="cs-home-ticket-status"
                        style={{
                          background: `color-mix(in srgb, ${ticketStatusColor(t.status, t.statusType)} 16%, transparent)`,
                          color: ticketStatusColor(t.status, t.statusType),
                        }}
                      >
                        {t.status ?? '—'}
                      </span>
                      <span className="cs-home-ticket-owner" title={t.owner ?? 'Unassigned'}>
                        {t.owner ?? 'Unassigned'}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="cs-home-card">
          <div className="cs-home-card-head">
            <div className="cs-home-card-title">Recent activity</div>
          </div>
          {loading ? (
            [1, 2, 3, 4].map((i) => <SkeletonActivityItem key={i} />)
          ) : activity.length === 0 ? (
            <div className="cs-home-empty">No recent activity</div>
          ) : (
            activity.map((item) => (
              <div key={item.id} className="cs-home-activity-item">
                <div
                  className="cs-home-activity-dot"
                  style={{ background: DOT_COLORS[item.dot] }}
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
      </div>

      {home.error ? (
        <div className="cs-home-error">Some metrics unavailable — {home.error}</div>
      ) : null}
    </div>
  );
}

function PerfItem({ loading, value, label }: { loading: boolean; value: string; label: string }) {
  let body: ReactNode;
  if (loading) {
    body = <span className="cs-home-stat-skeleton" style={{ width: '36px', height: '22px' }} />;
  } else if (value === '—') {
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
