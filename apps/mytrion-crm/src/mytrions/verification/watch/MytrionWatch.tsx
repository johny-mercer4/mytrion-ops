/**
 * Mytrion Watch — the watchlist for carriers already on the books.
 *
 * Sorted worst-score-first by the server, because this desk exists to answer "who needs attention
 * today", not "show me everyone". Filtering and paging both happen server-side: the book is larger
 * than one page, so filtering the page in the browser would quietly hide matches that fell past the
 * limit, and a capped list would make a partial view look complete.
 *
 * The aggregator tiles and the band bar always describe the WHOLE snapshot, never the current
 * filter — a counter that changes when you filter by it cannot be used to check your work.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus, Search, ShieldAlert } from 'lucide-react';
import { Tabs } from '@/ds';
import { useCachedLoad } from '../../_shared/swrCache';
import { WatchDetail } from './WatchDetail';
import { WatchFreshness } from './WatchFreshness';
import { WatchMissed } from './WatchMissed';
import { WatchPager } from './WatchPager';
import {
  BAND_LABEL,
  BAND_ORDER,
  BAND_SHORT,
  fmtDate,
  fmtDelta,
  fmtMoney,
  fmtMoneyShort,
  fmtScore,
} from './watchFormat';
import {
  listWatchScores,
  watchNum,
  type WatchBand,
  type WatchMovement,
  type WatchSize,
  type WatchQueueResult,
  type WatchScoreRow,
} from '@/api/mytrionWatch';
import './mytrionWatch.css';

const MOVEMENTS: ReadonlyArray<{ id: WatchMovement; label: string }> = [
  { id: 'worsened', label: 'Worsened' },
  { id: 'improved', label: 'Improved' },
];

/**
 * Carrier size, in the Loyalty program's own terms.
 *
 * `_shared/loyalty.ts` defines T1 = Owner-Operator = exactly 1 active card, and everything above
 * that is a company (T2 Small Company / T3 Fleet / Enterprise). Watch stores the raw card count and
 * groups it here rather than re-deciding what an owner-operator is — two Mytrions disagreeing about
 * that would be worse than not offering the filter.
 */
const SIZES: ReadonlyArray<{ id: WatchSize; label: string; hint: string }> = [
  { id: 'owner_operator', label: 'Owner-operator', hint: 'Runs a single fuel card' },
  { id: 'company', label: 'Carrier company', hint: 'Two or more fuel cards' },
];

const PAGE_SIZE = 50;

export function MytrionWatch() {
  const [band, setBand] = useState<WatchBand | null>(null);
  const [movement, setMovement] = useState<WatchMovement | null>(null);
  const [size, setSize] = useState<WatchSize | null>(null);
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  /**
   * Two views of the same snapshots: who to look at now, and how the book has moved.
   * A sub-view rather than a Mytrion tab — it is the same data and the same department gate.
   */
  const [view, setView] = useState<'watchlist' | 'missed'>('watchlist');

  // Typing a carrier name should not fire a query per keystroke against a 700-row snapshot.
  useEffect(() => {
    const t = setTimeout(() => setSearch(term.trim()), 300);
    return () => clearTimeout(t);
  }, [term]);

  // Narrowing the set invalidates the page number — page 9 of a 3-page result is an empty screen.
  useEffect(() => setPage(0), [band, movement, search]);

  const load = useCallback(
    () =>
      listWatchScores({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        ...(band ? { band } : {}),
        ...(movement ? { movement } : {}),
        ...(size ? { size } : {}),
        ...(search ? { search } : {}),
      }),
    [band, movement, size, search, page],
  );
  const { data, loading, error, reload } = useCachedLoad(
    `verification:watch:queue:${band ?? 'all'}:${movement ?? 'any'}:${size ?? 'any'}:${search}:${page}`,
    load,
  );

  /**
   * Hold the last payload across a filter change.
   *
   * `useCachedLoad` keys its cache on the filter, so switching Worsened -> Improved is a cache MISS:
   * `data` drops to null, `loading` goes true, and the populated list blanked to skeletons for the
   * length of one request. That is the flicker — and it is the exact thing the house rule forbids
   * ("refresh of already-visible content: keep the content and mark it stale; do not blank a
   * populated panel back to a skeleton").
   *
   * The aggregates matter even more: they describe the WHOLE snapshot and are identical for every
   * filter, so there is never a correct moment to blank them.
   */
  const lastGood = useRef<WatchQueueResult | null>(null);
  if (data) lastGood.current = data;
  const shown = data ?? lastGood.current;

  const agg = shown?.aggregates;
  const rows = useMemo(() => shown?.items ?? [], [shown]);
  const total = shown?.total ?? 0;
  const filtered = Boolean(band || movement || search);
  const run = shown?.lastRun ?? null;
  /** Showing carried-over rows while the new set loads — dimmed, not replaced. */
  const stale = loading && data === null && rows.length > 0;

  if (openId) return <WatchDetail carrierId={openId} onBack={() => setOpenId(null)} />;

  return (
    <div className="mw">
      <div className="mw-head">
        <h2 className="mw-head-title">Behavioural watchlist</h2>
        <span className="mw-head-sub">
          {shown?.scoringDate ? `Snapshot of ${fmtDate(shown.scoringDate)}` : 'No snapshot yet'}
        </span>
      </div>

      <WatchFreshness lastRun={run} onRefreshed={reload} />

      <Tabs
        size="sm"
        aria-label="Watch views"
        items={[
          { value: 'watchlist', label: 'Watchlist' },
          { value: 'missed', label: 'What it cost' },
        ]}
        value={view}
        onValueChange={(v) => setView(v as 'watchlist' | 'missed')}
      />

      {view === 'missed' ? <WatchMissed /> : null}

      {view === 'watchlist' ? (
      <>
      <div className="mw-stats">
        {loading && !agg ? (
          <StatSkeletons />
        ) : (
          <>
            <Stat label="Carriers scored" value={String(agg?.total ?? 0)} hint="fuelled in the last 31 days" />
            <Stat label="Average score" value={fmtScore(watchNum(agg?.avgScore))} hint="across the snapshot" />
            <Stat label="Worsened" value={String(agg?.worsened ?? 0)} hint="score fell since the previous run" tone="bad" />
            <Stat label="Improved" value={String(agg?.improved ?? 0)} hint="score rose since the previous run" tone="ok" />
            <Stat
              label="Exposure at risk"
              value={fmtMoneyShort(watchNum(agg?.exposureAtRisk))}
              hint="approved limit on Elevated + High"
              tone="bad"
            />
          </>
        )}
      </div>

      {agg && agg.total > 0 ? (
        <BandDistribution
          counts={{ low: agg.low, watch: agg.watch, elevated: agg.elevated, high: agg.high }}
          total={agg.total}
          active={band}
          onPick={setBand}
        />
      ) : null}

      <div className="mw-controls">
        <label className="sr-only" htmlFor="mw-search">
          Search by company or carrier id
        </label>
        <span className="mw-searchbox">
          <Search size={14} aria-hidden />
          <input
            id="mw-search"
            className="mw-search"
            type="search"
            placeholder="Search company or carrier id…"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </span>
        <div className="vf-chips" role="group" aria-label="Filter by carrier size">
          {SIZES.map((sz) => (
            <button
              key={sz.id}
              type="button"
              title={sz.hint}
              aria-pressed={size === sz.id}
              className={`vf-chip${size === sz.id ? ' is-on' : ''}`}
              onClick={() => { setSize(size === sz.id ? null : sz.id); setPage(0); }}
            >
              {sz.label}
              <span className="vf-chip-n">
                {sz.id === 'owner_operator' ? (agg?.ownerOperator ?? 0) : (agg?.company ?? 0)}
              </span>
            </button>
          ))}
        </div>
        <div className="vf-chips" role="group" aria-label="Filter by movement">
          {MOVEMENTS.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={movement === m.id}
              className={`vf-chip${movement === m.id ? ' is-on' : ''}`}
              onClick={() => setMovement(movement === m.id ? null : m.id)}
            >
              {m.label}
              <span className="vf-chip-n">{m.id === 'worsened' ? (agg?.worsened ?? 0) : (agg?.improved ?? 0)}</span>
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="mw-banner" role="alert">
          <span className="mw-banner-title">Could not load the watchlist</span>
          <p className="mw-banner-body">{String(error)}</p>
        </div>
      ) : null}

      {loading && rows.length === 0 ? (
        <RowSkeletons />
      ) : !shown?.scoringDate ? (
        <div className="mw-empty">
          <ShieldAlert size={22} aria-hidden />
          <span className="mw-empty-title">Nothing scored yet</span>
          <span>
            Scoring runs every morning and writes a snapshot for the whole book. The first run
            populates this list.
          </span>
        </div>
      ) : rows.length === 0 ? (
        <div className="mw-empty">
          <Search size={22} aria-hidden />
          <span className="mw-empty-title">No carriers match</span>
          <span>
            {filtered
              ? 'Clear a filter to see the rest of the snapshot.'
              : 'The snapshot is empty for this date.'}
          </span>
        </div>
      ) : (
        <>
          <ul className="mw-rows" data-stale={stale || undefined} aria-busy={stale || undefined}>
            {rows.map((row) => (
              <li key={row.id}>
                <WatchRow row={row} onOpen={() => setOpenId(row.carrierId)} />
              </li>
            ))}
          </ul>
          <WatchPager
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            busy={loading}
            onPage={setPage}
          />
        </>
      )}
      </>
      ) : null}
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: 'ok' | 'bad' }) {
  return (
    <div className="mw-stat" {...(tone ? { 'data-tone': tone } : {})}>
      <span className="mw-stat-label">{label}</span>
      <span className="mw-stat-value">{value}</span>
      <span className="mw-stat-hint">{hint}</span>
    </div>
  );
}

function StatSkeletons() {
  return (
    <>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="mw-stat" aria-hidden="true">
          <span className="mw-sk mw-sk-line" />
          <span className="mw-sk mw-sk-value" />
          <span className="mw-sk mw-sk-line" />
        </div>
      ))}
    </>
  );
}

/** The book's shape in one bar — proportion answers "how bad is it" faster than four counters do. */
function BandDistribution({
  counts,
  total,
  active,
  onPick,
}: {
  counts: Record<WatchBand, number>;
  total: number;
  active: WatchBand | null;
  onPick: (b: WatchBand | null) => void;
}) {
  return (
    <div className="mw-dist">
      <div className="mw-dist-bar">
        {BAND_ORDER.map((b) =>
          counts[b] > 0 ? (
            <button
              key={b}
              type="button"
              className="mw-dist-seg"
              data-band={b}
              aria-pressed={active === b}
              aria-label={`${BAND_LABEL[b]}: ${counts[b]} of ${total} carriers`}
              style={{ flexBasis: `${(counts[b] / total) * 100}%` }}
              onClick={() => onPick(active === b ? null : b)}
            />
          ) : null,
        )}
      </div>
      <div className="mw-dist-legend">
        {BAND_ORDER.map((b) => (
          <button
            key={b}
            type="button"
            className="mw-legend-item"
            data-band={b}
            aria-pressed={active === b}
            onClick={() => onPick(active === b ? null : b)}
          >
            <span className="mw-legend-dot" aria-hidden />
            {BAND_SHORT[b]} <span className="mw-legend-n">{counts[b]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function RowSkeletons() {
  return (
    <div aria-busy="true">
      <span className="sr-only" role="status">
        Loading the watchlist
      </span>
      <ul className="mw-rows" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => (
          <li key={i}>
            <div className="mw-row" data-skeleton="true">
              <span className="mw-score">
                <span className="mw-sk mw-sk-value" />
                <span className="mw-sk mw-sk-line" />
              </span>
              <span className="mw-main">
                <span className="mw-sk mw-sk-title" />
                <span className="mw-sk mw-sk-line" />
              </span>
              <span className="mw-side">
                <span className="mw-sk mw-sk-line" />
                <span className="mw-sk mw-sk-line" />
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WatchRow({ row, onOpen }: { row: WatchScoreRow; onOpen: () => void }) {
  const delta = watchNum(row.scoreDelta);
  const dir = delta === null || delta === 0 ? 'flat' : delta < 0 ? 'down' : 'up';
  const Icon = dir === 'down' ? ArrowDownRight : dir === 'up' ? ArrowUpRight : Minus;
  const name = row.companyName ?? `Carrier ${row.carrierId}`;

  return (
    <button
      type="button"
      className="mw-row"
      data-band={row.band}
      data-testid="watch-row"
      aria-label={`Open ${name}, score ${fmtScore(watchNum(row.creditScore))}, ${BAND_LABEL[row.band]}`}
      onClick={onOpen}
    >
      <span className="mw-score">
        <span className="mw-score-v">{fmtScore(watchNum(row.creditScore))}</span>
        <span className="mw-delta" data-dir={dir}>
          <Icon size={11} aria-hidden />
          {delta === null ? 'new' : fmtDelta(delta)}
        </span>
      </span>

      <span className="mw-main">
        <span className="mw-name">{name}</span>
        {row.riskDrivers.length > 0 ? (
          <span className="mw-drivers">
            {row.riskDrivers.map((d) => (
              <span key={d} className="mw-driver">
                {d}
              </span>
            ))}
          </span>
        ) : (
          <span className="mw-meta">
            <span>Nothing pushing risk up</span>
          </span>
        )}
        <span className="mw-meta">
          <span>Carrier {row.carrierId}</span>
          {row.agentName ? <span>{row.agentName}</span> : null}
        </span>
      </span>

      <span className="mw-side">
        <span className="mw-pill" data-band={row.band}>
          {BAND_LABEL[row.band]}
        </span>
        <span className="mw-limit">Limit {fmtMoney(watchNum(row.creditLimit))}</span>
      </span>
    </button>
  );
}
