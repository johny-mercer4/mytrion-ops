/**
 * The loyalty export's ROW MODEL — pure, and the only place the month relationship is stated.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *  THE RULE THIS FILE EXISTS TO ENCODE
 *
 *    Export month M  →  the tier is whatever M-1 earned; the activity reported alongside it is M's.
 *
 *  Pick July and you get each company's July gallons, cards and transactions, tiered by June. That
 *  is not an export-specific rule — it is the program (see `_shared/loyalty.ts`: "the current
 *  month's status is earned from the FULL previous calendar month"). The export simply names the
 *  months explicitly instead of inheriting them from today's date.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * TIER MATH IS NOT REIMPLEMENTED HERE. `toTierInput` maps the month-anchored API row onto the shared
 * resolver's input shape and `resolveTierForRow` / `resolveProjectedTierForRow` do the rest — the
 * same functions the board and Sales' Data Center call. That mapping is the ENTIRE adaptation, it is
 * four lines long, and it is deliberately in one visible place: a second copy of the thresholds (in
 * SQL, on the server, or here) is how two surfaces come to disagree about a client's tier.
 *
 * COLUMNS ARE DATA. `EXPORT_COLUMNS` is walked by the .xlsx writer AND the .csv writer, so the two
 * files always carry the same columns in the same order with the same labels — adding a column is one
 * entry, never an edit in two writers. Picklist columns point at a `PicklistSpec`, which is what makes
 * the dropdown and the fill in Excel and the swatch in the preview one definition.
 */
import {
  resolveProjectedTierForRow,
  resolveTierForRow,
  tierBucketOf,
  tierLabel,
  tierRewards,
  TIER_BUCKET_ORDER,
  type LoyaltyRewardId,
  type TierBucket,
  type TierResult,
} from '../../_shared/loyalty';
import type { LoyaltyMonthClient, LoyaltyMonthRoster } from '../../../api/loyalty';
import { isMarketingPopulation } from './loyaltyPopulation';
import {
  BASIS_PICKLIST,
  BASIS_SPEC,
  ENTERPRISE_PICKLIST,
  ENTERPRISE_SPEC,
  FMT,
  PERK_OFF,
  PERK_ON,
  PERK_SET_CUSTOM,
  PERK_SET_DEFAULT,
  PERK_SET_SPEC,
  PERK_SPEC,
  TIER_PICKLIST,
  TIER_SPEC,
  type BasisLabel,
  type PicklistSpec,
} from './loyaltyExportStyle';

/* ── Scope ───────────────────────────────────────────────────────────────────────────────────── */

/**
 * Which carriers land in the file.
 *
 * `active` is the default and matches the board exactly (see `loyaltyPopulation.ts`). The other two
 * exist because the two questions people actually bring to this export are "who is in the program"
 * (`tiered`) and "reconcile this against the warehouse" (`all`) — and answering the second by
 * hand-deleting rows out of the first is how an export stops being reproducible.
 */
export type LoyaltyExportScope = 'active' | 'tiered' | 'all';

export const SCOPE_LABEL: Record<LoyaltyExportScope, string> = {
  active: 'Active clients',
  tiered: 'Tier holders only',
  all: 'Every carrier',
};
export const SCOPE_HELP: Record<LoyaltyExportScope, string> = {
  active: 'Everyone the board scores — dormant carriers without a tier are left out.',
  tiered: 'Only Enterprise, Gold, Silver and Bronze. Building and No Tier are left out.',
  all: 'The complete warehouse roster, dormant carriers included. For reconciliation.',
};

const TIER_HOLDING: readonly TierBucket[] = ['enterprise', 'gold', 'silver', 'bronze'];

/* ── One carrier, scored ─────────────────────────────────────────────────────────────────────── */

/** A carrier with its resolved tiers — computed once, then filtered, summarised and written. */
export interface ScoredMonthClient {
  client: LoyaltyMonthClient;
  /** The tier in force during the reported month, earned by the basis month. */
  tier: TierResult;
  /** What the reported month's OWN activity projects for the month after it. */
  projected: TierResult;
  bucket: TierBucket;
}

/**
 * The whole adaptation, in one function.
 *
 * `prevMonth` on the shared resolver means "the month that earns the tier" and `thisMonth` means "the
 * month being reported". On the board those happen to be last month and this month; for an export of
 * March they are February and March. Mapping them here rather than renaming the resolver keeps ONE
 * tier implementation for both surfaces.
 */
function toTierInput(client: LoyaltyMonthClient): Parameters<typeof resolveTierForRow>[0] {
  return {
    activeCardsPrevMonth: client.basisActiveCards,
    inNetworkGallonsPrevMonth: client.basisInNetworkGallons,
    activeCardsThisMonth: client.monthActiveCards,
    inNetworkGallonsThisMonth: client.monthInNetworkGallons,
    // Empty for any past month — the server withholds a stored tier it cannot date (see
    // modules/manager/loyaltyMonthRoster.ts), so a dormant historical carrier is not-evaluated.
    lastTierName: client.retainedTierName || undefined,
    loyaltyOverride: client.loyaltyOverride,
  };
}

export function scoreMonthClients(roster: LoyaltyMonthRoster): ScoredMonthClient[] {
  return roster.clients.map((client) => {
    const input = toTierInput(client);
    const tier = resolveTierForRow(input);
    return {
      client,
      tier,
      projected: resolveProjectedTierForRow(input),
      bucket: tierBucketOf(tier),
    };
  });
}

export function applyScope(
  scored: readonly ScoredMonthClient[],
  scope: LoyaltyExportScope,
): ScoredMonthClient[] {
  if (scope === 'all') return [...scored];
  if (scope === 'tiered') return scored.filter((row) => TIER_HOLDING.includes(row.bucket));
  return scored.filter((row) => isMarketingPopulation(row.bucket, row.client.basisActiveCards));
}

/**
 * How many carriers each scope would export. The picker shows all three rather than only the
 * selected one: "Tier holders only" is a very different file from "Every carrier" (hundreds against
 * thousands) and that is the fact that decides which one you want, so it belongs on the control
 * rather than one click away.
 */
export function countByScope(
  scored: readonly ScoredMonthClient[],
): Record<LoyaltyExportScope, number> {
  return {
    active: applyScope(scored, 'active').length,
    tiered: applyScope(scored, 'tiered').length,
    all: scored.length,
  };
}

/* ── The row ─────────────────────────────────────────────────────────────────────────────────── */

/** A cell. `Date` survives to Excel as a real date; the CSV writer renders it as `YYYY-MM-DD`. */
export type ExportCell = string | number | Date | null;

export interface LoyaltyExportRow {
  exportMonth: string;
  basisMonth: string;
  carrierId: string;
  companyName: string;
  agentName: string;
  tier: string;
  tierBasis: BasisLabel;
  track: string;
  segment: string;
  basisActiveCards: number;
  basisInNetworkGallons: number;
  basisTotalGallons: number;
  basisTransactions: number;
  bronzeThreshold: number | null;
  silverThreshold: number | null;
  goldThreshold: number | null;
  nextTier: string;
  gallonsToNextTier: number | null;
  monthActiveCards: number;
  monthInNetworkGallons: number;
  monthTotalGallons: number;
  monthTransactions: number;
  cycleGallons: number;
  /** Reported month vs basis month in-network gallons, as a fraction. Null with no basis to divide by. */
  monthOverBasisChange: number | null;
  projectedTier: string;
  lastTransactionAt: Date | null;
  perkSet: string;
  perksIncluded: number;
  /** The tier-varying reward — 20/25/30% — or '—' when the client does not hold it. */
  moneyCodeLimit: string;
  enterpriseMode: string;
  enterpriseGoldTarget: number | null;
  overrideNote: string;
  overrideUpdatedBy: string;
  overrideUpdatedAt: Date | null;
  accountActiveCards: number;
  declaredTrucks: number | null;
  /** One `Included`/`Not included` per reward, keyed by reward id. */
  perks: Record<LoyaltyRewardId, string>;
}

/** Column groups — the banded band above the header in Excel, and the reading order in both files. */
export type ColumnGroup = 'Period' | 'Client' | 'Tier' | 'Basis month' | 'Reported month' | 'Perks' | 'Exceptions';

export interface ExportColumn {
  key: string;
  label: string;
  width: number;
  group: ColumnGroup;
  align: 'left' | 'right' | 'center';
  numFmt?: string;
  picklist?: PicklistSpec;
  value: (row: LoyaltyExportRow) => ExportCell;
}

const BASIS_LABEL: Record<TierResult['basis'], BasisLabel> = {
  closed_month: BASIS_PICKLIST.closed_month,
  calibration: BASIS_PICKLIST.calibration,
  stored: BASIS_PICKLIST.stored,
  not_evaluated: BASIS_PICKLIST.not_evaluated,
};

/** `YYYY-MM-DD` → a UTC-anchored Date. Local midnight would shift the day by one in ExcelJS. */
function utcDay(iso: string | null): Date | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function utcInstant(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * The canonical reward order and titles, taken from the shared program definition rather than
 * restated. `tierRewards('gold')` returns every reward (Gold holds them all) in definition order, so
 * the perk columns cannot drift out of step with the program if a reward is added or renamed.
 */
const REWARD_COLUMNS = tierRewards('gold').map((reward) => ({
  id: reward.id,
  title: reward.title,
}));

export function buildExportRow(scored: ScoredMonthClient, roster: LoyaltyMonthRoster): LoyaltyExportRow {
  const { client, tier, projected, bucket } = scored;
  const override = client.loyaltyOverride;
  const rewards = tierRewards(tier.level, override?.enabledRewardIds ?? null);
  const moneyCode = rewards.find((reward) => reward.id === 'money_code_limit');
  const basis = client.basisInNetworkGallons;
  return {
    exportMonth: roster.monthLabel,
    basisMonth: roster.basisMonthLabel,
    carrierId: client.carrierId,
    companyName: client.companyName,
    agentName: client.agentName,
    tier: TIER_PICKLIST[bucket],
    tierBasis: BASIS_LABEL[tier.basis],
    track: tier.trackLabel || '—',
    segment: tier.segmentLabel ?? '—',
    basisActiveCards: client.basisActiveCards,
    basisInNetworkGallons: client.basisInNetworkGallons,
    basisTotalGallons: client.basisTotalGallons,
    basisTransactions: client.basisTransactions,
    bronzeThreshold: tier.thresholds?.bronze ?? null,
    silverThreshold: tier.thresholds?.silver ?? null,
    goldThreshold: tier.thresholds?.gold ?? null,
    nextTier: tier.nextLevel ? tierLabel(tier.nextLevel) : '—',
    gallonsToNextTier: tier.nextLevel ? tier.gallonsToNext : null,
    monthActiveCards: client.monthActiveCards,
    monthInNetworkGallons: client.monthInNetworkGallons,
    monthTotalGallons: client.monthTotalGallons,
    monthTransactions: client.monthTransactions,
    cycleGallons: client.cycleGallons,
    monthOverBasisChange: basis > 0 ? (client.monthInNetworkGallons - basis) / basis : null,
    projectedTier: TIER_PICKLIST[tierBucketOf(projected)],
    lastTransactionAt: utcDay(client.lastTransactionAt),
    perkSet: override?.enabledRewardIds != null ? PERK_SET_CUSTOM : PERK_SET_DEFAULT,
    perksIncluded: rewards.filter((reward) => reward.active).length,
    moneyCodeLimit: moneyCode?.active ? moneyCode.value : '—',
    enterpriseMode: override?.enterpriseMode
      ? ENTERPRISE_PICKLIST[override.enterpriseMode]
      : ENTERPRISE_PICKLIST.none,
    enterpriseGoldTarget: override?.enterpriseGoldTargetGallons ?? null,
    overrideNote: override?.note ?? '',
    overrideUpdatedBy: override?.updatedBy ?? '',
    overrideUpdatedAt: utcInstant(override?.updatedAt),
    accountActiveCards: client.activeCards,
    declaredTrucks: client.trucks,
    perks: Object.fromEntries(
      rewards.map((reward) => [reward.id, reward.active ? PERK_ON : PERK_OFF]),
    ) as Record<LoyaltyRewardId, string>,
  };
}

const col = (
  key: keyof LoyaltyExportRow,
  label: string,
  width: number,
  group: ColumnGroup,
  extra: Partial<Omit<ExportColumn, 'key' | 'label' | 'width' | 'group'>> = {},
): ExportColumn => ({
  key,
  label,
  width,
  group,
  align: extra.numFmt ? 'right' : 'left',
  value: (row) => row[key] as ExportCell,
  ...extra,
});

/**
 * The file's columns, in reading order: WHEN, WHO, the tier and why, the month that earned it, the
 * month being reported, the perks that follow from it, then the manual exceptions and raw account
 * context. Someone opening this cold should be able to read a row left to right as a sentence.
 */
export const EXPORT_COLUMNS: ExportColumn[] = [
  col('exportMonth', 'Reported Month', 15, 'Period'),
  col('basisMonth', 'Tier Basis Month', 16, 'Period'),

  col('carrierId', 'Carrier ID', 12, 'Client'),
  col('companyName', 'Company', 34, 'Client'),
  col('agentName', 'Agent', 22, 'Client'),

  col('tier', 'Tier', 13, 'Tier', { picklist: TIER_SPEC, align: 'center' }),
  col('tierBasis', 'How It Was Earned', 30, 'Tier', { picklist: BASIS_SPEC }),
  col('track', 'Track', 17, 'Tier'),
  col('segment', 'Fleet Segment', 14, 'Tier'),

  col('basisActiveCards', 'Basis Transacting Cards', 21, 'Basis month', { numFmt: FMT.count }),
  col('basisInNetworkGallons', 'Basis In-Network Gallons', 22, 'Basis month', { numFmt: FMT.gallons }),
  col('basisTotalGallons', 'Basis Total Gallons', 19, 'Basis month', { numFmt: FMT.gallons }),
  col('basisTransactions', 'Basis Transactions', 18, 'Basis month', { numFmt: FMT.count }),
  col('bronzeThreshold', 'Bronze Threshold', 17, 'Basis month', { numFmt: FMT.gallons }),
  col('silverThreshold', 'Silver Threshold', 17, 'Basis month', { numFmt: FMT.gallons }),
  col('goldThreshold', 'Gold Threshold', 15, 'Basis month', { numFmt: FMT.gallons }),
  col('nextTier', 'Next Tier', 11, 'Basis month', { align: 'center' }),
  col('gallonsToNextTier', 'Gallons To Next Tier', 20, 'Basis month', { numFmt: FMT.gallons }),

  col('monthActiveCards', 'Month Transacting Cards', 22, 'Reported month', { numFmt: FMT.count }),
  col('monthInNetworkGallons', 'Month In-Network Gallons', 23, 'Reported month', { numFmt: FMT.gallons }),
  col('monthTotalGallons', 'Month Total Gallons', 20, 'Reported month', { numFmt: FMT.gallons }),
  col('monthTransactions', 'Month Transactions', 18, 'Reported month', { numFmt: FMT.count }),
  col('cycleGallons', 'Billing Cycle Gallons', 20, 'Reported month', { numFmt: FMT.gallons }),
  col('monthOverBasisChange', 'In-Network Change', 18, 'Reported month', { numFmt: FMT.percent }),
  col('projectedTier', 'Projected Next Tier', 18, 'Reported month', {
    picklist: TIER_SPEC,
    align: 'center',
  }),
  col('lastTransactionAt', 'Last Transaction', 16, 'Reported month', { numFmt: FMT.date }),

  ...REWARD_COLUMNS.map(
    (reward): ExportColumn => ({
      key: `perk_${reward.id}`,
      label: reward.title,
      width: Math.max(16, Math.min(24, reward.title.length + 4)),
      group: 'Perks',
      align: 'center',
      picklist: PERK_SPEC,
      value: (row) => row.perks[reward.id] ?? PERK_OFF,
    }),
  ),
  col('moneyCodeLimit', 'Money Code Limit', 17, 'Perks', { align: 'center' }),
  col('perksIncluded', 'Perks Included', 14, 'Perks', { numFmt: FMT.count }),
  col('perkSet', 'Perk Source', 18, 'Perks', { picklist: PERK_SET_SPEC }),

  col('enterpriseMode', 'Enterprise Mode', 17, 'Exceptions', { picklist: ENTERPRISE_SPEC }),
  col('enterpriseGoldTarget', 'Enterprise Gold Target', 21, 'Exceptions', { numFmt: FMT.gallons }),
  col('overrideNote', 'Exception Note', 40, 'Exceptions'),
  col('overrideUpdatedBy', 'Exception Set By', 20, 'Exceptions'),
  col('overrideUpdatedAt', 'Exception Set At', 17, 'Exceptions', { numFmt: FMT.date }),
  col('accountActiveCards', 'Account Active Cards', 20, 'Exceptions', { numFmt: FMT.count }),
  col('declaredTrucks', 'Declared Trucks', 15, 'Exceptions', { numFmt: FMT.count }),
];

/* ── Summary ─────────────────────────────────────────────────────────────────────────────────── */

export interface BucketSummary {
  bucket: TierBucket;
  label: string;
  count: number;
  /** Share of the exported population, 0–1. */
  share: number;
  basisInNetworkGallons: number;
  monthInNetworkGallons: number;
}

export interface LoyaltyExportSummary {
  carriers: number;
  tierHolders: number;
  buckets: BucketSummary[];
  basisInNetworkGallons: number;
  monthInNetworkGallons: number;
  monthTotalGallons: number;
  /** Carriers carrying a manual exception — every one of them needs the note read. */
  exceptions: number;
}

export function summariseExport(rows: readonly ScoredMonthClient[]): LoyaltyExportSummary {
  const buckets = TIER_BUCKET_ORDER.map((bucket) => {
    const members = rows.filter((row) => row.bucket === bucket);
    return {
      bucket,
      label: TIER_PICKLIST[bucket],
      count: members.length,
      share: rows.length > 0 ? members.length / rows.length : 0,
      basisInNetworkGallons: members.reduce((sum, r) => sum + r.client.basisInNetworkGallons, 0),
      monthInNetworkGallons: members.reduce((sum, r) => sum + r.client.monthInNetworkGallons, 0),
    };
  });
  return {
    carriers: rows.length,
    tierHolders: rows.filter((row) => TIER_HOLDING.includes(row.bucket)).length,
    buckets,
    basisInNetworkGallons: rows.reduce((sum, r) => sum + r.client.basisInNetworkGallons, 0),
    monthInNetworkGallons: rows.reduce((sum, r) => sum + r.client.monthInNetworkGallons, 0),
    monthTotalGallons: rows.reduce((sum, r) => sum + r.client.monthTotalGallons, 0),
    exceptions: rows.filter((row) => row.client.loyaltyOverride !== null).length,
  };
}

/** Everything both writers need, resolved once so the .xlsx and the .csv can never disagree. */
export interface LoyaltyExportPayload {
  roster: LoyaltyMonthRoster;
  scope: LoyaltyExportScope;
  scored: ScoredMonthClient[];
  rows: LoyaltyExportRow[];
  summary: LoyaltyExportSummary;
}

export function buildExportPayload(
  roster: LoyaltyMonthRoster,
  scope: LoyaltyExportScope,
): LoyaltyExportPayload {
  const scored = applyScope(scoreMonthClients(roster), scope);
  return {
    roster,
    scope,
    scored,
    rows: scored.map((row) => buildExportRow(row, roster)),
    summary: summariseExport(scored),
  };
}

/** `Loyalty_Tiers_2026-07_Active-clients` — month first so a folder of them sorts chronologically. */
export function exportFileStem(roster: LoyaltyMonthRoster, scope: LoyaltyExportScope): string {
  return `Loyalty_Tiers_${roster.month.slice(0, 7)}_${SCOPE_LABEL[scope].replace(/\s+/g, '-')}`;
}
