/**
 * Manager Mytrion → Referral bonuses: the DECLARATIVE spec for the four bonus logics.
 *
 * Source of truth is the `Referral Bonus Calculation Types — CRM Automation Reference` PDF. This
 * module holds only data — rates, thresholds, recipients, eligible fuel codes and the Zoho picklist
 * mapping. No aggregation happens here; both the calculation engine and Manager preview read these
 * values so a rate or fuel-code change is made once rather than repeated through SQL and React.
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

/** Type 1 — Gallons (Legacy): $0.01 per In Station eligible gallon, every month, to the parent. */
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
 * Type 2 — Swipes (Legacy): $50 per card whose first eligible fuel lands in the month.
 *
 * Billing 2026-08 (Al Aziz REF-000322 / Logixpress 5804841): July is 8 new swipes, which is the
 * first-use count on the parent fleet plus the referred child deal — not the peak-to-date of
 * monthly distinct-card counts (that rule paid 0 because July's 16 cards did not beat May/June's
 * 17). Station type does not apply; In Station filters gallons only.
 *
 *   swipes(window) = count of cards whose min(eligible transaction_date) is inside the window
 *
 * Rate is still $50 per swipe, fuel is still ULSD+ULSR. This matches the Sales dashboard's
 * `new_cards_*` idea on the bonus fuel set. It is not `count(distinct transaction_id)` and not
 * "cards used this month".
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
export const ONE_TIME_BONUS_TYPES: readonly ReferralBonusType[] = [
  'gallons_parent',
  'gallons_child',
];

/** True when a type may exist at most once per child and economic carrier, in any month. */
export function isOneTimeBonusType(type: ReferralBonusType): boolean {
  return ONE_TIME_BONUS_TYPES.includes(type);
}

/**
 * Map a Zoho `Calculation` picklist value to the bonus type it selects — ONE value, ONE type.
 *
 * This used to expand EITHER legacy value into BOTH legacy types, on the reading that the PDF
 * describes types 1 and 2 as concurrent monthly payouts. The live data says otherwise: `Calculation`
 * is a single-select picklist and the 2026-07-28 import deliberately split the roster 615
 * 'Swipes (Legacy)' vs 50 'Gallons (Legacy)'. Under the old expansion those two values were
 * indistinguishable in effect, which would make the split meaningless — and it silently paid the
 * per-gallon bonus on top of the per-swipe one for 615 referrers (a verified $508.92 extra on one
 * carrier's June alone).
 *
 * Unknown / unset (`-None-`, null, an unrecognised value) selects nothing.
 *
 * The full picklist, verbatim and identical on both modules: '-None-', 'Swipes (Legacy)',
 * 'Gallons (Legacy)', 'Gallons (Parent)', 'Gallons (Child)'.
 *
 * ⚠ 'Gallons (Parent)' → type 3 and 'Gallons (Child)' → type 4 is INFERRED from the recipient word.
 * The labels encode neither the 500 vs 1,000 threshold nor "one-time", and ZERO records use either
 * value today, so that binding is unconfirmed by data — see WORKING_NOTES 2026-07-29.
 */
export function bonusTypesForCalculation(value: string | null | undefined): ReferralBonusType[] {
  const v = (value ?? '').trim();
  if (!v || v === '-None-') return [];
  const spec = REFERRAL_BONUS_SPECS.find((s) => s.zohoPicklistValue === v);
  return spec ? [spec.type] : [];
}
