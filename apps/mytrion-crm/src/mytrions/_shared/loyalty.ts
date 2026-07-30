/**
 * Loyalty Tiers v3 — the shared, pure rules used by Manager and Sales.
 *
 * The current month's status is earned from the FULL previous calendar month:
 * - track: distinct cards with at least one transaction in that closed month;
 * - tier: only ULSR + ULSD gallons in that closed month;
 * - total gallons and `dim_company.total_active_cards` are reference metrics only.
 *
 * A current-month swipe after a zero-transaction previous month is Building (calibration). There is
 * deliberately no grace or "near threshold" rounding. Enterprise starts at 12 transacting cards and
 * has no automatic gallon thresholds.
 */

export type TrackId = 'T1' | 'T2' | 'T3' | 'enterprise';
export type SegmentId = 'small' | 'medium' | 'large' | 'fleet';
export type TierLevel = 'none' | 'bronze' | 'silver' | 'gold';
export type LoyaltyRewardId =
  | 'transaction_fee_waiver'
  | 'credit_score_check'
  | 'money_code_limit'
  | 'monthly_fee_waiver'
  | 'ta_petro_rebate'
  | 'loves_rebate';
export type LoyaltyEnterpriseMode = 'normal_billing' | 'volume_target';
export type LoyaltyStatus = 'gold' | 'silver' | 'bronze' | 'no_tier' | 'building' | 'enterprise';

export interface Thresholds {
  bronze: number;
  silver: number;
  gold: number;
}

export interface Reward {
  id: LoyaltyRewardId;
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
  status: LoyaltyStatus;
  /** Retained for old call sites; the normative program has no grace mechanism. */
  grace: false;
  thresholds: Thresholds | null;
  nextLevel: Exclude<TierLevel, 'none'> | null;
  gallonsToNext: number;
  /** In-network ULSR + ULSD gallons used for this result. */
  gallons: number;
  /** Active cards used to determine the track. Kept under the old name for API compatibility. */
  fleetSize: number;
  /** Always true now: track is measured directly from transacting cards, never trucks. */
  fleetSizeKnown: true;
  basis: 'closed_month' | 'calibration' | 'stored' | 'not_evaluated';
  enterpriseState: 'normal_billing' | 'target_not_set' | 'target_set' | 'gold' | null;
  enterpriseGoldTargetGallons: number | null;
}

const RANK: Record<TierLevel, number> = { none: 0, bronze: 1, silver: 2, gold: 3 };
const ASCEND: Exclude<TierLevel, 'none'>[] = ['bronze', 'silver', 'gold'];

const TRACK_META: Record<TrackId, { label: string; cards: string }> = {
  T1: { label: 'Owner-Operator', cards: '1 active card' },
  T2: { label: 'Small Company', cards: '2–3 active cards' },
  T3: { label: 'Fleet', cards: '4–11 active cards' },
  enterprise: { label: 'Enterprise', cards: '12+ active cards' },
};
const SEGMENT_META: Record<SegmentId, { label: string; cards: string }> = {
  small: { label: 'Small', cards: '4–6 active cards' },
  medium: { label: 'Medium', cards: '7–8 active cards' },
  large: { label: 'Large', cards: '9–10 active cards' },
  fleet: { label: 'Fleet', cards: '11 active cards' },
};

const T1_THRESHOLDS: Thresholds = { bronze: 1100, silver: 1500, gold: 2000 };
const T2_THRESHOLDS: Thresholds = { bronze: 2200, silver: 3000, gold: 4500 };
const T3_THRESHOLDS: Record<SegmentId, Thresholds> = {
  small: { bronze: 4000, silver: 6500, gold: 11000 },
  medium: { bronze: 6000, silver: 9000, gold: 15000 },
  large: { bronze: 8000, silver: 11000, gold: 19000 },
  fleet: { bronze: 10000, silver: 13500, gold: 23000 },
};

interface RewardDef {
  id: LoyaltyRewardId;
  title: string;
  desc: string;
  minLevel: Exclude<TierLevel, 'none'>;
  value: string | Partial<Record<TierLevel, string>>;
}
const REWARD_DEFS: RewardDef[] = [
  {
    id: 'transaction_fee_waiver',
    title: 'Transaction Fee Waiver',
    desc: 'EFS transaction fee waived',
    minLevel: 'bronze',
    value: 'Waived',
  },
  {
    id: 'credit_score_check',
    title: 'Credit Score Check',
    desc: 'Free business credit monitoring',
    minLevel: 'bronze',
    value: 'Included',
  },
  {
    id: 'money_code_limit',
    title: 'Money Code Limit',
    desc: 'Percentage of weekly invoice total',
    minLevel: 'bronze',
    value: { bronze: '20%', silver: '25%', gold: '30%' },
  },
  {
    id: 'monthly_fee_waiver',
    title: 'Monthly Fee Waiver',
    desc: 'Monthly client fee waived',
    minLevel: 'silver',
    value: 'Waived',
  },
  {
    id: 'ta_petro_rebate',
    title: 'TA / Petro Rebate',
    desc: 'Paid quarterly on eligible station gallons',
    minLevel: 'silver',
    value: '8¢/gal',
  },
  {
    id: 'loves_rebate',
    title: "Love's Direct Rebate",
    desc: 'Paid quarterly on Gold-month in-network gallons',
    minLevel: 'gold',
    value: '4¢/gal',
  },
];

export interface TrackCardsInput {
  activeCardsPrevMonth?: number | undefined;
  activeCardsThisMonth?: number | undefined;
}

/** Previous-month cards are authoritative; this-month cards are only the calibration preview. */
export function resolveTrackCards(c: TrackCardsInput): number {
  const previous = c.activeCardsPrevMonth ?? 0;
  return previous > 0 ? previous : Math.max(0, c.activeCardsThisMonth ?? 0);
}

/** Compatibility helper: trucks are no longer a loyalty input. */
export function resolveFleetSize(c: { trucks?: number | null | undefined }): number | null {
  const trucks = c.trucks;
  return typeof trucks === 'number' && Number.isInteger(trucks) && trucks >= 1 ? trucks : null;
}

export interface TierRowInput extends TrackCardsInput {
  inNetworkGallonsPrevMonth?: number | undefined;
  inNetworkGallonsThisMonth?: number | undefined;
  /** Stored warehouse status, used only during a zero-activity month. */
  lastTierName?: string | undefined;
  loyaltyOverride?:
    | {
        enterpriseMode?: LoyaltyEnterpriseMode | null | undefined;
        enterpriseGoldTargetGallons?: number | null | undefined;
        enabledRewardIds?: readonly LoyaltyRewardId[] | null | undefined;
      }
    | null
    | undefined;
}

/** The current status' volume basis: closed previous-month ULSR + ULSD gallons only. */
export function tierGallonsOf(c: TierRowInput): number {
  return Math.max(0, c.inNetworkGallonsPrevMonth ?? 0);
}

function storedLevel(name: string | undefined): TierLevel | null {
  switch (name?.trim().toLowerCase()) {
    case 'gold':
      return 'gold';
    case 'silver':
      return 'silver';
    case 'bronze':
      return 'bronze';
    case 'no tier':
      return 'none';
    default:
      return null;
  }
}

function emptyResult(
  status: LoyaltyStatus,
  level: TierLevel = 'none',
  basis: TierResult['basis'] = 'not_evaluated',
): TierResult {
  return {
    track: null,
    trackLabel: '',
    segment: null,
    segmentLabel: null,
    level,
    status,
    grace: false,
    thresholds: null,
    nextLevel: null,
    gallonsToNext: 0,
    gallons: 0,
    fleetSize: 0,
    fleetSizeKnown: true,
    basis,
    enterpriseState: null,
    enterpriseGoldTargetGallons: null,
  };
}

/**
 * Resolve the status active THIS month. Previous-month inputs decide evaluated tiers. When the
 * previous month is empty but the current month has activity, the company is Building until the next
 * close. During a fully dormant month, the persisted warehouse tier is retained where available.
 */
export function resolveTierForRow(c: TierRowInput): TierResult {
  const previousCards = Math.max(0, c.activeCardsPrevMonth ?? 0);
  if (previousCards > 0) {
    return resolveTier(previousCards, tierGallonsOf(c), {
      enterpriseMode: c.loyaltyOverride?.enterpriseMode ?? null,
      enterpriseGoldTargetGallons: c.loyaltyOverride?.enterpriseGoldTargetGallons ?? null,
    });
  }

  const currentCards = Math.max(0, c.activeCardsThisMonth ?? 0);
  if (currentCards > 0) {
    const preview = resolveTier(currentCards, Math.max(0, c.inNetworkGallonsThisMonth ?? 0), {
      enterpriseMode: c.loyaltyOverride?.enterpriseMode ?? null,
      enterpriseGoldTargetGallons: c.loyaltyOverride?.enterpriseGoldTargetGallons ?? null,
    });
    return {
      ...preview,
      level: 'none',
      status: 'building',
      nextLevel: preview.track === 'enterprise' ? null : 'bronze',
      gallonsToNext:
        preview.thresholds === null ? 0 : Math.max(0, preview.thresholds.bronze - preview.gallons),
      basis: 'calibration',
    };
  }

  const retained = storedLevel(c.lastTierName);
  if (retained !== null) {
    return emptyResult(retained === 'none' ? 'no_tier' : retained, retained, 'stored');
  }
  return emptyResult('no_tier');
}

/** Current-month projection for the status that will become active after the next monthly close. */
export function resolveProjectedTierForRow(c: TierRowInput): TierResult {
  return resolveTier(
    Math.max(0, c.activeCardsThisMonth ?? 0),
    Math.max(0, c.inNetworkGallonsThisMonth ?? 0),
    {
      enterpriseMode: c.loyaltyOverride?.enterpriseMode ?? null,
      enterpriseGoldTargetGallons: c.loyaltyOverride?.enterpriseGoldTargetGallons ?? null,
    },
  );
}

export function resolveTrack(activeCards: number): TrackId | null {
  if (activeCards <= 0) return null;
  if (activeCards === 1) return 'T1';
  if (activeCards <= 3) return 'T2';
  if (activeCards <= 11) return 'T3';
  return 'enterprise';
}

export function resolveSegment(activeCards: number): SegmentId | null {
  if (activeCards < 4 || activeCards >= 12) return null;
  if (activeCards <= 6) return 'small';
  if (activeCards <= 8) return 'medium';
  if (activeCards <= 10) return 'large';
  return 'fleet';
}

function thresholdsFor(
  track: Exclude<TrackId, 'enterprise'>,
  segment: SegmentId | null,
): Thresholds {
  if (track === 'T1') return T1_THRESHOLDS;
  if (track === 'T2') return T2_THRESHOLDS;
  return T3_THRESHOLDS[segment ?? 'small'];
}

function rawLevelFor(gallons: number, thresholds: Thresholds): TierLevel {
  if (gallons >= thresholds.gold) return 'gold';
  if (gallons >= thresholds.silver) return 'silver';
  if (gallons >= thresholds.bronze) return 'bronze';
  return 'none';
}

/** Exact closed-month evaluation. No grace, rounding, or truck-based substitution. */
export function resolveTier(
  activeCards: number,
  inNetworkGallons: number,
  options: {
    heldLastMonth?: TierLevel | undefined;
    fleetSizeKnown?: boolean | undefined;
    enterpriseMode?: LoyaltyEnterpriseMode | null | undefined;
    enterpriseGoldTargetGallons?: number | null | undefined;
  } = {},
): TierResult {
  const cards = Math.max(0, Math.floor(activeCards));
  const gallons = Math.max(0, inNetworkGallons);
  const track = resolveTrack(cards);
  if (!track) return emptyResult('no_tier');
  if (track === 'enterprise') {
    const target =
      typeof options.enterpriseGoldTargetGallons === 'number' &&
      Number.isFinite(options.enterpriseGoldTargetGallons) &&
      options.enterpriseGoldTargetGallons > 0
        ? options.enterpriseGoldTargetGallons
        : null;
    const volumeTarget = options.enterpriseMode === 'volume_target' && target !== null;
    const achieved = volumeTarget && gallons >= target;
    return {
      ...emptyResult(achieved ? 'gold' : 'enterprise', achieved ? 'gold' : 'none', 'closed_month'),
      track,
      trackLabel: TRACK_META.enterprise.label,
      gallons,
      fleetSize: cards,
      nextLevel: volumeTarget && !achieved ? 'gold' : null,
      gallonsToNext: volumeTarget && !achieved ? Math.max(0, target - gallons) : 0,
      enterpriseState:
        options.enterpriseMode === 'normal_billing'
          ? 'normal_billing'
          : volumeTarget
            ? achieved
              ? 'gold'
              : 'target_set'
            : 'target_not_set',
      enterpriseGoldTargetGallons: target,
    };
  }

  const segment = resolveSegment(cards);
  const thresholds = thresholdsFor(track, segment);
  const level = rawLevelFor(gallons, thresholds);
  const nextLevel = ASCEND.find((candidate) => RANK[candidate] > RANK[level]) ?? null;
  return {
    track,
    trackLabel: TRACK_META[track].label,
    segment,
    segmentLabel: segment ? SEGMENT_META[segment].label : null,
    level,
    status: level === 'none' ? 'no_tier' : level,
    grace: false,
    thresholds,
    nextLevel,
    gallonsToNext: nextLevel ? Math.max(0, thresholds[nextLevel] - gallons) : 0,
    gallons,
    fleetSize: cards,
    fleetSizeKnown: true,
    basis: 'closed_month',
    enterpriseState: null,
    enterpriseGoldTargetGallons: null,
  };
}

export function tierRewards(
  level: TierLevel,
  enabledOverride?: readonly LoyaltyRewardId[] | null,
): Reward[] {
  const override =
    enabledOverride === undefined || enabledOverride === null ? null : new Set(enabledOverride);
  return REWARD_DEFS.map((definition) => {
    const active = override
      ? override.has(definition.id)
      : level !== 'none' && RANK[level] >= RANK[definition.minLevel];
    const value =
      typeof definition.value === 'string'
        ? definition.value
        : (definition.value[active ? level : definition.minLevel] ?? '');
    return { ...definition, value, active };
  });
}

/**
 * UI buckets. `idle` is the existing CSS/icon key for the normative visible status "No Tier"; it is
 * not shown to users as "Idle".
 */
export type TierBucket = 'enterprise' | 'gold' | 'silver' | 'bronze' | 'building' | 'idle';
export const TIER_BUCKET_ORDER: TierBucket[] = [
  'enterprise',
  'gold',
  'silver',
  'bronze',
  'building',
  'idle',
];

export function tierBucketOf(tier: Pick<TierResult, 'status'>): TierBucket {
  return tier.status === 'no_tier' ? 'idle' : tier.status;
}

const BUCKET_RANK: Record<TierBucket, number> = {
  enterprise: 6,
  gold: 5,
  silver: 4,
  bronze: 3,
  building: 2,
  idle: 1,
};
export function tierBucketRank(bucket: TierBucket): number {
  return BUCKET_RANK[bucket];
}

export function tierBucketIcon(
  bucket: TierBucket,
): 'tierEnterprise' | 'tierGold' | 'tierSilver' | 'tierBronze' | 'tierBuilding' | 'tierIdle' {
  switch (bucket) {
    case 'enterprise':
      return 'tierEnterprise';
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

export function tierBucketColor(bucket: TierBucket): string {
  return `var(--lty-${bucket})`;
}
export function tierBucketTextColor(bucket: TierBucket): string {
  return `var(--lty-${bucket}-text)`;
}
export function tierBucketLabel(bucket: TierBucket): string {
  switch (bucket) {
    case 'enterprise':
      return 'Enterprise';
    case 'gold':
      return 'Gold';
    case 'silver':
      return 'Silver';
    case 'bronze':
      return 'Bronze';
    case 'building':
      return 'Building';
    default:
      return 'No Tier';
  }
}

export function tierColor(level: TierLevel): string {
  return level === 'none' ? 'var(--muted)' : `var(--tier-${level})`;
}
export function tierTextColor(level: TierLevel): string {
  return level === 'none' ? 'var(--muted)' : `var(--tier-${level}-text)`;
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
      return 'No Tier';
  }
}

export function trackCaption(tier: TierResult): string {
  if (tier.status === 'building') {
    return 'Calibration month · next evaluation on the 1st';
  }
  if (tier.track === 'enterprise') {
    if (tier.enterpriseState === 'gold') {
      return `Enterprise · Gold target achieved at ${tier.enterpriseGoldTargetGallons?.toLocaleString('en-US')} gal`;
    }
    if (tier.enterpriseState === 'target_set') {
      return `Enterprise · ${tier.gallonsToNext.toLocaleString('en-US')} gal to manual Gold target`;
    }
    if (tier.enterpriseState === 'normal_billing') {
      return 'Enterprise · Normal billing · no gallon tier';
    }
    return 'Enterprise · 12+ active cards · target not set';
  }
  if (!tier.track) {
    return tier.basis === 'stored'
      ? 'Dormant month · last earned status retained'
      : 'Not evaluated · no closed-month activity';
  }
  const parts = [tier.trackLabel];
  if (tier.segmentLabel) parts.push(tier.segmentLabel);
  const cards = tier.segment ? SEGMENT_META[tier.segment].cards : TRACK_META[tier.track].cards;
  return `${parts.join(' · ')} · ${cards}`;
}
