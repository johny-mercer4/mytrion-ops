/**
 * The export's PICKLIST vocabulary and its colours — one definition, three consumers.
 *
 * A "picklist" here means the same thing it means in Zoho: a column whose cell may only hold one of a
 * short, fixed set of values, and where each value carries its own colour. Three surfaces have to
 * agree on that set:
 *
 *   • the .xlsx writer — paints the cell and attaches the dropdown (`dataValidation` type `list`);
 *   • the CSV writer   — emits the same label text, so the two files reconcile column for column;
 *   • the export modal — previews the distribution with the same swatch the spreadsheet will use.
 *
 * WHY THE COLOURS ARE NOT THE APP'S `--lty-*` TOKENS. The board's palette is tuned for a dark glass
 * surface: `--lty-silver: #c3cfdd` is a near-white fill that disappears on a white worksheet, and
 * every `-text` variant assumes a dark backdrop. A spreadsheet is a light, printed medium, so each
 * bucket gets a light TINT plus a dark INK of the same hue — the same hue relationships as the board
 * (gold amber, silver cool grey, bronze true copper, building orange, enterprise sky), rendered for
 * paper. Bronze stays browner than building for exactly the reason loyalty.css gives: at low tint an
 * orange bronze and an orange "working toward bronze" are one colour.
 *
 * ARGB, not RGB — ExcelJS wants `FFRRGGBB` and silently renders a 6-digit value as the wrong colour.
 */
import type { TierBucket } from '../../_shared/loyalty';

/**
 * A fill/ink pair, in both encodings the two consumers need. `ink` is ≥ 4.5:1 on `fill`, so every
 * picklist cell reads on paper.
 *
 * Both forms are stored rather than converted at the call site: an `argb.replace('FF', '#')` in a
 * component is string surgery on a colour, and it is wrong the first time a value legitimately
 * contains `FF` anywhere but the alpha prefix.
 */
export interface Swatch {
  /** ExcelJS fill, `FFRRGGBB`. */
  fill: string;
  /** ExcelJS font colour, `FFRRGGBB`. */
  ink: string;
  /** The same fill as CSS, for the in-app preview chip. */
  css: string;
  /** The same ink as CSS. */
  inkCss: string;
}

const swatch = (fill: string, ink: string): Swatch => ({
  fill: `FF${fill}`,
  ink: `FF${ink}`,
  css: `#${fill}`,
  inkCss: `#${ink}`,
});

/** Neutral chrome: header band, banding, rules, muted ink. */
export const SHEET = {
  headFill: 'FF15233B',
  headInk: 'FFFFFFFF',
  band: 'FFF8FAFC',
  rule: 'FFE2E8F0',
  ink: 'FF0F172A',
  body: 'FF334155',
  muted: 'FF64748B',
  warn: 'FFB45309',
  warnFill: 'FFFEF3C7',
  font: 'Arial',
} as const;

/** Number formats. Gallons carry two decimals: the tier thresholds are exact, so the file is too. */
export const FMT = {
  gallons: '#,##0.00',
  count: '#,##0',
  percent: '+0.0%;-0.0%;"flat"',
  date: 'mmm d, yyyy',
} as const;

/* ── Tier level ──────────────────────────────────────────────────────────────────────────────── */

/** The picklist labels, in program order. Identical strings to the board's `tierBucketLabel`. */
export const TIER_PICKLIST: Record<TierBucket, string> = {
  enterprise: 'Enterprise',
  gold: 'Gold',
  silver: 'Silver',
  bronze: 'Bronze',
  building: 'Building',
  idle: 'No Tier',
};

export const TIER_SWATCH: Record<TierBucket, Swatch> = {
  enterprise: swatch('DDF1FD', '0B5878'),
  gold: swatch('FCF0CE', '8A5A0B'),
  // Cool and light, kept clearly bluer than `idle`'s hueless grey so the two never collapse.
  silver: swatch('E6ECF4', '44546B'),
  // True copper — browner than `building`, per the board's palette note.
  bronze: swatch('F3E1D1', '7A431C'),
  building: swatch('FDE8D3', '9A4210'),
  idle: swatch('F1F4F8', '667283'),
};

/* ── Perk inclusion ──────────────────────────────────────────────────────────────────────────── */

export const PERK_ON = 'Included';
export const PERK_OFF = 'Not included';
export const PERK_SWATCH: Record<typeof PERK_ON | typeof PERK_OFF, Swatch> = {
  [PERK_ON]: swatch('DCF5E3', '13603A'),
  [PERK_OFF]: swatch('F4F6F9', '8A94A3'),
};

/* ── How the tier was arrived at ─────────────────────────────────────────────────────────────── */

/**
 * `TierResult.basis`, said in business language. This column is what makes a zero-gallon Gold row
 * defensible six months later: it names WHY the tier reads the way it does.
 */
export const BASIS_PICKLIST = {
  closed_month: 'Earned in basis month',
  calibration: 'Calibration (no basis month activity)',
  stored: 'Retained from warehouse',
  not_evaluated: 'Not evaluated',
} as const;
export type BasisLabel = (typeof BASIS_PICKLIST)[keyof typeof BASIS_PICKLIST];

export const BASIS_SWATCH: Record<BasisLabel, Swatch> = {
  [BASIS_PICKLIST.closed_month]: swatch('EAF1F8', '2C4A6B'),
  [BASIS_PICKLIST.calibration]: swatch('FDE8D3', '9A4210'),
  [BASIS_PICKLIST.stored]: swatch('EDE7FB', '55338F'),
  [BASIS_PICKLIST.not_evaluated]: swatch('F1F4F8', '667283'),
};

/* ── Perk set: automatic or a documented exception ───────────────────────────────────────────── */

export const PERK_SET_DEFAULT = 'Tier default';
export const PERK_SET_CUSTOM = 'Manual exception';
export const PERK_SET_SWATCH: Record<string, Swatch> = {
  [PERK_SET_DEFAULT]: swatch('F1F4F8', '667283'),
  [PERK_SET_CUSTOM]: swatch('FBE6F0', '8C2159'),
};

/* ── Enterprise qualification mode ───────────────────────────────────────────────────────────── */

export const ENTERPRISE_PICKLIST = {
  none: '—',
  normal_billing: 'Normal billing',
  volume_target: 'Volume target',
} as const;
export const ENTERPRISE_SWATCH: Record<string, Swatch> = {
  [ENTERPRISE_PICKLIST.none]: swatch('F4F6F9', '8A94A3'),
  [ENTERPRISE_PICKLIST.normal_billing]: swatch('EAF1F8', '2C4A6B'),
  [ENTERPRISE_PICKLIST.volume_target]: swatch('DDF1FD', '0B5878'),
};

/**
 * Every picklist column, keyed by the export row field it validates.
 *
 * The writer walks this to attach dropdowns and fills, so adding a picklist column is one entry here
 * plus the field on the row — never a second switch statement in the .xlsx code. `values` is also the
 * dropdown's allowed set, so a value the swatch map does not know about is a build-time type error
 * rather than an unstyled cell.
 */
export interface PicklistSpec {
  values: readonly string[];
  swatches: Record<string, Swatch>;
}

export const TIER_ORDERED_LABELS: readonly string[] = [
  TIER_PICKLIST.enterprise,
  TIER_PICKLIST.gold,
  TIER_PICKLIST.silver,
  TIER_PICKLIST.bronze,
  TIER_PICKLIST.building,
  TIER_PICKLIST.idle,
];

const tierSwatchesByLabel: Record<string, Swatch> = Object.fromEntries(
  (Object.keys(TIER_PICKLIST) as TierBucket[]).map((bucket) => [
    TIER_PICKLIST[bucket],
    TIER_SWATCH[bucket],
  ]),
);

export const TIER_SPEC: PicklistSpec = {
  values: TIER_ORDERED_LABELS,
  swatches: tierSwatchesByLabel,
};
export const PERK_SPEC: PicklistSpec = {
  values: [PERK_ON, PERK_OFF],
  swatches: PERK_SWATCH,
};
export const BASIS_SPEC: PicklistSpec = {
  values: Object.values(BASIS_PICKLIST),
  swatches: BASIS_SWATCH as Record<string, Swatch>,
};
export const PERK_SET_SPEC: PicklistSpec = {
  values: [PERK_SET_DEFAULT, PERK_SET_CUSTOM],
  swatches: PERK_SET_SWATCH,
};
export const ENTERPRISE_SPEC: PicklistSpec = {
  values: Object.values(ENTERPRISE_PICKLIST),
  swatches: ENTERPRISE_SWATCH,
};

/** Excel's inline list formula is one quoted, comma-joined string and caps at 255 characters. */
export function listFormula(spec: PicklistSpec): string {
  return `"${spec.values.join(',')}"`;
}
