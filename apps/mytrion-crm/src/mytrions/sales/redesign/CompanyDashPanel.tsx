/**
 * Company Dashboard — Applications + Gallon Volume gauges (self-service parity).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { getImpersonation } from '@/api/impersonation';
import { s } from './dc';
import { Icon } from './icons';
import { ICO } from './salesData';
import { formatCachedAt } from './dashCache';
import {
  COMPANY_TARGETS,
  gaugeDash,
  gaugePct,
  loadCompanyDashRaw,
  type CompanyDashRaw,
} from './dashCompanyData';
import { msdFmtNum } from './dashFormat';
import { CompanySkeleton } from './DashSkeleton';

function Gauge(props: {
  label: string;
  value: number;
  target: number | null;
  stroke: string;
}): ReactNode {
  const pct = gaugePct(props.value, props.target);
  return (
    <div
      style={s(
        'padding:18px 14px 16px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border2);text-align:center',
      )}
    >
      <svg viewBox="0 0 100 62" style={s('width:100%;max-width:160px;height:auto;display:block;margin:0 auto')}>
        <path d="M8,56 A42,42 0 0,1 92,56" fill="none" stroke="var(--raised)" strokeWidth="9" strokeLinecap="round" />
        <path
          d="M8,56 A42,42 0 0,1 92,56"
          fill="none"
          stroke={props.stroke}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={gaugeDash(props.value, props.target)}
          opacity={pct != null && pct >= 80 ? 1 : 0.85}
        />
        <circle cx="8" cy="56" r="3.5" fill="var(--border)" />
        <circle cx="92" cy="56" r="3.5" fill="var(--border)" />
        <text x="50" y="48" textAnchor="middle" fill="var(--text)" style={{ fontSize: 15, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>
          {msdFmtNum(props.value)}
        </text>
        <text x="50" y="58" textAnchor="middle" fill="var(--muted)" style={{ fontSize: 7.5, fontWeight: 600 }}>
          {pct != null ? `${Math.min(Math.round(pct), 999)}% of target` : 'No target set'}
        </text>
      </svg>
      <div style={s('font-size:13px;font-weight:800;margin-top:6px')}>{props.label}</div>
      <div style={s('font-size:11px;color:var(--faint);margin-top:3px')}>
        {props.target != null ? `Target: ${props.target.toLocaleString()}` : 'Not set yet'}
      </div>
    </div>
  );
}

export function CompanyDashPanel() {
  const actAsKey = getImpersonation()?.zohoUserId ?? 'self';
  const [data, setData] = useState<CompanyDashRaw | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = async (force: boolean): Promise<void> => {
    if (force) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      setData(await loadCompanyDashRaw({ force }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load company data.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void fetch(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actAsKey]);

  if (loading && !data) return <CompanySkeleton />;
  if (error && !data) {
    return (
      <div style={s('text-align:center;padding:48px 20px;color:var(--danger);font-size:13px')}>
        {error}
        <div style={s('margin-top:12px')}>
          <button type="button" onClick={() => void fetch(true)} style={s('padding:8px 14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);font-weight:700;cursor:pointer')}>
            Retry
          </button>
        </div>
      </div>
    );
  }
  if (!data) return null;

  const cachedAt = data.cachedAt ? new Date(data.cachedAt) : null;

  return (
    <div style={s('display:flex;flex-direction:column;gap:16px')}>
      <div style={s('display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap')}>
        <div>
          <div style={s('font-size:15px;font-weight:800')}>Company Dashboard</div>
          <div style={s('font-size:12px;color:var(--muted);margin-top:2px')}>
            {data.asOf
              ? `As of ${data.asOf}${data.weekStart ? ` — week starts ${data.weekStart}` : ''}`
              : 'Applications & gallon volume'}
            {cachedAt ? (
              <span style={s('margin-left:8px;color:var(--faint)')}>· Cached {formatCachedAt(cachedAt)} ET</span>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void fetch(true)}
          disabled={refreshing}
          style={s(
            'height:34px;padding:0 14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);font-weight:700;font-size:12px;cursor:pointer;color:var(--text2);display:inline-flex;align-items:center;gap:7px',
          )}
        >
          {refreshing ? (
            <>
              <span style={s('width:12px;height:12px;border-radius:50%;border:2px solid var(--border);border-top-color:var(--accent);animation:ss-spin .7s linear infinite')} />
              Refreshing…
            </>
          ) : (
            'Refresh'
          )}
        </button>
      </div>

      <div style={s('padding:18px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow-sm)')}>
        <div style={s('display:flex;align-items:center;gap:8px;margin-bottom:14px')}>
          <span style={s('width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--orange) 14%,transparent);color:var(--orange)')}>
            <Icon name={ICO.doc} size={14} />
          </span>
          <span style={s('font-size:13.5px;font-weight:800')}>Applications</span>
        </div>
        <div style={s('display:grid;grid-template-columns:repeat(3,1fr);gap:12px')}>
          <Gauge label="Today" value={data.fillsToday} target={COMPANY_TARGETS.fills_today} stroke="var(--orange)" />
          <Gauge label="This Week" value={data.fillsWeek} target={COMPANY_TARGETS.fills_this_week} stroke="var(--orange)" />
          <Gauge label="This Month" value={data.fillsMonth} target={COMPANY_TARGETS.fills_this_month} stroke="var(--orange)" />
        </div>
      </div>

      <div style={s('padding:18px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow-sm)')}>
        <div style={s('display:flex;align-items:center;gap:8px;margin-bottom:14px')}>
          <span style={s('width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent)')}>
            <Icon name={ICO.bolt} size={14} />
          </span>
          <span style={s('font-size:13.5px;font-weight:800')}>Gallon Volume</span>
        </div>
        <div style={s('display:grid;grid-template-columns:repeat(3,1fr);gap:12px')}>
          <Gauge label="Today" value={data.gallonsToday} target={COMPANY_TARGETS.gallons_today} stroke="var(--accent)" />
          <Gauge label="This Week" value={data.gallonsWeek} target={COMPANY_TARGETS.gallons_this_week} stroke="var(--accent)" />
          <Gauge label="This Month" value={data.gallonsMonth} target={COMPANY_TARGETS.gallons_this_month} stroke="var(--accent)" />
        </div>
      </div>
    </div>
  );
}
