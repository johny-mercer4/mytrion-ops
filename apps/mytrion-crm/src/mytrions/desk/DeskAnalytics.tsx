import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Select, type SelectOption } from '@/ds';
import {
  getCommsAnalytics,
  type CommsAnalyticsDto,
  type DepartmentOptionDto,
  type TicketKind,
} from '@/api/comms';
import styles from './desk.module.css';

const WINDOW_OPTS: SelectOption[] = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

const KIND_OPTS: SelectOption[] = [
  { value: 'all', label: 'Tickets + escalations' },
  { value: 'ticket', label: 'Tickets only' },
  { value: 'escalation', label: 'Escalations only' },
];

const STATUS_ORDER = [
  'open',
  'in_progress',
  'pending_requester',
  'on_hold',
  'escalated',
  'resolved',
  'closed',
  'cancelled',
];
const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low'];

const humanize = (s: string): string => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

function formatHours(h: number | null): string {
  if (h == null) return '—';
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

/** Order a breakdown by a canonical list, unknown keys appended. */
function order<T extends { key: string | null }>(rows: T[], seq: string[]): T[] {
  return [...rows].sort((a, b) => {
    const ia = seq.indexOf(a.key ?? '');
    const ib = seq.indexOf(b.key ?? '');
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
}

/**
 * Desk Analytics & SLA dashboard.
 *
 * Every figure is server-computed over exactly the tickets this worker may see (the same reader gate as
 * the queue), so it can never disagree with the list. First paint shows one skeleton; changing a filter
 * keeps the numbers on screen and dims them rather than blanking back to a loader (the modern-web-guidance
 * "refresh of visible content" rule). Bars and tiles are token-only; status/SLA colour comes from the tint
 * scale, never the Mytrion accent.
 */
export function DeskAnalytics({ departments }: { departments: DepartmentOptionDto[] }) {
  const [sinceDays, setSinceDays] = useState('30');
  const [kind, setKind] = useState('all');
  const [department, setDepartment] = useState<string | null>(null);
  const [data, setData] = useState<CommsAnalyticsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState('');
  const reqRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    reqRef.current?.abort();
    const ac = new AbortController();
    reqRef.current = ac;
    setError('');
    // Marks in-flight; only visible once data exists (the skeleton owns the first paint), so this
    // never needs to read current state and the effect stays keyed purely on the filters.
    setStale(true);
    try {
      const res = await getCommsAnalytics(
        {
          sinceDays: Number(sinceDays),
          ...(kind !== 'all' ? { kind: kind as TicketKind } : {}),
          ...(department ? { department } : {}),
        },
        { signal: ac.signal },
      );
      if (!ac.signal.aborted) setData(res);
    } catch (e) {
      if (!ac.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!ac.signal.aborted) {
        setLoading(false);
        setStale(false);
      }
    }
  }, [sinceDays, kind, department]);

  useEffect(() => {
    void load();
    return () => reqRef.current?.abort();
  }, [load]);

  const deptOpts = useMemo<SelectOption[]>(
    () => departments.map((d) => ({ value: d.department, label: d.label })),
    [departments],
  );

  const fr = data?.sla;
  const frDenom = fr ? fr.firstResponseMet + fr.firstResponseMissed : 0;
  const frMetPct = fr && frDenom > 0 ? Math.round((fr.firstResponseMet / frDenom) * 100) : null;
  const volMax = data ? Math.max(1, ...data.volume.map((v) => Math.max(v.created, v.resolved))) : 1;

  return (
    <div className={styles.settings}>
      <div className={styles.aHead}>
        <div className={styles.settingsHead}>
          <h2 className={styles.settingsTitle}>Analytics &amp; SLA</h2>
          <p className={styles.settingsSub}>
            Live over the tickets and escalations your queue can see. SLA figures use each ticket&rsquo;s
            own due dates.
          </p>
        </div>
        <div className={styles.aControls}>
          <span className={styles.aControl}>
            <Select label="Window" labelHidden searchable={false} options={WINDOW_OPTS} value={sinceDays} onChange={(v) => setSinceDays(v ?? '30')} />
          </span>
          <span className={styles.aControl}>
            <Select label="Kind" labelHidden searchable={false} options={KIND_OPTS} value={kind} onChange={(v) => setKind(v ?? 'all')} />
          </span>
          {deptOpts.length > 1 ? (
            <span className={styles.aControl}>
              <Select
                label="Department"
                labelHidden
                options={deptOpts}
                value={department}
                onChange={setDepartment}
                placeholder="All departments"
                clearable
              />
            </span>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {loading && !data ? (
        <div className={styles.skeleton} aria-hidden="true" />
      ) : data ? (
        <div className={styles.analytics} data-stale={stale || undefined}>
          <div className={styles.statGrid}>
            <Stat label="Open" value={data.totals.open} />
            <Stat label="Overdue" value={data.totals.overdue} tone={data.totals.overdue > 0 ? 'bad' : undefined} />
            <Stat label="SLA breached" value={data.totals.breached} tone={data.totals.breached > 0 ? 'bad' : undefined} />
            <Stat label="First-response met" value={frMetPct == null ? '—' : `${frMetPct}%`} tone={frMetPct != null && frMetPct < 80 ? 'warn' : 'good'} />
            <Stat label="Avg resolution" value={formatHours(data.sla.avgResolutionHours)} />
            <Stat label="Avg first response" value={formatHours(data.sla.avgFirstResponseHours)} />
          </div>

          <div className={styles.cards}>
            <section className={styles.card}>
              <h3 className={styles.cardTitle}>Volume · last {data.window.sinceDays} days</h3>
              <div className={styles.legend}>
                <span className={styles.legendItem} data-series="created">Created</span>
                <span className={styles.legendItem} data-series="resolved">Resolved</span>
              </div>
              <div className={styles.volBars} role="img" aria-label={`Daily created and resolved over ${data.window.sinceDays} days`}>
                {data.volume.map((v) => (
                  <span
                    key={v.date}
                    className={styles.volCol}
                    title={`${v.date} · ${v.created} created · ${v.resolved} resolved`}
                  >
                    <span className={styles.volBar} data-series="created" style={{ height: `${(v.created / volMax) * 100}%` }} />
                    <span className={styles.volBar} data-series="resolved" style={{ height: `${(v.resolved / volMax) * 100}%` }} />
                  </span>
                ))}
              </div>
            </section>

            <section className={styles.card}>
              <h3 className={styles.cardTitle}>By status</h3>
              <Bars rows={order(data.byStatus, STATUS_ORDER)} total={data.totals.all} labeler={(k) => humanize(k ?? '')} />
            </section>

            <section className={styles.card}>
              <h3 className={styles.cardTitle}>By priority</h3>
              <Bars rows={order(data.byPriority, PRIORITY_ORDER)} total={data.totals.all} labeler={(k) => humanize(k ?? '')} />
            </section>

            {data.byDepartment.length > 1 ? (
              <section className={styles.card}>
                <h3 className={styles.cardTitle}>By department</h3>
                <Bars
                  rows={data.byDepartment}
                  total={data.totals.all}
                  labeler={(k) => (k ? humanize(k) : 'Unrouted')}
                />
              </section>
            ) : null}

            <section className={styles.card}>
              <h3 className={styles.cardTitle}>Open by agent</h3>
              {data.topAssignees.length > 0 ? (
                <ul className={styles.barList}>
                  {data.topAssignees.map((a) => (
                    <li key={a.zohoUserId} className={styles.barRow}>
                      <span className={styles.barLabel}>{a.name ?? a.zohoUserId}</span>
                      <span className={styles.barTrack}>
                        <span
                          className={styles.barFill}
                          style={{ width: `${(a.open / Math.max(1, data.topAssignees[0]?.open ?? 1)) * 100}%` }}
                        />
                      </span>
                      <span className={styles.barCount}>{a.open}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.cardHint}>No open work assigned right now.</p>
              )}
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: 'good' | 'warn' | 'bad' | undefined;
}) {
  return (
    <div className={styles.stat} data-tone={tone}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

function Bars({
  rows,
  total,
  labeler,
}: {
  rows: { key: string | null; count: number }[];
  total: number;
  labeler: (k: string | null) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (rows.length === 0) return <p className={styles.cardHint}>Nothing here yet.</p>;
  return (
    <ul className={styles.barList}>
      {rows.map((r) => (
        <li key={r.key ?? '∅'} className={styles.barRow} data-key={r.key ?? undefined}>
          <span className={styles.barLabel}>{labeler(r.key)}</span>
          <span className={styles.barTrack}>
            <span className={styles.barFill} style={{ width: `${(r.count / max) * 100}%` }} />
          </span>
          <span className={styles.barCount}>
            {r.count}
            {total > 0 ? <em className={styles.barPct}>{Math.round((r.count / total) * 100)}%</em> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
