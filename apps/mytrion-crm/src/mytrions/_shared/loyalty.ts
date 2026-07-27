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
 * WHAT COUNTS AS AN "ACTIVE CARD" FOR THE TRACK — from the Loyalty Tiers v3 deck, verbatim:
 *   "System counts active cards (>=1 transaction previous month) on 1st of each month.
 *    4-6 cards -> Small segment · 7-8 -> Medium · 9-10 -> Large · 11-12 -> Fleet.
 *    Segment and thresholds update automatically. Max: 12 active cards."
 *
 * So the track is PREVIOUS-MONTH TRANSACTING cards, snapshotted at the start of the month — NOT the
 * cards active on the account. This used to read `activeCards` (the account total), which inflated
 * the track for anyone holding idle plastic: a carrier with 20 issued cards and 3 trucks actually
 * fuelling was scored against Fleet thresholds (10,000+ gal) and parked in "Building" forever. That
 * is the "huge number of Building clients that aren't really Building" — they were being measured
 * against a fleet they don't run. See {@link resolveTrackCards}.
 *
 * Gallons stay THIS month: the deck locks the segment on the 1st, then tiers on gallons accumulated
 * against that segment's thresholds during the month.
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

/** The card counts a roster row can offer, in the order the program prefers them. */
export interface TrackCardsInput {
  /** Distinct cards with >=1 transaction LAST calendar month — the program's basis. */
  activeCardsPrevMonth?: number | undefined;
  /** Distinct cards with >=1 transaction THIS month — used only for brand-new clients. */
  activeCardsThisMonth?: number | undefined;
}

/**
 * How many cards the TRACK is scored against.
 *
 * Previous-month transacting cards, per the deck. Falls through to this-month only when there is no
 * previous month to read — a carrier that started fuelling on the 3rd has no prior-month count and
 * would otherwise be scored as "no cards" for their whole first month.
 *
 * Deliberately does NOT fall back to the account's total active cards: that is the number that was
 * inflating tracks, and a card with no transactions is not an active card by this program's
 * definition. A carrier with plastic but no pumps in either month genuinely has no track — they show
 * as "No cards", which is the honest answer rather than a Fleet threshold they will never meet.
 */
export function resolveTrackCards(c: TrackCardsInput): number {
  const prev = c.activeCardsPrevMonth ?? 0;
  if (prev > 0) return prev;
  return c.activeCardsThisMonth ?? 0;
}

/** Everything the tier math needs from one roster row, in both surfaces' shape. */
export interface TierRowInput extends TrackCardsInput {
  gallonsThisMonth?: number | undefined;
  cycleGallons?: number | undefined;
  gallonsPrevMonth?: number | undefined;
}

/**
 * Gallons the tier is scored on: this calendar month, falling back to the billing cycle before any
 * pumps land this month (so a client does not read as "Building" for the first days of a month).
 */
export function tierGallonsOf(c: TierRowInput): number {
  const month = c.gallonsThisMonth ?? 0;
  return month > 0 ? month : (c.cycleGallons ?? 0);
}

/**
 * Resolve a row's tier the way BOTH surfaces must: prev-month transacting cards for the track,
 * this-month gallons for the level, and last month's own level as the grace anchor.
 *
 * Last month's level is recomputed from `gallonsPrevMonth` against the same card count — we do not
 * store tier history, and the previous month's card count is the closest honest stand-in for the
 * month before that. Grace can only prevent a drop, so a slightly-off anchor cannot over-grant.
 */
export function resolveTierForRow(c: TierRowInput): TierResult {
  const cards = resolveTrackCards(c);
  const heldLastMonth =
    (c.gallonsPrevMonth ?? 0) > 0
      ? resolveTier(cards, c.gallonsPrevMonth ?? 0).level
      : undefined;
  return resolveTier(cards, tierGallonsOf(c), { heldLastMonth });
}

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

/** "1-month grace if within 10%" (deck footnote) — see {@link applyGrace}. */
const GRACE_FLOOR = 0.9;

function rawLevelFor(gallons: number, t: Thresholds): TierLevel {
  if (gallons >= t.gold) return 'gold';
  if (gallons >= t.silver) return 'silver';
  if (gallons >= t.bronze) return 'bronze';
  return 'none';
}

/**
 * "1-month grace if within 10%": a client who HELD a tier last month keeps it for one more month if
 * they land within 10% of that tier's threshold.
 *
 * Note this is a retention rule, not a discount. An earlier attempt implemented the band alone —
 * "gallons >= 90% of a threshold grants that tier" — which is a different and wrong rule: it would
 * let anyone reach Gold at 1,800 on T1 and so permanently move every threshold down 10%. Grace only
 * ever prevents a DROP, never causes a promotion, so it needs last month's level as the anchor.
 */
function applyGrace(
  computed: TierLevel,
  heldLastMonth: TierLevel | undefined,
  gallons: number,
  t: Thresholds,
): { level: TierLevel; grace: boolean } {
  if (!heldLastMonth || heldLastMonth === 'none') return { level: computed, grace: false };
  if (RANK[computed] >= RANK[heldLastMonth]) return { level: computed, grace: false };
  const bar = t[heldLastMonth as Exclude<TierLevel, 'none'>];
  if (gallons >= bar * GRACE_FLOOR) return { level: heldLastMonth, grace: true };
  return { level: computed, grace: false };
}

/**
 * Resolve a client's tier. The TRACK/segment come from the client's ACTIVE-CARD count (their real
 * active cards — not just cards that transacted this month, so a client with active cards always gets
 * a track); the LEVEL comes from `gallons` — the program basis is this-CALENDAR-month gallons (see the
 * DWH `gallonsThisMonth`), which callers pass here (falling back to this-cycle gallons when a client
 * has no current-month pumps yet). Below the Bronze threshold → level 'none' ("Building toward Bronze").
 */
export function resolveTier(
  activeCards: number,
  gallons: number,
  opts: {
    /** The level this client held LAST month — enables the deck's 1-month, within-10% grace. */
    heldLastMonth?: TierLevel | undefined;
  } = {},
): TierResult {
  const track = resolveTrack(activeCards);
  if (!track) {
    return {
      track: null, trackLabel: '', segment: null, segmentLabel: null, level: 'none',
      grace: false, thresholds: null, nextLevel: null, gallonsToNext: 0, gallons, activeCards,
    };
  }
  const segment = resolveSegment(activeCards);
  const thresholds = thresholdsFor(track, segment);
  const computed = rawLevelFor(gallons, thresholds);
  const { level, grace } = applyGrace(computed, opts.heldLastMonth, gallons, thresholds);
  const nextLevel = ASCEND.find((l) => RANK[l] > RANK[level]) ?? null;
  const gallonsToNext = nextLevel ? Math.max(0, thresholds[nextLevel] - gallons) : 0;
  return {
    track,
    trackLabel: TRACK_META[track].label,
    segment,
    segmentLabel: segment ? SEGMENT_META[segment].label : null,
    level,
    grace,
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
      // "No tier", not "No cards": the bucket means the client earned no tier this month, which is
      // the thing an agent acts on. Whether they hold plastic is a separate question — plenty of
      // these carriers have cards issued, they just have not fuelled on them.
      return 'No tier';
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

/** Modal caption, e.g. "Fleet · Large · 9–10 cards" or the no-track reason. */
export function trackCaption(t: TierResult): string {
  if (!t.track) return 'No card activity this month or last — no tier';
  const parts = [t.trackLabel];
  if (t.segmentLabel) parts.push(t.segmentLabel);
  const cards = t.segment ? SEGMENT_META[t.segment].cards : TRACK_META[t.track].cards;
  return `${parts.join(' · ')} · ${cards}`;
}
