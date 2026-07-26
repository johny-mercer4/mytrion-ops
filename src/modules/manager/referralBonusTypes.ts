/**
 * Manager Mytrion → Referral bonuses: the DECLARATIVE spec for the four bonus logics.
 *
 * Source of truth is the `Referral Bonus Calculation Types — CRM Automation Reference` PDF. This
 * module holds only data — rates, thresholds, recipients, eligible fuel codes and the Zoho picklist
 * mapping. No aggregation happens here; the calculation engine (not yet built) reads these values so
 * that changing a rate or a fuel-code list is a one-line edit in ONE place rather than a hunt
 * through SQL strings.
 */
import type {
  ReferralBonusRecipient,
  ReferralBonusType,
} from '../../db/schema/mytrion_referral_bonuses.js';

/**
 * Eligible fuel item codes, exactly as the PDF specifies them.
 *
 * ⚠️ VERIFIED DATA GAP (2026-07-27) — `octane.mart_transaction_line_items.line_item_category`
 * contains NO literal `'DSL'` row. The diesel-family codes that DO exist are:
 *
 *     ULSD  681,641 rows / 63.0M gal      DSL1  1,202 rows / 31.8k gal
 *     ULSR   36,363 rows /  0.66M gal     CDSL  1,152 rows / 47.1k gal
 *     FUEL    9,017 rows /  0.74M gal     BDSL    599 rows / 19.1k gal
 *                                         CBDL      1 row  /   55 gal
 *
 * So TYPE_3/TYPE_4's `'DSL'` entry currently matches zero transactions and those two bonuses behave
 * identically to the legacy pair. Whether `'DSL'` should expand to {DSL1, CDSL, BDSL, CBDL} is a
 * business decision that has NOT been made — do not silently expand it here. Raise it with BA/Admin
 * and change this constant when answered.
 *
 * Separately: 288,451 rows (19.4M gallons, ~23% of all volume) carry a NULL `line_item_category`.
 * The PDF filters by item code, so those rows are excluded. Note this diverges from the Sales
 * Mytrion dashboard, which applies no fuel filter at all (servercrm agentDwh.js `base` CTE sums
 * `line_item_fuel_quantity` unfiltered) — the two surfaces will legitimately disagree on gallons.
 */
export const LEGACY_FUEL_CODES = ['ULSD', 'ULSR'] as const;
export const NEW_LOGIC_FUEL_CODES = ['ULSD', 'DSL', 'ULSR'] as const;

/** Declarative definition of one bonus logic. */
export interface ReferralBonusSpec {
  type: ReferralBonusType;
  /** PDF section number (1-4). */
  ordinal: number;
  label: string;
  /** Who receives the money. Type 4 is the documented exception that pays the child. */
  recipient: ReferralBonusRecipient;
  /** Fuel item codes whose volume counts. */
  fuelCodes: readonly string[];
  /** Recurs every month (legacy types) vs fires exactly once (new-logic types). */
  recurring: boolean;
  /** USD per gallon (gallons_legacy) or per award (all others). */
  rateUsd: number;
  /** Cumulative eligible gallons that trigger a one-time award; null for recurring types. */
  thresholdGallons: number | null;
  /** The `Calculation` picklist value on the Zoho referral modules that selects this logic. */
  zohoPicklistValue: string;
}

/** Type 1 — Gallons (Legacy): $0.01 per eligible gallon, every month, to the parent. */
const GALLONS_LEGACY: ReferralBonusSpec = {
  type: 'gallons_legacy',
  ordinal: 1,
  label: 'Gallons (Legacy)',
  recipient: 'parent',
  fuelCodes: LEGACY_FUEL_CODES,
  recurring: true,
  rateUsd: 0.01,
  thresholdGallons: null,
  zohoPicklistValue: 'Gallons (Legacy)',
};

/**
 * Type 2 — Swipes (Legacy): $50 per unique NEW CARD, every month, to the parent.
 *
 * "Swipe" resolves to the Sales Mytrion dashboard's NEW-CARD metric: a card counts in the month its
 * first-ever transaction falls, i.e. servercrm agentDwh.js
 * `MIN(transaction_date) OVER (PARTITION BY carrier_id, card_number)`, with `card_number IS NOT
 * NULL`. Note the dashboard field literally named `swipes_*` is `COUNT(DISTINCT transaction_id)`
 * (transactions) — that is NOT this metric; the one to mirror is `new_cards_*`.
 */
const SWIPES_LEGACY: ReferralBonusSpec = {
  type: 'swipes_legacy',
  ordinal: 2,
  label: 'Swipes (Legacy)',
  recipient: 'parent',
  fuelCodes: LEGACY_FUEL_CODES,
  recurring: true,
  rateUsd: 50,
  thresholdGallons: null,
  zohoPicklistValue: 'Swipes (Legacy)',
};

/** Type 3 — Gallons (New Logic): one-time $50 to the PARENT at 500 cumulative gallons. */
const GALLONS_PARENT: ReferralBonusSpec = {
  type: 'gallons_parent',
  ordinal: 3,
  label: 'Gallons (Parent)',
  recipient: 'parent',
  fuelCodes: NEW_LOGIC_FUEL_CODES,
  recurring: false,
  rateUsd: 50,
  thresholdGallons: 500,
  zohoPicklistValue: 'Gallons (Parent)',
};

/**
 * Type 4 — Gallons (New Logic 2): one-time $50 to the CHILD at 1,000 cumulative gallons.
 * The only logic whose payout does not go to the parent referrer.
 */
const GALLONS_CHILD: ReferralBonusSpec = {
  type: 'gallons_child',
  ordinal: 4,
  label: 'Gallons (Child)',
  recipient: 'child',
  fuelCodes: NEW_LOGIC_FUEL_CODES,
  recurring: false,
  rateUsd: 50,
  thresholdGallons: 1000,
  zohoPicklistValue: 'Gallons (Child)',
};

/** Every bonus logic, in PDF order. */
export const REFERRAL_BONUS_SPECS: readonly ReferralBonusSpec[] = [
  GALLONS_LEGACY,
  SWIPES_LEGACY,
  GALLONS_PARENT,
  GALLONS_CHILD,
];

/** Lookup by ledger type. */
export const REFERRAL_BONUS_SPEC_BY_TYPE: Readonly<Record<ReferralBonusType, ReferralBonusSpec>> = {
  gallons_legacy: GALLONS_LEGACY,
  swipes_legacy: SWIPES_LEGACY,
  gallons_parent: GALLONS_PARENT,
  gallons_child: GALLONS_CHILD,
};

/** The one-time types — the pair guarded by the partial unique index on the ledger. */
export const ONE_TIME_BONUS_TYPES: readonly ReferralBonusType[] = ['gallons_parent', 'gallons_child'];

/** True when a type may exist at most once per child, in any month. */
export function isOneTimeBonusType(type: ReferralBonusType): boolean {
  return ONE_TIME_BONUS_TYPES.includes(type);
}

/**
 * Map a Zoho `Calculation` picklist value to the bonus types it selects.
 *
 * The picklist is single-select, but the PDF describes types 1 and 2 as concurrent monthly payouts,
 * so a child on either legacy value accrues BOTH legacy bonuses. Unknown / unset (`-None-`, null)
 * selects nothing — as of 2026-07-27 `Calculation` is null on every record in both modules and will
 * be populated by BA/Admin.
 */
export function bonusTypesForCalculation(value: string | null | undefined): ReferralBonusType[] {
  const v = (value ?? '').trim();
  if (!v || v === '-None-') return [];
  if (v === 'Gallons (Legacy)' || v === 'Swipes (Legacy)') {
    return ['gallons_legacy', 'swipes_legacy'];
  }
  const spec = REFERRAL_BONUS_SPECS.find((s) => s.zohoPicklistValue === v);
  return spec ? [spec.type] : [];
}
