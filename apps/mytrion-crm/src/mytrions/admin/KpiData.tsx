import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Database,
  FileClock,
  RefreshCw,
  Search,
  Table2,
  Users,
} from 'lucide-react';
import {
  getAdminKpiOverview,
  listAdminKpiDays,
  listAdminKpiFacts,
  listAdminKpiSnapshots,
  listAdminKpiWorkers,
  type AdminKpiDay,
  type AdminKpiFact,
  type AdminKpiMetric,
  type AdminKpiOverview,
  type AdminKpiRun,
  type AdminKpiSnapshot,
  type AdminKpiWorker,
} from '../../api/adminKpi';
import s from './admin.module.css';
import k from './KpiData.module.css';

type View = 'overview' | 'metrics' | 'workers' | 'facts' | 'runs' | 'tables';

const VIEWS: Array<{ id: View; label: string; icon: typeof BarChart3 }> = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'metrics', label: 'Metrics', icon: CheckCircle2 },
  { id: 'workers', label: 'Workers', icon: Users },
  { id: 'facts', label: 'Raw facts', icon: Database },
  { id: 'runs', label: 'Run history', icon: FileClock },
  { id: 'tables', label: 'Tables', icon: Table2 },
];

function friendly(value: string): string {
  return value.replaceAll('_', ' ');
}

function formatNumber(value: number | null, unit: string): string {
  if (value === null) return 'Unavailable';
  if (unit === 'ratio') return `${(value * 100).toFixed(1)}%`;
  if (unit === 'seconds') {
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  }
  return new Intl.NumberFormat().format(value);
}

function latestRuns(runs: AdminKpiRun[]): AdminKpiRun[] {
  const seen = new Set<string>();
  return runs.filter((run) => {
    if (seen.has(run.source)) return false;
    seen.add(run.source);
    return true;
  });
}

function metricByKey(metrics: AdminKpiMetric[], key: string): AdminKpiMetric | undefined {
  return metrics.find((metric) => metric.metricKey === key);
}

function MetricCard({ metric }: { metric: AdminKpiMetric | undefined }) {
  if (!metric) return null;
  return (
    <article className={k.metricCard}>
      <div className={k.metricTop}>
        <span>{metric.label}</span>
        <span className={`${k.status} ${k[`status_${metric.dataStatus}`] ?? ''}`}>
          {metric.dataStatus}
        </span>
      </div>
      <strong>{formatNumber(metric.numericValue, metric.unit)}</strong>
      <small>
        {metric.metricKey} · {metric.aggregation} · v{metric.version}
      </small>
    </article>
  );
}

function RunCard({
  run,
  current,
}: {
  run: AdminKpiRun;
  current: boolean;
}) {
  return (
    <article className={`${k.runCard} ${current ? k.runCurrent : ''}`}>
      <div className={k.runTitle}>
        <div>
          <strong>{run.source}</strong>
          <span>{friendly(run.mode)} · {current ? 'Current source state' : 'Historical run'}</span>
        </div>
        <span className={`${k.status} ${k[`status_${run.status}`] ?? ''}`}>
          {run.status}
        </span>
      </div>
      <div className={k.runStats}>
        <span>{run.recordsSeen.toLocaleString()} read</span>
        <span>{run.recordsWritten.toLocaleString()} written</span>
        {run.linkedFacts !== run.recordsWritten ? (
          <span>{run.linkedFacts.toLocaleString()} facts actually linked</span>
        ) : null}
        <span>{run.unresolvedMappings} unresolved</span>
        <span>{new Date(run.startedAt).toLocaleString()}</span>
      </div>
      {run.error ? (
        <p className={current ? k.currentError : k.historicalError}>{run.error}</p>
      ) : null}
    </article>
  );
}

export function KpiData() {
  const [view, setView] = useState<View>('overview');
  const [overview, setOverview] = useState<AdminKpiOverview | null>(null);
  const [workers, setWorkers] = useState<AdminKpiWorker[]>([]);
  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [days, setDays] = useState<AdminKpiDay[]>([]);
  const [snapshots, setSnapshots] = useState<AdminKpiSnapshot[]>([]);
  const [facts, setFacts] = useState<AdminKpiFact[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [factSource, setFactSource] = useState('');
  const [factMetric, setFactMetric] = useState('');
  const [factWorkerId, setFactWorkerId] = useState('');
  const [factUseRange, setFactUseRange] = useState(false);
  const [factSearch, setFactSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [workerLoading, setWorkerLoading] = useState(false);
  const [factsLoading, setFactsLoading] = useState(false);
  const [overviewError, setOverviewError] = useState('');
  const [workerError, setWorkerError] = useState('');
  const [factsError, setFactsError] = useState('');
  const loadSeq = useRef(0);
  // One sequence token per loader, never shared: a Refresh/Apply must not invalidate an
  // in-flight worker or facts fetch, and the two detail loaders can be in flight together
  // because switching view does not cancel the request the previous view started.
  const detailSeq = useRef(0);
  const factsSeq = useRef(0);

  const load = useCallback(async (range?: { from: string; to: string }) => {
    const seq = (loadSeq.current += 1);
    setLoading(true);
    setOverviewError('');
    try {
      const [nextOverview, nextWorkers] = await Promise.all([
        getAdminKpiOverview(range),
        listAdminKpiWorkers(),
      ]);
      if (seq !== loadSeq.current) return;
      setOverview(nextOverview);
      setWorkers(nextWorkers);
      setFrom(nextOverview.range.from);
      setTo(nextOverview.range.to);
      setSelectedWorkerId((current) => current || nextWorkers.find((w) => w.eligible)?.id || '');
    } catch (caught) {
      if (seq === loadSeq.current) {
        setOverviewError(caught instanceof Error ? caught.message : 'KPI data could not be loaded.');
      }
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadWorker = useCallback(async (workerId: string) => {
    // The bump sits after the guard on purpose: a no-op call must not invalidate the
    // response already in flight for the still-selected worker.
    if (!workerId || !from || !to) return;
    const seq = (detailSeq.current += 1);
    setWorkerLoading(true);
    setWorkerError('');
    try {
      const [nextDays, nextSnapshots] = await Promise.all([
        listAdminKpiDays(workerId, from, to),
        listAdminKpiSnapshots(workerId),
      ]);
      if (seq !== detailSeq.current) return;
      setDays(nextDays);
      setSnapshots(nextSnapshots);
    } catch (caught) {
      if (seq === detailSeq.current) {
        setWorkerError(caught instanceof Error ? caught.message : 'Worker KPI history could not be loaded.');
      }
    } finally {
      if (seq === detailSeq.current) setWorkerLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    if (view === 'workers' && selectedWorkerId) void loadWorker(selectedWorkerId);
  }, [loadWorker, selectedWorkerId, view]);

  // Keyed on the identity only, not on `from`/`to`: the panel header switches to the new
  // worker at once, so the previous worker's rollups and finalized revisions must go with
  // it — but a date keystroke must not blank the panel it is refining.
  useEffect(() => {
    setDays([]);
    setSnapshots([]);
  }, [selectedWorkerId]);

  const loadFacts = useCallback(async () => {
    const seq = (factsSeq.current += 1);
    setFactsLoading(true);
    setFactsError('');
    try {
      const nextFacts = await listAdminKpiFacts({
        ...(factSource ? { source: factSource } : {}),
        ...(factMetric ? { metricKey: factMetric } : {}),
        ...(factWorkerId ? { workerId: factWorkerId } : {}),
        ...(factUseRange && from ? { from } : {}),
        ...(factUseRange && to ? { to } : {}),
        limit: 200,
      });
      if (seq !== factsSeq.current) return;
      setFacts(nextFacts);
    } catch (caught) {
      if (seq === factsSeq.current) {
        setFactsError(caught instanceof Error ? caught.message : 'Raw KPI facts could not be loaded.');
      }
    } finally {
      if (seq === factsSeq.current) setFactsLoading(false);
    }
  }, [factMetric, factSource, factUseRange, factWorkerId, from, to]);

  useEffect(() => {
    if (view === 'facts') void loadFacts();
  }, [loadFacts, view]);

  const currentRuns = useMemo(
    () => latestRuns(overview?.ingestionRuns ?? []),
    [overview?.ingestionRuns],
  );
  const currentRunIds = useMemo(
    () => new Set(currentRuns.map((run) => run.id)),
    [currentRuns],
  );
  const eligibleWorkers = workers.filter((worker) => worker.eligible);
  const selectedWorker = workers.find((worker) => worker.id === selectedWorkerId);
  const sources = Array.from(
    new Set((overview?.ingestionRuns ?? []).map((run) => run.source)),
  ).sort();
  const visibleFacts = facts.filter((fact) => {
    const query = factSearch.trim().toLocaleLowerCase();
    if (!query) return true;
    return [
      fact.workerName,
      fact.source,
      fact.sourceKey,
      fact.metricKey,
    ].some((value) => value?.toLocaleLowerCase().includes(query));
  });

  return (
    <div className={`${s.panel} ${s.panelWide}`}>
      <div className={s.head}>
        <div>
          <div className={s.eyebrow}>Sales KPI administration</div>
          <h2 className={s.h2}>Collection & data</h2>
          <p className={s.sub}>
            Auditable collection health, metric values, worker history and raw source facts.
            Ratings are not calculated in this phase.
          </p>
        </div>
        <button
          type="button"
          className={s.ghostBtn}
          onClick={() => void load(from && to ? { from, to } : undefined)}
          disabled={loading}
        >
          <RefreshCw size={13} /> {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <div className={k.toolbar}>
        <nav className={k.tabs} aria-label="KPI Admin sections">
          {VIEWS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={view === item.id}
                onClick={() => setView(item.id)}
              >
                <Icon size={14} /> {item.label}
              </button>
            );
          })}
        </nav>
        <div className={k.range}>
          <label>From <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label>To <input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
          <button type="button" onClick={() => void load({ from, to })}>Apply</button>
        </div>
      </div>

      {overviewError ? <p className={s.errorNote} role="alert">{overviewError}</p> : null}
      {!overview && loading ? <div className={k.empty}>Loading KPI administration…</div> : null}

      {overview && view === 'overview' ? (
        <>
          <div className={k.summaryGrid}>
            <article><span>Eligible workers</span><strong>{eligibleWorkers.length}</strong><small>{workers.length} directory identities</small></article>
            <article><span>External facts</span><strong>{(overview.tables.find((t) => t.name === 'kpi_external_facts')?.rowCount ?? 0).toLocaleString()}</strong><small>All immutable revisions</small></article>
            <article><span>Daily rollups</span><strong>{(overview.tables.find((t) => t.name === 'kpi_daily_rollups')?.rowCount ?? 0).toLocaleString()}</strong><small>{overview.range.availableFrom ?? '—'} → {overview.range.availableTo ?? '—'}</small></article>
            <article><span>Collection flag</span><strong className={overview.enabled ? k.goodText : k.warningText}>{overview.enabled ? 'Enabled' : 'Disabled'}</strong><small>{overview.reportingTimezone}</small></article>
          </div>
          <section className={k.section}>
            <div className={k.sectionHead}><div><h3>Current source health</h3><p>Only the newest run for each source. Older failures are shown in Run history.</p></div></div>
            <div className={k.runList}>{currentRuns.map((run) => <RunCard key={run.id} run={run} current />)}</div>
          </section>
          {(overview.unresolvedWorkerMappings.length > 0) ? (
            <section className={`${k.section} ${k.warningSection}`}>
              <div className={k.sectionHead}><div><h3><AlertTriangle size={16} /> Unresolved worker mappings</h3><p>These require an explicit DWH/Zoho identity correction. No name was guessed.</p></div></div>
              <div className={k.mappingList}>
                {overview.unresolvedWorkerMappings.map((mapping) => (
                  <div key={mapping.id}>
                    <strong>{mapping.observedLabel ?? mapping.sourceKey}</strong>
                    <span>{mapping.source} · {friendly(mapping.reason)} · seen {mapping.occurrenceCount}×</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          <section className={k.section}>
            <div className={k.sectionHead}><div><h3>Collected totals</h3><p>{overview.range.from} → {overview.range.to}; status is preserved per metric.</p></div></div>
            <div className={k.metricGrid}>
              {['calls_zoho', 'applications', 'card_swipes', 'online_active_seconds', 'tasks_completed', 'deal_open_clicks'].map((key) => (
                <MetricCard key={key} metric={metricByKey(overview.metrics, key)} />
              ))}
            </div>
          </section>
        </>
      ) : null}

      {overview && view === 'metrics' ? (
        <section className={k.section}>
          <div className={k.sectionHead}><div><h3>Metric catalog & totals</h3><p>All {overview.metrics.length} active definitions. Percentages use stored numerators and denominators.</p></div></div>
          <div className={k.tableWrap}><table><thead><tr><th>Metric</th><th>Value</th><th>Status</th><th>Unit</th><th>Rule</th><th>Version</th></tr></thead>
            <tbody>{overview.metrics.map((metric) => <tr key={metric.metricKey}><td><strong>{metric.label}</strong><small>{metric.metricKey}</small></td><td>{formatNumber(metric.numericValue, metric.unit)}{metric.denominator !== null ? <small>{metric.numerator ?? 0} / {metric.denominator}</small> : null}</td><td><span className={`${k.status} ${k[`status_${metric.dataStatus}`] ?? ''}`}>{metric.dataStatus}</span></td><td>{metric.unit}</td><td>{metric.aggregation}</td><td>v{metric.version}</td></tr>)}</tbody>
          </table></div>
        </section>
      ) : null}

      {view === 'workers' ? (
        <div className={k.workerLayout}>
          <aside className={k.workerList}>
            <h3>Workers</h3>
            {workers.map((worker) => <button key={worker.id} type="button" aria-pressed={selectedWorkerId === worker.id} onClick={() => setSelectedWorkerId(worker.id)}><strong>{worker.displayName ?? worker.zohoUserId}</strong><span>{worker.currentProfileName ?? 'No profile'} · {worker.eligible ? 'eligible' : 'not eligible'}</span></button>)}
          </aside>
          <section className={k.section}>
            <div className={k.sectionHead}><div><h3>{selectedWorker?.displayName ?? 'Select a worker'}</h3><p>{selectedWorker?.zohoUserId} · daily values and immutable monthly revisions</p></div></div>
            {workerError ? <p className={s.errorNote} role="alert">{workerError}</p> : null}
            {workerLoading ? <div className={k.empty}>Loading worker history…</div> : null}
            {!workerLoading && days.length === 0 ? <div className={k.empty}>No daily rollups in this range.</div> : null}
            {!workerLoading && days.map((day) => <div className={k.dayBlock} key={day.id}><div className={k.dayHead}><strong>{day.reportingDate}</strong><span>calculation v{day.calculationVersion} · {new Date(day.computedAt).toLocaleString()}</span></div><div className={k.compactMetrics}>{day.values.map((value) => <div key={`${value.metricKey}:${value.metricVersion}`}><span>{friendly(value.metricKey)}</span><strong>{value.numericValue ?? '—'}</strong><small>{value.dataStatus}</small></div>)}</div></div>)}
            <div className={k.snapshotHead}>Monthly snapshot revisions</div>
            {!workerLoading && snapshots.length === 0 ? <div className={k.empty}>No month has closed yet.</div> : null}
            {!workerLoading && snapshots.map((snapshot) => <div className={k.snapshot} key={snapshot.id}><strong>{snapshot.periodStart} · revision {snapshot.revision}</strong><span>{snapshot.workerProfileName ?? 'No profile'} · finalized {new Date(snapshot.finalizedAt).toLocaleString()}</span></div>)}
          </section>
        </div>
      ) : null}

      {overview && view === 'facts' ? (
        <section className={k.section}>
          <div className={k.filters}>
            <label>Source<select value={factSource} onChange={(event) => setFactSource(event.target.value)}><option value="">All sources</option>{sources.map((source) => <option key={source} value={source}>{source}</option>)}</select></label>
            <label>Metric<select value={factMetric} onChange={(event) => setFactMetric(event.target.value)}><option value="">All metrics</option>{overview.metrics.map((metric) => <option key={metric.metricKey} value={metric.metricKey}>{metric.label}</option>)}</select></label>
            <label>Worker<select value={factWorkerId} onChange={(event) => setFactWorkerId(event.target.value)}><option value="">All workers</option>{workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.displayName ?? worker.zohoUserId}</option>)}</select></label>
            <label><input type="checkbox" checked={factUseRange} onChange={(event) => setFactUseRange(event.target.checked)} /> Limit to selected date range</label>
            <button type="button" onClick={() => void loadFacts()}><Search size={13} /> Load facts</button>
          </div>
          <div className={k.factSearch}><Search size={14} /><input placeholder="Filter loaded facts…" value={factSearch} onChange={(event) => setFactSearch(event.target.value)} /></div>
          {factsError ? <p className={s.errorNote} role="alert">{factsError}</p> : null}
          {factsLoading ? <div className={k.empty}>Loading facts…</div>
            : facts.length === 0 ? <div className={k.empty}>No facts for these filters.</div>
            : visibleFacts.length === 0 ? <div className={k.empty}>No loaded fact matches “{factSearch}”.</div>
            : <div className={k.tableWrap}><table><thead><tr><th>Observed</th><th>Worker</th><th>Source</th><th>Metric</th><th>Value</th><th>Revision</th><th>Source key</th></tr></thead><tbody>{visibleFacts.map((fact) => <tr key={fact.id}><td>{new Date(fact.observedAt).toLocaleString()}<small>{fact.reportingDate}</small></td><td>{fact.workerName ?? fact.workerId}</td><td>{fact.source}</td><td>{fact.metricKey}<small>{fact.dataStatus}</small></td><td>{fact.numericValue}</td><td>v{fact.revision}</td><td className={k.mono}>{fact.sourceKey}</td></tr>)}</tbody></table></div>}
        </section>
      ) : null}

      {overview && view === 'runs' ? (
        <section className={k.section}>
          <div className={k.sectionHead}><div><h3>Complete ingestion history</h3><p>Failed attempts remain visible for audit. “Historical” means a newer run exists for that source.</p></div></div>
          <div className={k.runList}>{overview.ingestionRuns.map((run) => <RunCard key={run.id} run={run} current={currentRunIds.has(run.id)} />)}</div>
        </section>
      ) : null}

      {overview && view === 'tables' ? (
        <section className={k.section}>
          <div className={k.sectionHead}><div><h3>PostgreSQL data model</h3><p>17 tables created for the KPI foundation plus one existing call table enhanced for reliable collection.</p></div></div>
          <div className={k.tableCards}>{overview.tables.map((table) => <article key={table.name}><div><strong>{table.name}</strong><span>{table.group} · {table.createdForKpi ? 'created' : 'enhanced existing table'}</span></div><b>{table.rowCount.toLocaleString()} rows</b><p>{table.purpose}</p></article>)}</div>
        </section>
      ) : null}
    </div>
  );
}
