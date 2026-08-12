import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DbSchemaSnapshot, DbTable } from '../../api/schema';
import { AlertIcon, SearchIcon } from '../../components/icons';
import s from './admin.module.css';
import x from './SchemaBrowser.module.css';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** Table-header grid: name | type | rows | write frequency | last updated | columns. */
/*
 * Six and seven `fr` tracks. An `fr` floors at min-content, so these grids are as wide as the sum
 * of their unbreakable contents (table names, row counts, types) and clip inside `.panel`, which
 * does not scroll. `minmax(0, …fr)` lets each track collapse so the row fits and its cells
 * truncate — the alternative was a horizontal scroller the panel has no room for.
 */
const TABLE_COLS = {
  gridTemplateColumns:
    'minmax(0, 1.8fr) minmax(0, 0.65fr) minmax(0, 0.75fr) minmax(0, 1.25fr) minmax(0, 0.95fr) minmax(0, 0.55fr)',
} as const;
/** Column-row grid: name | type | null | key | default | comment. */
const COL_COLS = {
  gridTemplateColumns:
    'minmax(0, 1.4fr) minmax(0, 1.7fr) minmax(0, 0.5fr) minmax(0, 0.6fr) minmax(0, 1fr) minmax(0, 1.3fr)',
} as const;

type KindFilter = 'all' | 'tables' | 'views';

interface Activity {
  label: string;
  tone: string;
  detail?: string;
}

export interface SchemaBrowserProps {
  title: string;
  subtitle: string;
  /** Fetches the snapshot; identity should be stable (defined at module scope or memoized). */
  load: () => Promise<DbSchemaSnapshot>;
  /** Shown while the initial snapshot is loading. */
  loadingMessage?: string;
  /**
   * What to DO when the load fails. A schema browser fails for operational reasons (tunnel down,
   * replica unreachable) far more often than for code reasons, so the error state names the fix
   * rather than only echoing the exception.
   */
  errorHint?: string;
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

function compactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  if (value >= 10) return value.toFixed(0);
  if (value >= 1) return value.toFixed(1);
  return value.toFixed(2);
}

function tableActivity(t: DbTable): Activity {
  const writes = t.writeActivity;
  if (!writes) return activityOf(t.updateTime);
  const tone =
    writes.totalWrites > 0
      ? s.pillGood ?? ''
      : writes.frequency === 'Unknown'
        ? s.pillWarn ?? ''
        : s.pillNeutral ?? '';
  const rate = writes.writesPerDay == null ? null : `${compactNumber(writes.writesPerDay)}/day`;
  const reset = writes.statsResetAt ? new Date(writes.statsResetAt).toLocaleString() : 'unknown';
  return {
    label: rate && writes.totalWrites > 0 ? `${writes.frequency} · ${rate}` : writes.frequency,
    tone,
    detail:
      `${writes.totalWrites.toLocaleString()} writes since stats reset (${reset}): ` +
      `${writes.inserts.toLocaleString()} inserts, ${writes.updates.toLocaleString()} updates, ` +
      `${writes.deletes.toLocaleString()} deletes.`,
  };
}

function isActive(t: DbTable): boolean {
  return (t.writeActivity?.totalWrites ?? 0) > 0 || activityOf(t.updateTime).label === 'Live';
}

/**
 * A matview is a view for filtering purposes. Testing `type === 'VIEW'` exactly put every relation
 * the row already labels "Matview" under the Tables chip and left it out of the Views count.
 */
function isViewLike(t: DbTable): boolean {
  return t.type === 'VIEW' || t.type === 'MATERIALIZED VIEW';
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
export function SchemaBrowser({ title, subtitle, load, loadingMessage = 'Loading schema…', errorHint, headerIcon }: SchemaBrowserProps) {
  const [snap, setSnap] = useState<DbSchemaSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [schemaFilter, setSchemaFilter] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /**
   * Explicit per-row disclosure decisions, which outrank the "a column matched the search" default.
   * Without them a click on an auto-expanded row could never close it: the derived rule is ORed in,
   * so it re-opened whatever `expanded` had just dropped.
   */
  const [override, setOverride] = useState<Map<string, boolean>>(new Map());

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
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.type.toLowerCase().includes(q) ||
          c.dataType.toLowerCase().includes(q) ||
          c.comment.toLowerCase().includes(q),
      ).length;
    },
    [q],
  );

  const visible = useMemo(() => {
    const tables = snap?.tables ?? [];
    return tables.filter((t) => {
      if (schemaFilter && t.schema !== schemaFilter) return false;
      if (kind === 'tables' && isViewLike(t)) return false;
      if (kind === 'views' && !isViewLike(t)) return false;
      if (activeOnly && !isActive(t)) return false;
      if (!q) return true;
      const tableMetadata = [
        tableKey(t),
        t.type,
        t.comment,
        t.writeActivity?.frequency ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return tableMetadata.includes(q) || columnMatches(t) > 0;
    });
  }, [snap, schemaFilter, kind, activeOnly, q, columnMatches]);

  const liveCount = useMemo(
    () => (snap?.tables ?? []).filter(isActive).length,
    [snap],
  );
  const viewCount = useMemo(
    () => (snap?.tables ?? []).filter(isViewLike).length,
    [snap],
  );

  // A new query re-derives which rows auto-open, so decisions taken against the previous one go.
  useEffect(() => {
    setOverride((prev) => (prev.size === 0 ? prev : new Map()));
  }, [q]);

  const isOpen = useCallback(
    (t: DbTable): boolean => {
      const key = tableKey(t);
      const auto = q !== '' && columnMatches(t) > 0 && !key.toLowerCase().includes(q);
      return override.get(key) ?? (expanded.has(key) || auto);
    },
    [q, columnMatches, override, expanded],
  );

  const toggle = (key: string, open: boolean) => {
    setOverride((prev) => new Map(prev).set(key, !open));
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const allOpen = visible.length > 0 && visible.every(isOpen);
  const toggleAll = () => {
    const keys = visible.map(tableKey);
    setOverride((prev) => {
      const next = new Map(prev);
      for (const key of keys) next.set(key, !allOpen);
      return next;
    });
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const key of keys) {
        if (allOpen) next.delete(key);
        else next.add(key);
      }
      return next;
    });
  };

  return (
    <div className={`${s.panel} ${s.panelWide}`}>
      <div className={s.head}>
        <div>
          <div className={s.eyebrow}>Read-only schema</div>
          <h2 className={s.h2}>{title}</h2>
          {/* `subtitle` was accepted as a prop and never rendered, so every wrapper's explanation
              ("structure only; no row data is ever read") was silently dropped. */}
          <p className={s.sub}>{subtitle}</p>
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
            <span className={s.statLabel}>Tables with activity</span>
          </div>
          <div className={s.statTile}>
            <span className={s.statNum}>{viewCount}</span>
            <span className={s.statLabel}>Views &amp; matviews</span>
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
          {/* `.filterChipOn` is a gradient and nothing else, so which filter is applied has to be
              announced too — aria-pressed, not radios, since there is no roving-tabindex here. */}
          <div className={x.filterGroup} role="group" aria-label="Filter relations">
            {(['all', 'tables', 'views'] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={`${s.filterChip} ${kind === k ? s.filterChipOn : ''}`}
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
              >
                {k === 'all' ? 'All' : k === 'tables' ? 'Tables' : 'Views'}
              </button>
            ))}
            <button
              type="button"
              className={`${s.filterChip} ${activeOnly ? s.filterChipOn : ''}`}
              aria-pressed={activeOnly}
              onClick={() => setActiveOnly((v) => !v)}
            >
              Has activity
            </button>
          </div>
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

      {/* A failed REFRESH keeps the last good snapshot on screen and says so quietly. */}
      {error && snap && (
        <p className={s.errorNote} role="alert">
          Could not refresh — showing the last loaded snapshot. {error}
        </p>
      )}

      {/* A failed INITIAL load has nothing to show, so it takes over the surface and names the fix. */}
      {error && !snap ? (
        <div className={s.errorState} role="alert">
          <span className={s.errorIcon} aria-hidden="true">
            <AlertIcon size={20} />
          </span>
          <div className={s.errorTitle}>Could not reach {title}</div>
          <p className={s.errorCause}>{error}</p>
          {errorHint ? <p className={s.errorHint}>{errorHint}</p> : null}
          <div className={s.errorActions}>
            <button type="button" className={s.primaryBtn} disabled={loading} onClick={() => void refresh()}>
              {loading ? 'Retrying…' : 'Try again'}
            </button>
          </div>
        </div>
      ) : (
      <div className={s.table} data-table-scroller>
        <div className={s.tHead} style={TABLE_COLS}>
          <span>Table</span>
          <span>Type</span>
          <span>Rows (approx)</span>
          <span>Write frequency</span>
          <span>Last updated</span>
          <span className={s.right}>Columns</span>
        </div>

        {visible.map((t) => {
          const tkey = tableKey(t);
          const matched = columnMatches(t);
          const open = isOpen(t);
          const act = tableActivity(t);
          return (
            <div key={tkey} className={x.schemaItem}>
              <button
                type="button"
                className={`${s.tRow} ${s.tRowClick}`}
                style={TABLE_COLS}
                onClick={() => toggle(tkey, open)}
                aria-expanded={open}
              >
                <span className={s.docCell}>
                  <span className={`${x.chevron} ${open ? x.chevronOpen : ''}`}>▸</span>
                  {t.schema && <span className={x.schemaBadge}>{t.schema}</span>}
                  {/* The name is the only shrinkable track in this cell, so a long relation is
                      routinely ellipsized — the qualified key in `title` is how it stays readable. */}
                  <span className={s.docTitle} title={tkey}>
                    {t.name}
                  </span>
                  {matched > 0 && <span className={x.matchHint}>{matched} col match</span>}
                </span>
                <span className={s.deptText}>
                  {t.type === 'VIEW' ? 'View' : t.type === 'MATERIALIZED VIEW' ? 'Matview' : 'Table'}
                </span>
                <span className={s.mono}>{rowsLabel(t.approxRows)}</span>
                <span title={act.detail}>
                  <span className={`${s.pill} ${act.tone} ${x.frequencyPill}`}>
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
                    <span>Column / API name</span>
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
                        <span className={x.typeMono} title={c.type}>
                          {c.type}
                        </span>
                        <span className={c.nullable ? x.nullYes : s.deptText}>
                          {c.nullable ? 'NULL' : 'NOT NULL'}
                        </span>
                        <span>
                          {kt && <span className={`${x.keyTag} ${kt.tone}`}>{kt.text}</span>}
                          {c.extra.includes('auto_increment') && (
                            <span className={s.deptText} title="auto_increment"> ai</span>
                          )}
                        </span>
                        <span className={x.colDefault} title={c.default ?? ''}>
                          {c.default ?? '—'}
                        </span>
                        <span className={x.colComment} title={c.comment}>
                          {c.comment || '—'}
                        </span>
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
          <div className={s.none}>
            <span className={s.emptyIcon} aria-hidden="true">
              <SearchIcon size={18} />
            </span>
            <div className={s.emptyTitle}>No tables match</div>
            <p className={s.emptyBody}>Nothing in this schema matches the current search or filters.</p>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
