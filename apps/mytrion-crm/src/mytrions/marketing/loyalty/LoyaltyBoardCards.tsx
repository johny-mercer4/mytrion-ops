/**
 * The Loyalty board's PRESENTATION — the bucket palette, the distribution strip and the client card.
 *
 * Split out of `LoyaltyCard.tsx`, which had grown past the 600-line cap and was three things at once:
 * a data container, a palette registry, and four presentational components. Nothing here changed in
 * the move; the container keeps the roster, the filters and the window, and everything that only
 * knows how to *draw* a scored carrier lives here.
 *
 * Colour: a card is literally its tier — Gold cards read gold, Silver silver, Bronze a true copper
 * bronze, clients still below the Bronze threshold take orange ("Building"), and carriers with no
 * transacting cards at all take a receding neutral plus a dashed border ("No tier"). The shared
 * `--tier-*` scale renders bronze AS orange, which collides with that not-reached state, so this
 * surface uses its own `--lty-*` palette (see loyalty.css) and leaves Sales untouched.
 *
 * BUCKETS COME FROM THE SHARED MODULE. `TierBucket` / `TIER_BUCKET_ORDER` / `tierBucketLabel` are
 * imported from `_shared/loyalty` rather than restated: a local copy of the labels is exactly how the
 * two surfaces drifted once already, with Sales saying one thing and this board another.
 */
import type { CSSProperties } from 'react';
import {
  Award,
  Fuel,
  Medal,
  MinusCircle,
  Settings2,
  ShieldCheck,
  Sprout,
  TrendingDown,
  TrendingUp,
  Trophy,
} from 'lucide-react';
import {
  TIER_BUCKET_ORDER,
  tierBucketLabel,
  tierLabel,
  type TierBucket,
  type TierResult,
} from '../../_shared/loyalty';
import type { LoyaltyClient } from '../../../api/loyalty';

export type { TierBucket } from '../../_shared/loyalty';
export { TIER_BUCKET_ORDER } from '../../_shared/loyalty';

/** Fill hue + label hue per bucket, from the board's own `--lty-*` palette. */
export const FILL: Record<TierBucket, string> = {
  enterprise: 'var(--lty-enterprise)',
  gold: 'var(--lty-gold)',
  silver: 'var(--lty-silver)',
  bronze: 'var(--lty-bronze)',
  building: 'var(--lty-building)',
  idle: 'var(--lty-idle)',
};
const TEXT: Record<TierBucket, string> = {
  enterprise: 'var(--lty-enterprise-text)',
  gold: 'var(--lty-gold-text)',
  silver: 'var(--lty-silver-text)',
  bronze: 'var(--lty-bronze-text)',
  building: 'var(--lty-building-text)',
  idle: 'var(--lty-idle-text)',
};
const ICON: Record<TierBucket, typeof Trophy> = {
  enterprise: ShieldCheck,
  gold: Trophy,
  silver: Medal,
  bronze: Award,
  building: Sprout,
  idle: MinusCircle,
};

/** Set the two custom properties the CSS reads (`--t` fill, `--tt` label). */
export const bucketVars = (b: TierBucket): CSSProperties =>
  ({ '--t': FILL[b], '--tt': TEXT[b] }) as CSSProperties;

const numFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
export const n0 = (v: number): string => numFmt.format(Math.round(v));

/** A carrier plus its resolved tier — computed once per roster, reused by filter/sort/render. */
export interface Scored {
  client: LoyaltyClient;
  tier: TierResult;
  projectedTier: TierResult;
  bucket: TierBucket;
}

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

export function TierBadge({ bucket }: { bucket: TierBucket }) {
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
export function Distribution({
  counts,
  total,
  selected,
  onSelect,
}: {
  counts: Record<TierBucket, number>;
  total: number;
  selected: TierBucket | null;
  onSelect: (bucket: TierBucket | null) => void;
}) {
  return (
    <div className="mg-lty-dist">
      <div className="mg-lty-bar">
        {TIER_BUCKET_ORDER.map((b) => {
          const pct = total > 0 ? (counts[b] / total) * 100 : 0;
          return pct > 0 ? (
            <span key={b} style={{ width: `${pct}%`, background: FILL[b] }} />
          ) : null;
        })}
      </div>
      <div className="mg-lty-tiles">
        {TIER_BUCKET_ORDER.map((b) => (
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
export function ClientCard({ row, onOpen }: { row: Scored; onOpen: () => void }) {
  const { client, tier, projectedTier, bucket } = row;
  // `is-<bucket>` carries the shared --tint / --sheen tuning (see loyalty.css) plus any per-bucket
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
            <div title="Warehouse period metric (~3h sync) — distinct cards with transactions, not live EFS Active">
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
            <div title="Warehouse period metric (~3h sync) — distinct cards with transactions, not live EFS Active">
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
        <span title="dim_card Active count from the warehouse (~3h). Live EFS is used on Sales card drilldowns, not the company-wide loyalty roster (rate limits).">
          Account active cards
        </span>
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
