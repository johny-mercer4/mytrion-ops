/**
 * Automation Logs — its own tab, split out of the Audit Log.
 *
 * These rows answer a different question from the audit trail ("which automation ran, for whom,
 * from where" rather than "who did what to what"), they have their own columns, and at ~4.5k rows
 * they were only ever visible in the audit feed as an `automation.log` action with the interesting
 * parts buried in `detail`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TableSkeleton } from '@/components/mytrion/table-skeleton';
import {
  automationLogFacets,
  fetchAutomationLogsForExport,
  listAutomationLogs,
  AUTOMATION_ORIGIN_SOURCES,
  type AutomationLogEntry,
  type AutomationLogFacets,
  type AutomationLogFilter,
  type AutomationOriginSource,
} from '../../api/automationLogs';
import { SearchIcon } from '../../components/icons';
import { exportRowsCsv, exportRowsXlsx, type ExportColumn } from './logsExport';
import {
  ALL,
  DateField,
  ExportButton,
  FilterSelect,
  dayBoundary,
  relativeTime,
  useDebounced,
  type ExportFormat,
} from './logsShared';
import s from './admin.module.css';

const PAGE = 50;
const SKELETON = ['46%', '62%', '52%', '40%', '44%'] as const;

const EMPTY_FACETS: AutomationLogFacets = {
  automationTypes: [],
  agentNames: [],
  originSources: [],
};

/** `balance_check` → `Balance check`. The stored type is the widget's snake_case log key. */
function prettyType(raw: string): string {
  const spaced = raw.replace(/^automation\./, '').replace(/[._-]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const EXPORT_COLUMNS: ReadonlyArray<ExportColumn<AutomationLogEntry>> = [
  { header: 'When (local)', width: 22, value: (e) => new Date(e.createdAt).toLocaleString() },
  { header: 'When (ISO)', width: 26, value: (e) => e.createdAt },
  { header: 'Automation', width: 30, value: (e) => prettyType(e.automationType) },
  { header: 'Automation type (raw)', width: 30, value: (e) => e.automationType },
  { header: 'Agent', width: 26, value: (e) => e.agentName ?? '' },
  { header: 'Origin source', width: 18, value: (e) => e.originSource },
  { header: 'Trigger date', width: 14, value: (e) => e.triggerDate ?? '' },
  { header: 'Trigger time', width: 14, value: (e) => e.triggerTime ?? '' },
  { header: 'Id', width: 26, value: (e) => e.id },
];

export function AutomationLogs() {
  const [entries, setEntries] = useState<AutomationLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState<AutomationLogFacets>(EMPTY_FACETS);
  const [origin, setOrigin] = useState<string>(ALL);
  const [automationType, setAutomationType] = useState(ALL);
  const [agentName, setAgentName] = useState(ALL);
  const [fromDay, setFromDay] = useState('');
  const [toDay, setToDay] = useState('');
  const [query, setQuery] = useState('');
  const search = useDebounced(query);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [endReached, setEndReached] = useState(false);
  const [error, setError] = useState('');
  const loadSeq = useRef(0);
  const pages = useRef(0);

  const filter = useMemo<AutomationLogFilter>(() => {
    const from = dayBoundary(fromDay, 'start');
    const to = dayBoundary(toDay, 'end');
    return {
      ...(origin ? { originSource: origin as AutomationOriginSource } : {}),
      ...(automationType ? { automationType } : {}),
      ...(agentName ? { agentName } : {}),
      ...(search.trim() ? { search: search.trim() } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    };
  }, [origin, automationType, agentName, search, fromDay, toDay]);

  useEffect(() => {
    let alive = true;
    void automationLogFacets()
      .then((f) => {
        if (alive) setFacets(f);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const load = useCallback(
    async (offset: number) => {
      const seq = (loadSeq.current += 1);
      setLoading(true);
      if (offset === 0) {
        setReloading(true);
        pages.current = 0;
      }
      setError('');
      try {
        const res = await listAutomationLogs({ ...filter, limit: PAGE, offset });
        if (seq !== loadSeq.current) return;
        if (offset === 0) pages.current = 1;
        else if (res.entries.length > 0) pages.current += 1;
        setEndReached(res.entries.length < PAGE);
        // Same append-only paging contract as the Audit Log: rows written since page 1 shift the
        // `created_at DESC` window down, so dedup by id keeps one event out of the list twice.
        setEntries((prev) => {
          if (offset === 0) return res.entries;
          const seen = new Set(prev.map((e) => e.id));
          return [...prev, ...res.entries.filter((e) => !seen.has(e.id))];
        });
        setTotal(res.total);
      } catch (e) {
        if (seq === loadSeq.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (seq === loadSeq.current) {
          setLoading(false);
          setReloading(false);
        }
      }
    },
    [filter],
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  const onExport = useCallback(
    async (format: ExportFormat) => {
      const rows = await fetchAutomationLogsForExport(filter);
      const filters = [
        origin ? `Origin: ${origin}` : '',
        automationType ? `Automation: ${prettyType(automationType)}` : '',
        agentName ? `Agent: ${agentName}` : '',
        fromDay ? `From ${fromDay}` : '',
        toDay ? `To ${toDay}` : '',
        search.trim() ? `Search: "${search.trim()}"` : '',
      ].filter(Boolean);
      const meta = {
        title: 'AUTOMATION LOGS',
        subtitle: 'Mytrion Horizon · Automation runs',
        filters,
        filenameStem: 'Automation_Logs',
        sheetName: 'Automation Logs',
      };
      if (format === 'csv') await exportRowsCsv(rows, EXPORT_COLUMNS, meta);
      else await exportRowsXlsx(rows, EXPORT_COLUMNS, meta);
    },
    [filter, origin, automationType, agentName, fromDay, toDay, search],
  );

  const resetFilters = useCallback(() => {
    setOrigin(ALL);
    setAutomationType(ALL);
    setAgentName(ALL);
    setFromDay('');
    setToDay('');
    setQuery('');
  }, []);

  const narrowed = Boolean(
    origin || automationType || agentName || fromDay || toDay || query.trim(),
  );
  const showSkeleton = loading && (entries.length === 0 || reloading);

  return (
    <div className={`${s.panel} ${s.panelWide}`}>
      <div className={s.head}>
        <div>
          <div className={s.eyebrow}>Automation trail</div>
          <h2 className={s.h2}>Automation Logs</h2>
          <p className={s.sub}>
            One row per automation run, newest first — which action fired, which agent triggered it,
            and which surface it came from.
          </p>
        </div>
      </div>

      <div className={s.chipRow}>
        <button
          type="button"
          className={`${s.filterChip} ${origin === ALL ? s.filterChipOn : ''}`}
          onClick={() => setOrigin(ALL)}
        >
          All origins
        </button>
        {AUTOMATION_ORIGIN_SOURCES.map((o) => (
          <button
            key={o}
            type="button"
            className={`${s.filterChip} ${origin === o ? s.filterChipOn : ''}`}
            onClick={() => setOrigin(o)}
          >
            {o}
          </button>
        ))}
      </div>

      <div className={s.filterGrid}>
        <FilterSelect
          label="Automation"
          value={automationType}
          options={facets.automationTypes}
          allLabel="All automations"
          onChange={setAutomationType}
        />
        <FilterSelect
          label="Agent"
          value={agentName}
          options={facets.agentNames}
          allLabel="All agents"
          onChange={setAgentName}
        />
        <DateField label="From" value={fromDay} onChange={setFromDay} />
        <DateField label="To" value={toDay} onChange={setToDay} />
      </div>

      <div className={s.logToolbar}>
        <label className={s.search}>
          <SearchIcon size={14} />
          <input
            className={s.searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search automation or agent…"
          />
        </label>
        <span className={s.chipMeta}>
          {entries.length.toLocaleString()} of {total.toLocaleString()} run
          {total === 1 ? '' : 's'}
        </span>
        {narrowed && (
          <button type="button" className={s.linkBtn} onClick={resetFilters}>
            Clear filters
          </button>
        )}
        <span className={s.logToolbarSpacer} />
        <ExportButton
          onExport={onExport}
          disabled={total === 0}
          rowHint={`${total.toLocaleString()} row${total === 1 ? '' : 's'} match the current filter`}
        />
      </div>

      {error && (
        <p className={s.errorNote} role="alert">
          {error}
        </p>
      )}

      <div className={s.table} data-table-scroller aria-busy={showSkeleton}>
        <div className={`${s.tHead} ${s.tAutomation}`}>
          <span>When</span>
          <span>Automation</span>
          <span>Agent</span>
          <span>Origin</span>
          <span>Triggered</span>
        </div>
        {showSkeleton && (
          <>
            <span className={s.srOnly} role="status">
              Loading automation runs…
            </span>
            <TableSkeleton widths={SKELETON} rowClassName={s.tRow} colsClassName={s.tAutomation} />
          </>
        )}
        {!showSkeleton &&
          entries.map((e) => (
            <div key={e.id} className={`${s.tRow} ${s.tAutomation}`}>
              <span className={s.deptText} title={new Date(e.createdAt).toLocaleString()}>
                {relativeTime(e.createdAt)}
              </span>
              <span className={s.docCell}>
                <span className={s.docTitle}>{prettyType(e.automationType)}</span>
                <span className={s.cellSub}>{e.automationType}</span>
              </span>
              <span className={s.deptText}>{e.agentName ?? '—'}</span>
              <span>
                <OriginPill origin={e.originSource} />
              </span>
              <span className={s.mono}>
                {e.triggerDate || e.triggerTime
                  ? `${e.triggerDate ?? ''} ${e.triggerTime ?? ''}`.trim()
                  : '—'}
              </span>
            </div>
          ))}
        {!loading && entries.length === 0 && (
          <div className={s.none}>No automation runs match the current filters.</div>
        )}
      </div>

      {!showSkeleton && !endReached && entries.length < total && (
        <button
          type="button"
          className={s.ghostBtn}
          style={{ alignSelf: 'center' }}
          disabled={loading}
          onClick={() => void load(pages.current * PAGE)}
        >
          {loading ? (
            <>
              <span className={s.loadingSpin} aria-hidden="true" />
              Loading…
            </>
          ) : (
            `Load more (${entries.length} of ${total})`
          )}
        </button>
      )}
    </div>
  );
}

/** Horizon is the live surface; Zoho is the legacy widget (and the backfill default). */
function OriginPill({ origin }: { origin: AutomationOriginSource }) {
  const tone = origin === 'Mytrion Horizon' ? s.pillGood : s.pillNeutral;
  return (
    <span className={`${s.pill} ${tone}`}>
      <span className={s.dot} />
      {origin}
    </span>
  );
}
