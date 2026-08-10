/**
 * Sales Management → KPI.
 *
 * Every sales agent with this cycle's headline numbers: card swipes, gallons, app fills. The
 * Sales Mytrion's Home tab shows the same three for the ONE agent looking at it; this is the
 * manager's cross-agent read of them, and it comes from two grouped DWH queries rather than a
 * per-agent fan-out (~816ms for all agents, vs ~65 sequential vendor calls).
 *
 * Sorting is client-side because the whole board is one payload — there is no page to re-fetch.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, TriangleAlert } from 'lucide-react';
import { DataTable, type DataColumn } from '@/ds';
import { getSalesKpiBoard, type SalesAgentKpi, type SalesKpiBoard } from '../../../api/managerKpi';
import { SalesKpiSkeleton } from './SalesKpiSkeleton';
import './salesKpi.css';

type NumericSortKey = 'gallons' | 'swipes' | 'appFills' | 'clients';
type SortKey = NumericSortKey | 'agent';

/** Narrowed accessor: 'agent' sorts by name and has no bar, so it never reaches here. */
const metric = (row: SalesAgentKpi, key: SortKey): number =>
  key === 'agent' ? 0 : row[key];

const COLUMNS: Array<{ key: SortKey; label: string; numeric: boolean; hint?: string }> = [
  { key: 'agent', label: 'Agent', numeric: false },
  { key: 'clients', label: 'Clients', numeric: true, hint: 'Carriers owned in the warehouse' },
  { key: 'swipes', label: 'Card swipes', numeric: true, hint: 'Fuel transactions this cycle' },
  { key: 'gallons', label: 'Gallons', numeric: true, hint: 'Fuel volume this cycle' },
  { key: 'appFills', label: 'App fills', numeric: true, hint: 'Deals with an application this cycle' },
];

const n0 = (v: number): string => Math.round(v).toLocaleString('en-US');
const n1 = (v: number): string => v.toLocaleString('en-US', { maximumFractionDigits: 0 });

function cycleLabel(iso: string): string {
  const start = new Date(iso);
  if (Number.isNaN(start.getTime())) return 'current cycle';
  const fmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  return `${fmt.format(start)} – today`;
}

export function SalesKpiBlock() {
  const [board, setBoard] = useState<SalesKpiBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('gallons');

  const load = useCallback(async (mode: 'cold' | 'refresh' = 'cold') => {
    if (mode === 'cold') setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      setBoard(await getSalesKpiBoard());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The KPI board could not be loaded.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load('cold');
  }, [load]);

  const rows = useMemo<SalesAgentKpi[]>(() => {
    const needle = query.trim().toLowerCase();
    const filtered = (board?.agents ?? []).filter(
      (a) => !needle || a.agent.toLowerCase().includes(needle),
    );
    return [...filtered].sort((a, b) =>
      sort === 'agent' ? a.agent.localeCompare(b.agent) : metric(b, sort) - metric(a, sort),
    );
  }, [board, query, sort]);

  /** The busiest agent on the ACTIVE sort — what the bar in each row is measured against. */
  const peak = useMemo(
    () => (sort === 'agent' ? 0 : Math.max(0, ...rows.map((r) => metric(r, sort)))),
    [rows, sort],
  );

  /**
   * MOBILE ROLES — the agent names the row, and THE ONE VALUE IS WHATEVER THE BOARD IS SORTED BY.
   * That is the point of a leaderboard: you sorted by gallons because gallons is the question, so
   * gallons is the number the card should carry. The other three metrics open with the record.
   */
  const columns = useMemo<DataColumn<SalesAgentKpi>[]>(
    () =>
      COLUMNS.map((c) => ({
        id: c.key,
        header: c.hint ? <span title={c.hint}>{c.label}</span> : c.label,
        sortable: true,
        numeric: c.numeric,
        ...(c.numeric ? { align: 'end' as const } : {}),
        ...(c.key === 'agent'
          ? {
              rowHeader: true,
              mobile: 'primary' as const,
              cell: (row: SalesAgentKpi) => (
                <>
                  <span className="mg-kpi-agent">
                    {row.agent}
                    {!row.inWarehouse ? (
                      <span
                        className="mg-kpi-flag"
                        title="Fills applications but owns no carrier in the warehouse — a lead-gen or new agent. The fuel figures are structurally zero, not a bad cycle."
                      >
                        <TriangleAlert size={11} aria-hidden /> no book
                      </span>
                    ) : null}
                  </span>
                  {/* A bar against the leader on the ACTIVE sort — rank is legible without reading
                      five columns of digits. */}
                  {peak > 0 ? (
                    <span className="mg-kpi-bar" aria-hidden="true">
                      <span style={{ width: `${Math.max(2, (metric(row, sort) / peak) * 100)}%` }} />
                    </span>
                  ) : null}
                </>
              ),
              // The card's primary line is one line; the bar and the flag belong to the table.
              mobileCell: (row: SalesAgentKpi) => row.agent,
            }
          : {
              mobile: (c.key === sort ? 'value' : 'hidden') as 'value' | 'hidden',
              cell: (row: SalesAgentKpi) =>
                c.key === 'gallons' ? n1(metric(row, c.key)) : n0(metric(row, c.key)),
            }),
      })),
    [peak, sort],
  );

  const totals = board?.totals;

  return (
    <section className="mg-block mg-kpi" aria-label="Sales agent KPIs">
      <header className="mg-block-head">
        <div>
          <p className="mg-block-kicker">Workspace block</p>
          <h2 className="mg-block-title">KPI</h2>
          <p className="mg-block-sub">
            Card swipes, gallons and app fills per agent for the current billing cycle
            {board ? ` (${cycleLabel(board.cycleStart)})` : ''}. The same three figures each agent
            sees on their own Sales home.
          </p>
        </div>
        <button
          type="button"
          className="mg-btn"
          onClick={() => void load('refresh')}
          disabled={loading || refreshing}
        >
          <RefreshCw size={15} className={refreshing ? 'mg-spin' : ''} />
          Refresh
        </button>
      </header>

      <div className="mg-tk-metrics">
        <div>
          <span>Agents</span>
          <strong>{board ? n0(board.agents.length) : '—'}</strong>
          <em>With clients in the warehouse</em>
        </div>
        <div>
          <span>Card swipes</span>
          <strong>{totals ? n0(totals.swipes) : '—'}</strong>
          <em>All agents, this cycle</em>
        </div>
        <div>
          <span>Gallons</span>
          <strong>{totals ? n1(totals.gallons) : '—'}</strong>
          <em>All agents, this cycle</em>
        </div>
        <div>
          <span>App fills</span>
          <strong>{totals ? n0(totals.appFills) : '—'}</strong>
          <em>Applications this cycle</em>
        </div>
      </div>

      <div className="mg-tk-filters">
        <label className="mg-search">
          <Search size={15} />
          <input
            type="search"
            value={query}
            placeholder="Find an agent…"
            aria-label="Search agents"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <span className="mg-tk-result-count" aria-live="polite">
          {refreshing ? 'Updating…' : `${n0(rows.length)} ${rows.length === 1 ? 'agent' : 'agents'}`}
        </span>
      </div>

      {loading ? <SalesKpiSkeleton /> : null}

      {!loading && error ? (
        <div className="mg-error">
          <p>{error}</p>
          <button type="button" className="mg-btn" onClick={() => void load('cold')}>
            Retry
          </button>
        </div>
      ) : null}

      {!loading && !error && rows.length === 0 ? (
        <div className="mg-empty">No agents match this search.</div>
      ) : null}

      {!loading && !error && rows.length > 0 ? (
        <DataTable
          caption="Sales agents this cycle"
          rows={rows}
          rowKey={(row) => row.agent}
          columns={columns}
          className="mg-efs-table mg-kpi-table"
          scrollerClassName="mg-efs-tablewrap"
          sort={{
            by: sort,
            // One direction only: every metric here is "more is better", so the sort is a ranking
            // and flipping it would just show the bottom of the board.
            direction: 'descending',
            onSort: (columnId) => setSort(columnId as SortKey),
          }}
        />
      ) : null}
    </section>
  );
}
