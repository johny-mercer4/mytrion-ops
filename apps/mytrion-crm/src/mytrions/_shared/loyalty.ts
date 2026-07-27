/**
 * Octane loyalty tiers — pure config + math. Single source of truth for the "Loyalty Tiers v3"
 * program, shared by BOTH surfaces that render it:
 *
 *   Sales Mytrion   Data Center → Clients — one agent's book (GET /v1/data-center/clients)
 *   Manager Mytrion Loyalty Program       — every carrier (GET /v1/manager/loyalty/clients)
 *
 * It lives in `_shared` precisely so those two can never disagree about a client's tier: both feed
 * the same `resolveTier(activeCards, gallons)` with the same DWH figures, which come from the same
 * underlying roster query (see integrations/dwhClientRoster.ts). The thresholds + rewards below are
 * static program rules from the spec. No React/imports here — trivially unit-testable.
 *
 * Track by active-card count:
 *   T1 Owner-Operator (1) · T2 Small Company (2–3) · T3 Fleet (4+, segmented; capped at 12 cards).
 * Tier by total company gallons this calendar month vs the track/segment thresholds.
 *
 * A tier is RELATIVE TO FLEET SIZE, which surprises people reading a grid: a 1-card owner-operator
 * on 2,046 gal is Gold (T1 gold = 2,000) while a 12-card fleet on 14,612 gal is only Silver
 * (T3-fleet silver = 13,500, gold = 23,000). That is the program working as specified, not a bug —
 * the badge tooltip spells out the track and threshold so the card explains itself.
 *
 * ⚠️ OPEN QUESTION — what counts as an "active card" for the TRACK.
 * This header used to claim "distinct cards with >=1 tx this calendar month", but both callers pass
 * `activeCards` (cards active on the account) and the warehouse exposes `activeCardsThisMonth` as a
 * SEPARATE, currently-unused field. The two can differ a lot — a carrier showing "1/6 active cards"
 * would land on a different track under the other reading, and therefore a different tier. The code
 * is documented here as-built (total active cards); switching to transacting-cards-only would re-tier
 * the whole book, so it needs a product decision, not a quiet edit.
 */

export type TrackId = 'T1' | 'T2' | 'T3';
export type SegmentId = 'small' | 'medium' | 'large' | 'fleet';
export type TierLevel = 'none' | 'bronze' | 'silver' | 'gold';

export interface Thresholds {
  bronze: number;
  silver: number;
  gold: number;
}

export interface Reward {
  title: string;
  desc: string;
  value: string;
  active: boolean;
}

export interface TierResult {
  track: TrackId | null;
  trackLabel: string;
  segment: SegmentId | null;
  segmentLabel: string | null;
  level: TierLevel;
  grace: boolean;
  thresholds: Thresholds | null;
  nextLevel: Exclude<TierLevel, 'none'> | null;
  gallonsToNext: number;
  /** Gallons used to resolve the level (this billing cycle). */
  gallons: number;
  /** Active-card count driving the track (the client's current active cards). */
  activeCards: number;
}

const RANK: Record<TierLevel, number> = { none: 0, bronze: 1, silver: 2, gold: 3 };
const ASCEND: Exclude<TierLevel, 'none'>[] = ['bronze', 'silver', 'gold'];

const TRACK_META: Record<TrackId, { label: string; cards: string }> = {
  T1: { label: 'Owner-Operator', cards: '1 card' },
  T2: { label: 'Small Company', cards: '2–3 cards' },
  T3: { label: 'Fleet', cards: '4+ cards' },
};
const SEGMENT_META: Record<SegmentId, { label: string; cards: string }> = {
  small: { label: 'Small', cards: '4–6 cards' },
  medium: { label: 'Medium', cards: '7–8 cards' },
  large: { label: 'Large', cards: '9–10 cards' },
  fleet: { label: 'Fleet', cards: '11–12 cards' },
};

const T1_THRESHOLDS: Thresholds = { bronze: 1100, silver: 1500, gold: 2000 };
const T2_THRESHOLDS: Thresholds = { bronze: 2200, silver: 3000, gold: 4500 };
const T3_THRESHOLDS: Record<SegmentId, Thresholds> = {
  small: { bronze: 4000, silver: 5500, gold: 11000 },
  medium: { bronze: 6000, silver: 8200, gold: 15000 },
  large: { bronze: 8000, silver: 11000, gold: 19000 },
  fleet: { bronze: 10000, silver: 13500, gold: 23000 },
};

interface RewardDef {
  title: string;
  desc: string;
  minLevel: Exclude<TierLevel, 'none'>;
  /** A flat value, or a per-level value map (Money Code % steps up per tier). */
  value: string | Partial<Record<TierLevel, string>>;
}
const REWARD_DEFS: RewardDef[] = [
  { title: 'Transaction-fee waiver', desc: 'EFS transaction fee waived', minLevel: 'bronze', value: 'Waived' },
  { title: 'Credit score check', desc: 'Free business credit monitoring', minLevel: 'bronze', value: 'Included' },
  { title: 'Money Code limit', desc: '% of weekly invoice total', minLevel: 'bronze', value: { bronze: '20%', silver: '25%', gold: '30%' } },
  { title: 'Monthly-fee waiver', desc: 'Monthly client fee waived', minLevel: 'silver', value: 'Waived' },
  { title: 'TA / Petro discount', desc: 'On top of the current rate', minLevel: 'silver', value: '8¢/gal' },
  { title: "Love's rebate", desc: 'Per gallon · paid quarterly', minLevel: 'gold', value: '4¢/gal' },
];

export function resolveTrack(cards: number): TrackId | null {
  if (cards <= 0) return null;
  if (cards === 1) return 'T1';
  if (cards <= 3) return 'T2';
  return 'T3';
}

export function resolveSegment(cards: number): SegmentId | null {
  if (cards < 4) return null;
  if (cards <= 6) return 'small';
  if (cards <= 8) return 'medium';
  if (cards <= 10) return 'large';
  return 'fleet'; // 11–12, and caps anything above 12 to Fleet
}

function thresholdsFor(track: TrackId, segment: SegmentId | null): Thresholds {
  if (track === 'T1') return T1_THRESHOLDS;
  if (track === 'T2') return T2_THRESHOLDS;
  return T3_THRESHOLDS[segment ?? 'small'];
}

function rawLevelFor(gallons: number, t: Thresholds): TierLevel {
  if (gallons >= t.gold) return 'gold';
  if (gallons >= t.silver) return 'silver';
  if (gallons >= t.bronze) return 'bronze';
  return 'none';
}

/**
 * Resolve a client's tier. The TRACK/segment come from the client's ACTIVE-CARD count (their real
 * active cards — not just cards that transacted this month, so a client with active cards always gets
 * a track); the LEVEL comes from `gallons` — the program basis is this-CALENDAR-month gallons (see the
 * DWH `gallonsThisMonth`), which callers pass here (falling back to this-cycle gallons when a client
 * has no current-month pumps yet). Below the Bronze threshold → level 'none' ("Building toward Bronze").
 */
export function resolveTier(activeCards: number, gallons: number): TierResult {
  const track = resolveTrack(activeCards);
  if (!track) {
    return {
      track: null, trackLabel: '', segment: null, segmentLabel: null, level: 'none',
      grace: false, thresholds: null, nextLevel: null, gallonsToNext: 0, gallons, activeCards,
    };
  }
  const segment = resolveSegment(activeCards);
  const thresholds = thresholdsFor(track, segment);
  const level = rawLevelFor(gallons, thresholds);
  const nextLevel = ASCEND.find((l) => RANK[l] > RANK[level]) ?? null;
  const gallonsToNext = nextLevel ? Math.max(0, thresholds[nextLevel] - gallons) : 0;
  return {
    track,
    trackLabel: TRACK_META[track].label,
    segment,
    segmentLabel: segment ? SEGMENT_META[segment].label : null,
    level,
    grace: false,
    thresholds,
    nextLevel,
    gallonsToNext,
    gallons,
    activeCards,
  };
}

/** The 6 program rewards, with active/inactive + resolved value for the given level. */
export function tierRewards(level: TierLevel): Reward[] {
  return REWARD_DEFS.map((d) => {
    const active = level !== 'none' && RANK[level] >= RANK[d.minLevel];
    let value: string;
    if (typeof d.value === 'string') {
      value = d.value;
    } else {
      value = (active ? d.value[level] : d.value[d.minLevel]) ?? d.value[d.minLevel] ?? '';
    }
    return { title: d.title, desc: d.desc, value, active };
  });
}

/**
 * DISPLAY BUCKETS — the four program tiers plus a fifth for carriers with no active cards.
 *
 * `resolveTier` collapses two entirely different business states onto `level: 'none'`: a client who
 * IS fuelling but hasn't reached Bronze, and a carrier with no active cards at all. Rendering them
 * as one colour makes ~92% of a roster a single block and tells you nothing. Both surfaces that draw
 * the program (Manager's Loyalty board and Sales' Data Center → Clients) need the same split, so it
 * lives here next to `resolveTier` rather than being defined twice.
 */
export type TierBucket = 'gold' | 'silver' | 'bronze' | 'building' | 'idle';

export const TIER_BUCKET_ORDER: TierBucket[] = ['gold', 'silver', 'bronze', 'building', 'idle'];

/** A carrier with no track at all (zero active cards) is 'idle'; otherwise it's working on Bronze. */
export function tierBucketOf(t: Pick<TierResult, 'level' | 'track'>): TierBucket {
  if (t.level !== 'none') return t.level;
  return t.track === null ? 'idle' : 'building';
}

/**
 * Rank for SORTING a client list: highest tier first, "no cards" last.
 *
 * Deliberately separate from `RANK` (which orders the *program* levels for reward eligibility) —
 * this one has to place the two non-tier buckets, and `building` must outrank `idle` because a
 * client working toward Bronze is a live account while one with no active cards is not.
 */
const BUCKET_RANK: Record<TierBucket, number> = {
  gold: 5,
  silver: 4,
  bronze: 3,
  building: 2,
  idle: 1,
};

export function tierBucketRank(b: TierBucket): number {
  return BUCKET_RANK[b];
}

/**
 * Icon key per bucket. Each tier gets a distinct SILHOUETTE rather than one shared star, so a badge
 * is identifiable at a glance and stays legible for anyone who can't separate the metal colours.
 * The keys match the Sales icon registry (mytrions/sales/redesign/icons.tsx).
 */
export function tierBucketIcon(
  b: TierBucket,
): 'tierGold' | 'tierSilver' | 'tierBronze' | 'tierBuilding' | 'tierIdle' {
  switch (b) {
    case 'gold':
      return 'tierGold';
    case 'silver':
      return 'tierSilver';
    case 'bronze':
      return 'tierBronze';
    case 'building':
      return 'tierBuilding';
    default:
      return 'tierIdle';
  }
}

/**
 * Bucket hue / label colour, from the `--lty-*` palette.
 *
 * NOT the global `--tier-*` scale: that renders bronze AS orange, which is the same hue this surface
 * needs for "building toward Bronze", so the two buckets would be indistinguishable. `--lty-*` is
 * defined on `.dc-lty` (sales/redesign/dc-clients.css), so any consumer of these must sit inside an
 * element carrying that class.
 */
export function tierBucketColor(b: TierBucket): string {
  return `var(--lty-${b})`;
}

export function tierBucketTextColor(b: TierBucket): string {
  return `var(--lty-${b}-text)`;
}

export function tierBucketLabel(b: TierBucket): string {
  switch (b) {
    case 'gold':
      return 'Gold';
    case 'silver':
      return 'Silver';
    case 'bronze':
      return 'Bronze';
    case 'building':
      return 'Building';
    default:
      return 'No cards';
  }
}

/** Tint / icon color (theme-aware token; bright in both themes). */
export function tierColor(level: TierLevel): string {
  switch (level) {
    case 'gold':
      return 'var(--tier-gold)';
    case 'silver':
      return 'var(--tier-silver)';
    case 'bronze':
      return 'var(--tier-bronze)';
    default:
      return 'var(--muted)';
  }
}

/** Label TEXT color — AA-safe on both themes (dark-theme bright, light-theme darkened via the token). */
export function tierTextColor(level: TierLevel): string {
  switch (level) {
    case 'gold':
      return 'var(--tier-gold-text)';
    case 'silver':
      return 'var(--tier-silver-text)';
    case 'bronze':
      return 'var(--tier-bronze-text)';
    default:
      return 'var(--muted)';
  }
}

export function tierLabel(level: TierLevel): string {
  switch (level) {
    case 'gold':
      return 'Gold';
    case 'silver':
      return 'Silver';
    case 'bronze':
      return 'Bronze';
    default:
      return 'Building';
  }
}

/** Modal caption, e.g. "Fleet · Large · 9–10 cards" or "No active cards this month". */
export function trackCaption(t: TierResult): string {
  if (!t.track) return 'No active cards this month';
  const parts = [t.trackLabel];
  if (t.segmentLabel) parts.push(t.segmentLabel);
  const cards = t.segment ? SEGMENT_META[t.segment].cards : TRACK_META[t.track].cards;
  return `${parts.join(' · ')} · ${cards}`;
}
