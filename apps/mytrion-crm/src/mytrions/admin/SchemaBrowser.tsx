import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DbSchemaSnapshot, DbTable } from '../../api/schema';
import { SearchIcon } from '../../components/icons';
import s from './admin.module.css';
import x from './SchemaBrowser.module.css';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** Table-header grid: name | type | rows | activity | last updated | columns. */
const TABLE_COLS = { gridTemplateColumns: '2fr 0.7fr 0.9fr 0.8fr 1.2fr 0.7fr' } as const;
/** Column-row grid: name | type | null | key | default | comment. */
const COL_COLS = { gridTemplateColumns: '1.4fr 1.7fr 0.5fr 0.6fr 1fr 1.3fr' } as const;

type KindFilter = 'all' | 'tables' | 'views';

interface Activity {
  label: string;
  tone: string;
}

export interface SchemaBrowserProps {
  title: string;
  subtitle: string;
  /** Fetches the snapshot; identity should be stable (defined at module scope or memoized). */
  load: () => Promise<DbSchemaSnapshot>;
  /** Shown while the initial snapshot is loading. */
  loadingMessage?: string;
  /** Icon shown in the header database badge, e.g. the engine's glyph. */
  headerIcon?: ReactNode;
}

/** Freshness bucket for a table's last-write time — the "actively updated or not" signal. */
function activityOf(iso: string | null): Activity {
  if (!iso) return { label: 'Unknown', tone: s.pillNeutral ?? '' };
  const age = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(age)) return { label: 'Unknown', tone: s.pillNeutral ?? '' };
  if (age < DAY_MS) return { label: 'Live', tone: s.pillGood ?? '' };
  if (age < WEEK_MS) return { label: 'Recent', tone: s.pillWarn ?? '' };
  return { label: 'Idle', tone: s.pillNeutral ?? '' };
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
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function rowsLabel(n: number | null): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function keyTag(key: string): { text: string; tone: string } | null {
  if (key === 'PRI') return { text: 'PK', tone: x.keyPri ?? '' };
  if (key === 'UNI') return { text: 'UQ', tone: x.keyUni ?? '' };
  if (key === 'MUL') return { text: 'FK', tone: x.keyMul ?? '' };
  return null;
}

/** Stable per-table identity — schema-qualified for multi-schema sources so names can repeat. */
function tableKey(t: DbTable): string {
  return t.schema ? `${t.schema}.${t.name}` : t.name;
}

/**
 * Mytrion Admin — a live, read-only database-schema browser. Renders either the CMP MySQL or the
 * DWH Postgres snapshot; the schema dimension (filter, per-row badge, stat tile) appears only when
 * the source reports multiple schemas.
 */
export function SchemaBrowser({ title, subtitle, load, loadingMessage = 'Loading schema…', headerIcon }: SchemaBrowserProps) {
  const [snap, setSnap] = useState<DbSchemaSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [schemaFilter, setSchemaFilter] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setSnap(await load());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const schemas = snap?.schemas ?? [];
  const multiSchema = schemas.length > 0;
  const q = query.trim().toLowerCase();

  // A table matches search if its (qualified) name matches, or any column name/type matches.
  const columnMatches = useCallback(
    (t: DbTable): number => {
      if (!q) return 0;
      return t.columns.filter(
        (c) => c.name.toLowerCase().includes(q) || c.type.toLowerCase().includes(q),
      ).length;
    },
    [q],
  );

  const visible = useMemo(() => {
    const tables = snap?.tables ?? [];
    return tables.filter((t) => {
      if (schemaFilter && t.schema !== schemaFilter) return false;
      if (kind === 'tables' && t.type === 'VIEW') return false;
      if (kind === 'views' && t.type !== 'VIEW') return false;
      if (activeOnly && activityOf(t.updateTime).label !== 'Live') return false;
      if (!q) return true;
      return tableKey(t).toLowerCase().includes(q) || columnMatches(t) > 0;
    });
  }, [snap, schemaFilter, kind, activeOnly, q, columnMatches]);

  const liveCount = useMemo(
    () => (snap?.tables ?? []).filter((t) => activityOf(t.updateTime).label === 'Live').length,
    [snap],
  );
  const viewCount = useMemo(
    () => (snap?.tables ?? []).filter((t) => t.type === 'VIEW').length,
    [snap],
  );

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const allOpen = visible.length > 0 && visible.every((t) => expanded.has(tableKey(t)));
  const toggleAll = () =>
    setExpanded(allOpen ? new Set() : new Set(visible.map((t) => tableKey(t))));

  return (
    <div className={`${s.panel} ${s.panelWide}`}>
      <div className={s.head}>
        <div>
          <h2 className={s.h2}>{title}</h2>

        </div>
        <div className={x.schemaMeta}>
          {snap && (
            <span className={x.dbBadge}>
              {headerIcon}
              {snap.database}
            </span>
          )}
          <button type="button" className={s.ghostBtn} disabled={loading} onClick={() => void refresh()}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {snap && (
        <div className={s.statGrid}>
          <div className={s.statTile}>
            <span className={s.statNum}>{snap.tableCount}</span>
            <span className={s.statLabel}>Tables &amp; views</span>
          </div>
          <div className={s.statTile}>
            <span className={s.statNum}>{snap.columnCount}</span>
            <span className={s.statLabel}>Columns</span>
          </div>
          {multiSchema && (
            <div className={s.statTile}>
              <span className={s.statNum}>{schemas.length}</span>
              <span className={s.statLabel}>Schemas</span>
            </div>
          )}
          <div className={s.statTile}>
            <span className={s.statNum}>{liveCount}</span>
            <span className={s.statLabel}>Updated &lt; 24h</span>
          </div>
          <div className={s.statTile}>
            <span className={s.statNum}>{viewCount}</span>
            <span className={s.statLabel}>Views</span>
          </div>
        </div>
      )}

      <div className={x.schemaTools}>
        <label className={s.search}>
          <SearchIcon size={14} />
          <input
            className={s.searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tables & columns…"
          />
        </label>
        <div className={s.chipRow}>
          {multiSchema && (
            <select
              className={x.schemaSelect}
              value={schemaFilter}
              onChange={(e) => setSchemaFilter(e.target.value)}
              aria-label="Filter by schema"
            >
              <option value="">All schemas</option>
              {schemas.map((sc) => (
                <option key={sc} value={sc}>
                  {sc}
                </option>
              ))}
            </select>
          )}
          {(['all', 'tables', 'views'] as const).map((k) => (
            <button
              key={k}
              type="button"
              className={`${s.filterChip} ${kind === k ? s.filterChipOn : ''}`}
              onClick={() => setKind(k)}
            >
              {k === 'all' ? 'All' : k === 'tables' ? 'Tables' : 'Views'}
            </button>
          ))}
          <button
            type="button"
            className={`${s.filterChip} ${activeOnly ? s.filterChipOn : ''}`}
            onClick={() => setActiveOnly((v) => !v)}
          >
            Active (&lt; 24h)
          </button>
          {snap && (
            <>
              <span className={s.chipMeta}>
                {visible.length} of {snap.tableCount}
              </span>
              {visible.length > 0 && (
                <button type="button" className={s.linkBtn} onClick={toggleAll}>
                  {allOpen ? 'Collapse all' : 'Expand all'}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {error && (
        <p className={s.errorNote} role="alert">
          {error}
        </p>
      )}

      <div className={s.table}>
        <div className={s.tHead} style={TABLE_COLS}>
          <span>Table</span>
          <span>Type</span>
          <span>Rows (approx)</span>
          <span>Activity</span>
          <span>Last updated</span>
          <span className={s.right}>Columns</span>
        </div>

        {visible.map((t) => {
          const tkey = tableKey(t);
          const matched = columnMatches(t);
          const open =
            expanded.has(tkey) || (q !== '' && matched > 0 && !tkey.toLowerCase().includes(q));
          const act = activityOf(t.updateTime);
          return (
            <div key={tkey} className={x.schemaItem}>
              <button
                type="button"
                className={`${s.tRow} ${s.tRowClick}`}
                style={TABLE_COLS}
                onClick={() => toggle(tkey)}
                aria-expanded={open}
              >
                <span className={s.docCell}>
                  <span className={`${x.chevron} ${open ? x.chevronOpen : ''}`}>▸</span>
                  {t.schema && <span className={x.schemaBadge}>{t.schema}</span>}
                  <span className={s.docTitle}>{t.name}</span>
                  {matched > 0 && <span className={x.matchHint}>{matched} col match</span>}
                </span>
                <span className={s.deptText}>
                  {t.type === 'VIEW' ? 'View' : t.type === 'MATERIALIZED VIEW' ? 'Matview' : 'Table'}
                </span>
                <span className={s.mono}>{rowsLabel(t.approxRows)}</span>
                <span>
                  <span className={`${s.pill} ${act.tone}`}>
                    <span className={s.dot} />
                    {act.label}
                  </span>
                </span>
                <span
                  className={s.deptText}
                  title={t.updateTime ? new Date(t.updateTime).toLocaleString() : 'unknown'}
                >
                  {relativeTime(t.updateTime)}
                </span>
                <span className={`${s.mono} ${s.right}`}>{t.columns.length}</span>
              </button>

              {open && (
                <div className={x.colWrap}>
                  <div className={x.colHead} style={COL_COLS}>
                    <span>Column</span>
                    <span>Type</span>
                    <span>Null</span>
                    <span>Key</span>
                    <span>Default</span>
                    <span>Comment</span>
                  </div>
                  {t.columns.map((c) => {
                    const kt = keyTag(c.key);
                    return (
                      <div key={c.name} className={x.colRow} style={COL_COLS}>
                        <span className={x.colName}>{c.name}</span>
                        <span className={x.typeMono}>{c.type}</span>
                        <span className={c.nullable ? x.nullYes : s.deptText}>
                          {c.nullable ? 'NULL' : 'NOT NULL'}
                        </span>
                        <span>
                          {kt && <span className={`${x.keyTag} ${kt.tone}`}>{kt.text}</span>}
                          {c.extra.includes('auto_increment') && (
                            <span className={s.deptText} title="auto_increment"> ai</span>
                          )}
                        </span>
                        <span className={s.mono}>{c.default ?? '—'}</span>
                        <span className={s.deptText}>{c.comment || '—'}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {loading && !snap && (
          <div className={s.loadingBlock} role="status">
            <span className={s.loadingSpin} aria-hidden="true" />
            {loadingMessage}
          </div>
        )}
        {!loading && snap && visible.length === 0 && (
          <div className={s.none}>No tables match the current filters.</div>
        )}
      </div>
    </div>
  );
}
