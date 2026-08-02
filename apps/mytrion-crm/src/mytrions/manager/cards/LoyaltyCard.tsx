import { useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowLeft,
  Award,
  Fuel,
  Medal,
  MinusCircle,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sprout,
  TrendingDown,
  TrendingUp,
  Trophy,
} from 'lucide-react';
// Shared stale-while-revalidate cache (the app's Data-Center caching system) — instant re-entry.
import { useCachedLoad, formatCachedAt } from '../../sales/redesign/dcCache';
import {
  resolveTierForRow,
  resolveProjectedTierForRow,
  tierBucketOf,
  tierBucketLabel,
  tierLabel,
  type TierResult,
  type TrackId,
} from '../../_shared/loyalty';
import { listLoyaltyClients, type LoyaltyClient } from '../../../api/loyalty';
import type { LoyaltyClientOverride } from '../../../api/loyalty';
import { LoyaltyBonusModal } from './LoyaltyBonusModal';
import { MANAGER_LOYALTY_CACHE_KEY, propagateLoyaltyOverride } from './loyaltyOverrideCache';

/**
 * Manager Mytrion → Loyalty Program. The company-wide tier board: every carrier in the warehouse,
 * with the Loyalty Tiers v3 tier it currently holds.
 *
 * Sales Mytrion's Data Center → Clients renders this same program for ONE agent's book; here it spans
 * all agents. Both call `resolveTier` from mytrions/_shared/loyalty.ts against the same DWH figures
 * (see integrations/dwhClientRoster.ts), so a client's tier is identical in both places.
 *
 * Colour: a card is literally its tier — Gold cards read gold, Silver silver, Bronze a true copper
 * bronze, clients still below the Bronze threshold take orange ("Building"), and carriers with no
 * active cards at all take a receding neutral plus a dashed border ("No tier"). The shared --tier-*
 * scale renders bronze AS orange, which collides with that not-reached state, so this surface uses its
 * own --lty-* palette (see manager.css) and leaves Sales untouched.
 *
 * Volume: ~8,000 carriers come back, so the grid renders in windows of PAGE and the distribution is
 * always computed over the FULL roster (never the visible slice) — the summary must describe the
 * program, not the scroll position.
 */

/** Cards rendered per window — 8k DOM nodes at once would jank the whole shell. */
const PAGE = 60;

/**
 * Display buckets — the four program tiers PLUS a fifth for carriers with no active cards.
 *
 * `resolveTier` collapses both "fuelling but under Bronze" and "no cards at all" to level 'none',
 * but they are entirely different business states and lumping them made the distribution bar 92%
 * one colour. Splitting them is what makes the chart readable: ~3,950 clients are genuinely working
 * toward Bronze, while ~3,470 simply aren't in the program.
 */
type Bucket = 'enterprise' | 'gold' | 'silver' | 'bronze' | 'building' | 'idle';

const BUCKET_ORDER: Bucket[] = ['enterprise', 'gold', 'silver', 'bronze', 'building', 'idle'];

/** Fill hue + label hue per bucket, from the card's own --lty-* palette. */
const FILL: Record<Bucket, string> = {
  enterprise: 'var(--lty-enterprise)',
  gold: 'var(--lty-gold)',
  silver: 'var(--lty-silver)',
  bronze: 'var(--lty-bronze)',
  building: 'var(--lty-building)',
  idle: 'var(--lty-idle)',
};
const TEXT: Record<Bucket, string> = {
  enterprise: 'var(--lty-enterprise-text)',
  gold: 'var(--lty-gold-text)',
  silver: 'var(--lty-silver-text)',
  bronze: 'var(--lty-bronze-text)',
  building: 'var(--lty-building-text)',
  idle: 'var(--lty-idle-text)',
};
const ICON: Record<Bucket, typeof Trophy> = {
  enterprise: ShieldCheck,
  gold: Trophy,
  silver: Medal,
  bronze: Award,
  building: Sprout,
  idle: MinusCircle,
};
// Labels come from _shared/loyalty (tierBucketLabel). A local copy existed here and is exactly how
// the two surfaces drift — Sales said one thing and this board another.

/** Set the two custom properties the CSS reads (--t fill, --tt label). */
const bucketVars = (b: Bucket): CSSProperties =>
  ({ '--t': FILL[b], '--tt': TEXT[b] }) as CSSProperties;

const numFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const n0 = (v: number): string => numFmt.format(Math.round(v));

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
 * How far through the CURRENT band the client is, 0–100. Measured from the band it already cleared
 * (0 while Building) to the next threshold, so the bar reads "progress toward the next tier" rather
 * than "progress from zero" — a Silver client at 5,600 of 11,000 gal should not look nearly done.
 */
function progressPct(t: TierResult): number {
  if (!t.thresholds || !t.nextLevel) return 100;
  const base = t.level === 'none' ? 0 : t.thresholds[t.level];
  const span = t.thresholds[t.nextLevel] - base;
  if (span <= 0) return 100;
  return Math.max(0, Math.min(100, ((t.gallons - base) / span) * 100));
}

/** A carrier plus its resolved tier — computed once per roster, reused by filter/sort/render. */
interface Scored {
  client: LoyaltyClient;
  tier: TierResult;
  projectedTier: TierResult;
  bucket: Bucket;
}

function TierBadge({ bucket }: { bucket: Bucket }) {
  const Icon = ICON[bucket];
  return (
    <span className="mg-lty-badge" style={bucketVars(bucket)}>
      <Icon size={11} />
      {tierBucketLabel(bucket)}
    </span>
  );
}

/** Month-over-month gallons delta. Omitted when there is no prior month to compare against. */
function Trend({ now, prev }: { now: number; prev: number }) {
  if (prev <= 0) return <>—</>;
  const pct = ((now - prev) / prev) * 100;
  if (!Number.isFinite(pct) || Math.abs(pct) < 0.5) return <>flat</>;
  const up = pct > 0;
  return (
    <span className={up ? 'mg-lty-trend-up' : 'mg-lty-trend-down'}>
      {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />} {up ? '+' : ''}
      {pct.toFixed(0)}%
    </span>
  );
}

/** Stacked bar + one clickable tile per bucket. Counts always describe the WHOLE roster. */
function Distribution({
  counts,
  total,
  selected,
  onSelect,
}: {
  counts: Record<Bucket, number>;
  total: number;
  selected: Bucket | null;
  onSelect: (bucket: Bucket | null) => void;
}) {
  return (
    <div className="mg-lty-dist">
      <div className="mg-lty-bar">
        {BUCKET_ORDER.map((b) => {
          const pct = total > 0 ? (counts[b] / total) * 100 : 0;
          return pct > 0 ? (
            <span key={b} style={{ width: `${pct}%`, background: FILL[b] }} />
          ) : null;
        })}
      </div>
      <div className="mg-lty-tiles">
        {BUCKET_ORDER.map((b) => (
          <button
            key={b}
            type="button"
            className={`mg-lty-tile is-${b}`}
            style={bucketVars(b)}
            aria-pressed={selected === b}
            onClick={() => onSelect(selected === b ? null : b)}
          >
            <span className="mg-lty-tile-n">{n0(counts[b])}</span>
            <span className="mg-lty-tile-l">{tierBucketLabel(b)}</span>
            <span className="mg-lty-tile-pct">
              {total > 0 ? `${((counts[b] / total) * 100).toFixed(1)}%` : '—'} of clients
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** One carrier — the card is tinted, bordered and top-ruled by the tier it holds. */
function ClientCard({ row, onOpen }: { row: Scored; onOpen: () => void }) {
  const { client, tier, projectedTier, bucket } = row;
  // `is-<bucket>` carries the shared --tint / --sheen tuning (see manager.css) plus any per-bucket
  // extras — Gold's halo, No-cards' dashed border.
  return (
    <button
      type="button"
      className={`mg-lty-c is-${bucket}`}
      style={bucketVars(bucket)}
      onClick={onOpen}
      aria-label={`Manage loyalty rewards for ${client.companyName}`}
    >
      <div className="mg-lty-c-top">
        <div>
          <div className="mg-lty-c-name" title={client.companyName}>
            {client.companyName}
          </div>
          <div className="mg-lty-c-meta">
            <span>#{client.carrierId}</span>
            <span>·</span>
            <em>{client.agentName}</em>
            {!client.computedIsActive ? (
              <>
                <span>·</span>
                <span className="mg-lty-trend-down">inactive</span>
              </>
            ) : null}
          </div>
        </div>
        <TierBadge bucket={bucket} />
      </div>

      <div className="mg-lty-periods">
        <section className="mg-lty-period is-closed">
          <header>
            <span>Last month</span>
            <strong>Tier basis</strong>
          </header>
          <div className="mg-lty-period-main">
            <span>
              <Fuel size={12} /> In-network
            </span>
            <strong>{n0(client.inNetworkGallonsPrevMonth)} gal</strong>
          </div>
          <dl>
            <div>
              <dt>Transacting cards</dt>
              <dd>{client.activeCardsPrevMonth}</dd>
            </div>
            <div>
              <dt>Total gallons</dt>
              <dd>{n0(client.gallonsPrevMonth)}</dd>
            </div>
          </dl>
        </section>
        <section className="mg-lty-period is-current">
          <header>
            <span>This month</span>
            <strong>Next tier progress</strong>
          </header>
          <div className="mg-lty-period-main">
            <span>
              <Fuel size={12} /> In-network
            </span>
            <strong>{n0(client.inNetworkGallonsThisMonth)} gal</strong>
          </div>
          <dl>
            <div>
              <dt>Transacting cards</dt>
              <dd>{client.activeCardsThisMonth}</dd>
            </div>
            <div>
              <dt>vs last month</dt>
              <dd>
                <Trend
                  now={client.inNetworkGallonsThisMonth}
                  prev={client.inNetworkGallonsPrevMonth}
                />
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <div className="mg-lty-account">
        <span>Account active cards</span>
        <strong>{client.activeCards}</strong>
        <span>Declared trucks</span>
        <strong>{client.trucks ?? '—'}</strong>
      </div>

      {projectedTier.track && projectedTier.track !== 'enterprise' ? (
        <div className="mg-lty-prog">
          <div className="mg-lty-prog-track">
            <div
              className="mg-lty-prog-fill"
              style={{ width: `${progressPct(projectedTier)}%` }}
              /* The bar is decorative; the label below carries the same value as text. */
              aria-hidden="true"
            />
          </div>
          <div className="mg-lty-prog-lbl">
            <span>
              Next evaluation · {projectedTier.trackLabel}
              {projectedTier.segmentLabel ? ` · ${projectedTier.segmentLabel}` : ''}
            </span>
            <strong>
              {projectedTier.nextLevel
                ? `${n0(projectedTier.gallonsToNext)} gal to ${tierLabel(projectedTier.nextLevel)}`
                : 'Projected Gold'}
            </strong>
          </div>
        </div>
      ) : (
        <div className="mg-lty-prog-lbl">
          <span>
            {projectedTier.track === 'enterprise'
              ? 'Next evaluation · Enterprise'
              : tier.track
                ? `${tier.trackLabel}${tier.segmentLabel ? ` · ${tier.segmentLabel}` : ''}`
                : 'No current-month activity'}
          </span>
        </div>
      )}
      <span className="mg-lty-manage">
        <Settings2 size={13} />
        {client.loyaltyOverride ? 'Custom loyalty controls' : 'Manage rewards'}
      </span>
    </button>
  );
}

export function LoyaltyCard({ onBack }: { onBack?: () => void }) {
  const [q, setQ] = useState('');
  const [bucket, setBucket] = useState<Bucket | null>(null);
  const [track, setTrack] = useState<TrackFilter>('all');
  const [shown, setShown] = useState(PAGE);
  const [selectedCarrier, setSelectedCarrier] = useState<string | null>(null);
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

  /** Resolve every carrier's tier once — filters and the distribution both read this. */
  const scored = useMemo<Scored[]>(
    () =>
      (roster?.clients ?? []).map((rawClient) => {
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
      }),
    [roster, localOverrides],
  );
  const selectedRow = selectedCarrier
    ? (scored.find((row) => row.client.carrierId === selectedCarrier) ?? null)
    : null;

  /** Distribution over the FULL roster — never the filtered or visible subset. */
  const counts = useMemo(() => {
    const c: Record<Bucket, number> = {
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
        </div>
      </header>

      {error ? (
        <div className="mg-error">
          <p>{error}</p>
        </div>
      ) : null}

      {/* One loader only: the skeleton grid stands in for the whole board while it loads. */}
      {loading && !roster ? (
        <div className="mg-lty-grid">
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className="mg-lty-sk" />
          ))}
        </div>
      ) : null}

      {roster ? (
        <>
          <Distribution
            counts={counts}
            total={roster.total}
            selected={bucket}
            onSelect={resetWindow(setBucket)}
          />

          <div className="mg-toolbar">
            <div className="mg-summary">
              <strong>{n0(roster.total)}</strong> clients · <strong>{n0(tieredTotal)}</strong> hold
              a tier · showing <strong>{n0(visible.length)}</strong> of{' '}
              <strong>{n0(filtered.length)}</strong>
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
    </div>
  );
}
