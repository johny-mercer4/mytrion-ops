import { useMemo, useRef, useState } from 'react';
import { ArrowLeft, FileSpreadsheet, RefreshCw, Search } from 'lucide-react';
// Shared stale-while-revalidate cache (the app's Data-Center caching system) — instant re-entry.
import { useCachedLoad, formatCachedAt } from '../../_shared/swrCache';
import {
  resolveTierForRow,
  resolveProjectedTierForRow,
  tierBucketOf,
  type TrackId,
} from '../../_shared/loyalty';
import { listLoyaltyClients } from '../../../api/loyalty';
import type { LoyaltyClientOverride } from '../../../api/loyalty';
import { LoyaltyBonusModal } from './LoyaltyBonusModal';
import { LoyaltyExportModal } from './LoyaltyExportModal';
import { LoyaltySkeleton } from '../MarketingSkeletons';
import { MANAGER_LOYALTY_CACHE_KEY, propagateLoyaltyOverride } from './loyaltyOverrideCache';
import { isMarketingPopulation } from './loyaltyPopulation';
import { ClientCard, Distribution, n0, type Scored, type TierBucket } from './LoyaltyBoardCards';

/**
 * Marketing Mytrion → Loyalty Program. The company-wide tier board: every carrier in the warehouse,
 * with the Loyalty Tiers v3 tier it currently holds.
 *
 * Sales Mytrion's Data Center → Clients renders this same program for ONE agent's book; here it spans
 * all agents. Both call `resolveTier` from mytrions/_shared/loyalty.ts against the same DWH figures
 * (see integrations/dwhClientRoster.ts), so a client's tier is identical in both places.
 *
 * THIS BOARD IS ALWAYS "NOW". Its "last month" column means the month that just closed, full stop.
 * Exporting an arbitrary month is a different question and lives in `LoyaltyExportModal` rather than
 * as a filter here — a month control next to these cards would read as filtering the board, and then
 * "last month" would mean two different things depending on a control the user may not have noticed.
 *
 * Volume: ~8,000 carriers come back, so the grid renders in windows of PAGE and the distribution is
 * always computed over the FULL roster (never the visible slice) — the summary must describe the
 * program, not the scroll position.
 *
 * Presentation (palette, distribution strip, client card) lives in `LoyaltyBoardCards.tsx`.
 */

/** Cards rendered per window — 8k DOM nodes at once would jank the whole shell. */
const PAGE = 60;

/**
 * Track filter options. No "no active cards" entry here on purpose — the `idle` distribution tile
 * already selects exactly that set, and two controls for one filter is one too many.
 */
type TrackFilter = 'all' | TrackId;
const TRACK_FILTERS: { id: TrackFilter; label: string }[] = [
  { id: 'all', label: 'All tracks' },
  { id: 'T1', label: 'Owner-Operator' },
  { id: 'T2', label: 'Small Company' },
  { id: 'T3', label: 'Fleet' },
  { id: 'enterprise', label: 'Enterprise' },
];

/**
 * Marketing's "No Tier" means ACTIVE clients only — the rule itself lives in `loyaltyPopulation.ts`,
 * which the export shares. This is the board's adapter onto it: the board's tier-basis card count is
 * `activeCardsPrevMonth`, the export's is `basisActiveCards`, and both mean "cards that transacted in
 * the month that earns the tier".
 *
 * Kept exported under this name because `marketingNoTier.test.ts` pins the behaviour through it.
 */
export function countsForMarketing(row: Pick<Scored, 'bucket' | 'client'>): boolean {
  return isMarketingPopulation(row.bucket, row.client.activeCardsPrevMonth);
}

export function LoyaltyCard({ onBack }: { onBack?: () => void }) {
  const [q, setQ] = useState('');
  const [bucket, setBucket] = useState<TierBucket | null>(null);
  const [track, setTrack] = useState<TrackFilter>('all');
  const [shown, setShown] = useState(PAGE);
  const [selectedCarrier, setSelectedCarrier] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [localOverrides, setLocalOverrides] = useState<Map<string, LoyaltyClientOverride | null>>(
    () => new Map(),
  );
  const forceRefreshRef = useRef(false);

  // The roster is one heavy DWH read (~8k carriers, ~2.5s), so it caches for 5 minutes.
  const {
    data: roster,
    loading,
    revalidating,
    error,
    cachedAt,
    reload,
  } = useCachedLoad(
    MANAGER_LOYALTY_CACHE_KEY,
    () => {
      const refresh = forceRefreshRef.current;
      forceRefreshRef.current = false;
      return listLoyaltyClients({ refresh });
    },
    { staleMs: 300_000 },
  );

  /**
   * Resolve every carrier's tier once — filters and the distribution both read this.
   *
   * The Marketing filter is applied HERE rather than at render, so the distribution tiles, the
   * stacked bar and every count derive from the same population that is listed. Filtering later
   * would leave the tiles claiming a roster the table cannot show.
   */
  const scored = useMemo<Scored[]>(
    () =>
      (roster?.clients ?? [])
        .map((rawClient) => {
          const client = localOverrides.has(rawClient.carrierId)
            ? {
                ...rawClient,
                loyaltyOverride: localOverrides.get(rawClient.carrierId) ?? null,
              }
            : rawClient;
          const tier = resolveTierForRow(client);
          const projectedTier = resolveProjectedTierForRow(client);
          return {
            client,
            tier,
            projectedTier,
            bucket: tierBucketOf(tier),
          };
        })
        .filter(countsForMarketing),
    [roster, localOverrides],
  );
  const selectedRow = selectedCarrier
    ? (scored.find((row) => row.client.carrierId === selectedCarrier) ?? null)
    : null;

  /** Distribution over the FULL roster — never the filtered or visible subset. */
  const counts = useMemo(() => {
    const c: Record<TierBucket, number> = {
      enterprise: 0,
      gold: 0,
      silver: 0,
      bronze: 0,
      building: 0,
      idle: 0,
    };
    for (const s of scored) c[s.bucket] += 1;
    return c;
  }, [scored]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return scored.filter((s) => {
      if (bucket && s.bucket !== bucket) return false;
      if (track !== 'all' && s.tier.track !== track) return false;
      if (!needle) return true;
      return (
        s.client.companyName.toLowerCase().includes(needle) ||
        s.client.carrierId.includes(needle) ||
        s.client.agentName.toLowerCase().includes(needle)
      );
    });
  }, [scored, q, bucket, track]);

  // Any filter change starts the window over, so you never land mid-list on a new result set.
  const resetWindow =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setShown(PAGE);
    };

  const busy = loading || revalidating;
  const visible = filtered.slice(0, shown);
  const tieredTotal = counts.gold + counts.silver + counts.bronze;
  /**
   * The denominator is the population THIS SCREEN scores, not `roster.total`.
   *
   * `roster.total` is the server's count of every carrier, including the dormant ones dropped by
   * `countsForMarketing`. Leaving it as the denominator would make the distribution percentages sum
   * to well under 100% and print a client count larger than anything the grid can show — the
   * distribution would be describing a roster that is not on screen.
   */
  const scoredTotal = scored.length;
  const dormantHidden = Math.max(0, roster ? roster.total - scoredTotal : 0);

  return (
    <div className="mg-page mg-lty">
      <header className="mg-page-head">
        <div className="mg-page-head-left">
          {onBack ? (
            <button
              type="button"
              className="mg-backbtn"
              onClick={onBack}
              aria-label="Back to overview"
            >
              <ArrowLeft size={16} />
            </button>
          ) : null}
          <div>
            <div className="mg-kicker">Workspaces</div>
            <h1 className="mg-page-title">Loyalty Program</h1>
            <p className="mg-page-sub">
              Last month&apos;s transacting cards set the track; last month&apos;s ULSR + ULSD
              gallons set the tier. This month shows progress toward the next evaluation.
            </p>
          </div>
        </div>
        <div className="mg-head-actions">
          {cachedAt ? (
            <span className="mg-cachedat">Updated {formatCachedAt(cachedAt)}</span>
          ) : null}
          <button
            type="button"
            className="mg-btn"
            onClick={() => {
              forceRefreshRef.current = true;
              reload();
            }}
            disabled={busy}
          >
            <RefreshCw size={15} className={busy ? 'mg-spin' : ''} />
            Refresh
          </button>
          {/* Always available, including while the board loads: the export reads its own month and
              does not depend on this roster, so gating it on the board's spinner would only make the
              action disappear and reappear. */}
          <button
            type="button"
            className="mg-btn"
            onClick={() => setExporting(true)}
            title="Export loyalty tier clients for a chosen month"
          >
            <FileSpreadsheet size={15} />
            Export
          </button>
        </div>
      </header>

      {error ? (
        <div className="mg-error">
          <p>{error}</p>
        </div>
      ) : null}

      {/* One loader only, and it stands in for the WHOLE board: distribution, toolbar, track chips
          and the client grid. It used to be the grid alone, so the three sections above it appeared
          from nothing on arrival and shoved the grid down a full panel height. */}
      {loading && !roster ? <LoyaltySkeleton /> : null}

      {roster ? (
        <>
          <Distribution
            counts={counts}
            total={scoredTotal}
            selected={bucket}
            onSelect={resetWindow(setBucket)}
          />

          <div className="mg-toolbar">
            <div className="mg-summary">
              <strong>{n0(scoredTotal)}</strong> active clients ·{' '}
              <strong>{n0(tieredTotal)}</strong> hold a tier · showing{' '}
              <strong>{n0(visible.length)}</strong> of <strong>{n0(filtered.length)}</strong>
              {/* Say what was removed. A count that silently shrinks is the kind of number nobody
                  can reconcile against the DWH six months later. */}
              {dormantHidden > 0 ? <span> · {n0(dormantHidden)} dormant hidden</span> : null}
            </div>
            <label className="mg-search">
              <Search size={15} />
              <input
                type="search"
                value={q}
                onChange={(e) => resetWindow(setQ)(e.target.value)}
                placeholder="Company, carrier id or agent…"
              />
            </label>
          </div>

          <div className="mg-lty-chips">
            {TRACK_FILTERS.map((t) => (
              <button
                key={t.id}
                type="button"
                className="mg-lty-chip"
                aria-pressed={track === t.id}
                onClick={() => resetWindow(setTrack)(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <div className="mg-empty">No clients match this filter.</div>
          ) : (
            <div className="mg-lty-grid">
              {visible.map((row) => (
                <ClientCard
                  key={row.client.carrierId}
                  row={row}
                  onOpen={() => setSelectedCarrier(row.client.carrierId)}
                />
              ))}
            </div>
          )}

          {visible.length < filtered.length ? (
            <div className="mg-lty-more">
              <button type="button" className="mg-btn" onClick={() => setShown((s) => s + PAGE)}>
                Show {Math.min(PAGE, filtered.length - visible.length)} more
              </button>
            </div>
          ) : null}
        </>
      ) : null}
      {selectedRow ? (
        <LoyaltyBonusModal
          client={selectedRow.client}
          tier={selectedRow.tier}
          onClose={() => setSelectedCarrier(null)}
          onSaved={(override) => {
            propagateLoyaltyOverride(selectedRow.client.carrierId, override);
            setLocalOverrides((current) => {
              const next = new Map(current);
              next.set(selectedRow.client.carrierId, override);
              return next;
            });
          }}
        />
      ) : null}
      {exporting ? <LoyaltyExportModal onClose={() => setExporting(false)} /> : null}
    </div>
  );
}
