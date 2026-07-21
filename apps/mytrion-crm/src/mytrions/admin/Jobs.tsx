import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TableSkeleton } from '@/components/mytrion/table-skeleton';
import {
  fetchJobsDashboard,
  triggerJob,
  type CatalogJob,
  type JobRunRow,
  type JobsDashboard,
  type QueueStateCount,
} from '../../api/jobs';
import { RefreshIcon, XIcon } from '../../components/icons';
import s from './admin.module.css';
import { adminToast } from './toast';

const RETENTION_SYNC = 'automation.retention.case-sync';
const STATE_FILTERS = ['All', 'completed', 'failed', 'active', 'created', 'cancelled'] as const;
const QUEUE_SKELETON = ['70%', '56%', '48%', '40%', '48px'] as const;
const RUN_SKELETON = ['48%', '70%', '40%', '64%'] as const;

function statusClass(job: CatalogJob): string {
  if (!job.active) return s.statusOff;
  if (job.trigger === 'cron') return s.statusOn;
  return s.statusReady;
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '—';
  const mins = Math.round((Date.now() - then) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleString();
}

function formatJson(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function countsFor(name: string, counts: QueueStateCount[]): string {
  const rows = counts.filter((c) => c.name === name);
  if (rows.length === 0) return '—';
  return rows.map((c) => `${c.state}:${c.count}`).join(' · ');
}

function outputPreview(output: unknown): string {
  if (output == null) return '—';
  if (typeof output === 'object' && output !== null && 'created' in output) {
    const o = output as Record<string, unknown>;
    return `created:${o.created ?? '?'} refreshed:${o.refreshed ?? '?'} closed:${o.closedReturned ?? '?'}`;
  }
  const raw = typeof output === 'string' ? output : JSON.stringify(output);
  return raw.length > 64 ? `${raw.slice(0, 64)}…` : raw;
}

/** Mytrion Admin — pg-boss queues, schedules, run results, and manual triggers. */
export function Jobs() {
  const [data, setData] = useState<JobsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nameFilter, setNameFilter] = useState('');
  const [stateFilter, setStateFilter] = useState<(typeof STATE_FILTERS)[number]>('All');
  const [openRun, setOpenRun] = useState<JobRunRow | null>(null);
  const [lookbackDays, setLookbackDays] = useState('45');
  const [syncLimit, setSyncLimit] = useState('500');
  const [running, setRunning] = useState<string | null>(null);
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = (loadSeq.current += 1);
    setLoading(true);
    setError('');
    try {
      const res = await fetchJobsDashboard({
        ...(nameFilter ? { name: nameFilter } : {}),
        ...(stateFilter !== 'All' ? { state: stateFilter } : {}),
        limit: 50,
      });
      if (seq !== loadSeq.current) return;
      setData(res);
    } catch (e) {
      if (seq === loadSeq.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [nameFilter, stateFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  /** First paint only — refresh keeps prior rows (no double spinner + blank table). */
  const initialLoad = loading && data == null;
  const catalog = data?.catalog ?? [];
  const runs = data?.runs ?? [];
  const activeCount = useMemo(() => catalog.filter((j) => j.active).length, [catalog]);

  async function onTrigger(name: string, manualTriggerable: boolean) {
    if (!manualTriggerable) return;
    setRunning(name);
    try {
      const opts =
        name === RETENTION_SYNC
          ? {
              lookbackDays: Math.min(365, Math.max(3, Number(lookbackDays) || 45)),
              limit: Math.min(2000, Math.max(1, Number(syncLimit) || 500)),
            }
          : {};
      const res = await triggerJob(name, opts);
      adminToast.success('Job queued', `${res.name} · ${res.jobId.slice(0, 8)}…`);
      await load();
    } catch (e) {
      adminToast.error('Could not queue job', e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className={`${s.panel} ${s.panelWide}`}>
      <div className={s.head}>
        <div>
          <div className={s.eyebrow}>Background jobs</div>
          <h2 className={s.h2}>pg-boss</h2>
          <p className={s.sub}>
            Every queue, live cron schedules, and recent run results (retention sync summaries live
            here). Timezone {data?.cronTz ?? '…'} · worker {data?.workerMode ?? '…'}
          </p>
        </div>
        <button type="button" className={s.ghostBtn} onClick={() => void load()} disabled={loading}>
          {loading ? (
            <>
              <span className={s.loadingSpin} aria-hidden="true" />
              Loading…
            </>
          ) : (
            <>
              <RefreshIcon /> Refresh
            </>
          )}
        </button>
      </div>

      {error ? (
        <p className={s.errorNote} role="alert">
          {error}
        </p>
      ) : null}
      {data && !data.enabled ? (
        <p className={s.errorNote} role="status">
          {data.reason ??
            'Jobs are disabled. Set FF_JOBS_ENABLED=1 against the app Postgres and restart the API.'}
        </p>
      ) : null}
      {data?.enabled && data.reason ? (
        <p className={s.errorNote} role="status">
          {data.reason}
        </p>
      ) : null}

      <div className={s.card}>
        <div className={s.cardHead}>
          <span className={s.cardTitle}>Retention case sync</span>
        </div>
        <div className={s.cardPad}>
          <p className={s.sub}>
            Scheduled every hour. Run now to scan the warehouse and create/refresh Phase-1
            retention cases (Returned auto-closes when the client fuels). Results show under Recent
            runs.
          </p>
          <div className={s.jobsFormRow}>
            <label className={s.field}>
              <span className={s.fieldLabel}>Lookback days</span>
              <input
                className={s.input}
                value={lookbackDays}
                onChange={(e) => setLookbackDays(e.target.value)}
                inputMode="numeric"
                disabled={initialLoad}
              />
            </label>
            <label className={s.field}>
              <span className={s.fieldLabel}>Limit</span>
              <input
                className={s.input}
                value={syncLimit}
                onChange={(e) => setSyncLimit(e.target.value)}
                inputMode="numeric"
                disabled={initialLoad}
              />
            </label>
            <button
              type="button"
              className={s.primaryBtn}
              disabled={!data?.enabled || running === RETENTION_SYNC || loading}
              onClick={() => void onTrigger(RETENTION_SYNC, true)}
            >
              {running === RETENTION_SYNC ? (
                <>
                  <span className={s.loadingSpin} aria-hidden="true" />
                  Queuing…
                </>
              ) : (
                'Run retention sync'
              )}
            </button>
          </div>
        </div>
      </div>

      <div className={s.card}>
        <div className={s.cardHead}>
          <span className={s.cardTitle}>All queues</span>
          <span className={s.chipMeta}>
            {initialLoad ? '…' : `${activeCount} active · ${catalog.length} total`}
          </span>
        </div>
        <div className={s.table} aria-busy={initialLoad}>
          <div className={`${s.tHead} ${s.tJobs}`}>
            <span>Job</span>
            <span>Type</span>
            <span>When</span>
            <span>Status</span>
            <span className={s.right}>Run</span>
          </div>
          {initialLoad ? (
            <>
              <span className={s.srOnly} role="status">
                Loading job queues…
              </span>
              <TableSkeleton
                widths={QUEUE_SKELETON}
                rowClassName={s.tRow}
                colsClassName={s.tJobs}
                rows={8}
              />
            </>
          ) : (
            catalog.map((job) => (
              <div key={job.name} className={`${s.tRow} ${s.tJobs}`}>
                <span>
                  <button
                    type="button"
                    className={s.linkBtn}
                    onClick={() => setNameFilter(job.name === nameFilter ? '' : job.name)}
                  >
                    <span className={s.jobTitle}>{job.title}</span>
                  </button>
                  <div className={s.mono} style={{ fontSize: 'var(--text-2xs)' }}>
                    {job.name}
                  </div>
                  <div className={s.jobDesc}>{job.description}</div>
                </span>
                <span>
                  <div className={s.deptText}>{job.triggerLabel}</div>
                  {job.cron ? (
                    <div className={s.mono} style={{ fontSize: 'var(--text-2xs)' }} title="Raw cron">
                      {job.cron}
                    </div>
                  ) : null}
                </span>
                <span className={s.deptText}>{job.scheduleLabel}</span>
                <span>
                  <div className={statusClass(job)}>{job.active ? 'Active' : 'Inactive'}</div>
                  <div className={s.deptText}>{job.statusLabel}</div>
                  <div className={s.deptText}>{countsFor(job.name, data?.counts ?? [])}</div>
                </span>
                <span className={s.right}>
                  {job.manualTriggerable ? (
                    <button
                      type="button"
                      className={s.ghostBtn}
                      disabled={!data?.enabled || running === job.name}
                      onClick={() => void onTrigger(job.name, job.manualTriggerable)}
                    >
                      {running === job.name ? (
                        <>
                          <span className={s.loadingSpin} aria-hidden="true" />
                          Run
                        </>
                      ) : (
                        'Run'
                      )}
                    </button>
                  ) : (
                    <span className={s.deptText}>
                      {job.trigger === 'dead_letter' ? 'auto' : 'API only'}
                    </span>
                  )}
                </span>
              </div>
            ))
          )}
          {!initialLoad && catalog.length === 0 ? (
            <div className={s.none}>No queues in catalog.</div>
          ) : null}
        </div>
      </div>

      <div>
        <div className={s.cardHead} style={{ paddingLeft: 0, paddingRight: 0, border: 'none' }}>
          <span className={s.cardTitle}>Recent runs</span>
        </div>
        <div className={s.chipRow}>
          {STATE_FILTERS.map((st) => (
            <button
              key={st}
              type="button"
              className={`${s.filterChip}${stateFilter === st ? ` ${s.filterChipOn}` : ''}`}
              onClick={() => setStateFilter(st)}
              disabled={initialLoad}
            >
              {st}
            </button>
          ))}
          {nameFilter ? (
            <button
              type="button"
              className={`${s.filterChip} ${s.filterChipOn}`}
              onClick={() => setNameFilter('')}
              disabled={initialLoad}
            >
              {nameFilter} ×
            </button>
          ) : null}
          <span className={s.chipMeta}>{initialLoad ? '…' : `${runs.length} shown`}</span>
        </div>
        <div
          className={s.table}
          style={{ marginTop: 'var(--space-3)' }}
          aria-busy={initialLoad || (loading && runs.length === 0)}
        >
          <div className={`${s.tHead} ${s.tJobRuns}`}>
            <span>When</span>
            <span>Queue</span>
            <span>State</span>
            <span>Result</span>
          </div>
          {initialLoad || (loading && runs.length === 0) ? (
            <>
              <span className={s.srOnly} role="status">
                Loading job runs…
              </span>
              <TableSkeleton
                widths={RUN_SKELETON}
                rowClassName={s.tRow}
                colsClassName={s.tJobRuns}
                rows={8}
              />
            </>
          ) : (
            runs.map((run) => (
              <div
                key={run.id}
                className={`${s.tRow} ${s.tJobRuns}`}
                role="button"
                tabIndex={0}
                onClick={() => setOpenRun(run)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setOpenRun(run);
                  }
                }}
              >
                <span
                  className={s.deptText}
                  title={run.completedOn ?? run.startedOn ?? run.createdOn ?? ''}
                >
                  {relativeTime(run.completedOn ?? run.startedOn ?? run.createdOn)}
                </span>
                <span className={s.mono}>{run.name}</span>
                <span className={s.badge}>{run.state}</span>
                <span className={s.deptText}>{outputPreview(run.output)}</span>
              </div>
            ))
          )}
          {!loading && runs.length === 0 ? (
            <div className={s.none}>No job runs for this filter.</div>
          ) : null}
        </div>
      </div>

      {openRun ? (
        <div
          className={s.modalBackdrop}
          role="presentation"
          onClick={() => setOpenRun(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpenRun(null);
          }}
        >
          <div
            className={s.modal}
            role="dialog"
            aria-label="Job run detail"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={s.modalHead}>
              <span className={s.cardTitle}>{openRun.name}</span>
              <button type="button" className={s.iconBtn} onClick={() => setOpenRun(null)} aria-label="Close">
                <XIcon />
              </button>
            </div>
            <div className={s.metaGrid}>
              <div className={s.field}>
                <span className={s.fieldLabel}>State</span>
                <span className={s.metaValue}>{openRun.state}</span>
              </div>
              <div className={s.field}>
                <span className={s.fieldLabel}>Id</span>
                <span className={`${s.metaValue} ${s.mono}`}>{openRun.id}</span>
              </div>
              <div className={s.field}>
                <span className={s.fieldLabel}>Created</span>
                <span className={s.metaValue}>{openRun.createdOn ?? '—'}</span>
              </div>
              <div className={s.field}>
                <span className={s.fieldLabel}>Completed</span>
                <span className={s.metaValue}>{openRun.completedOn ?? '—'}</span>
              </div>
            </div>
            <div className={s.chunkCard}>
              <div className={s.chunkMeta}>
                <span className={s.mono}>payload</span>
              </div>
              <pre className={s.chunkText}>{formatJson(openRun.data)}</pre>
            </div>
            <div className={s.chunkCard}>
              <div className={s.chunkMeta}>
                <span className={s.mono}>output</span>
              </div>
              <pre className={s.chunkText}>{formatJson(openRun.output)}</pre>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
