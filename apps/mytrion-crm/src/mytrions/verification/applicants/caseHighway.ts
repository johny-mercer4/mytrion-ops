/**
 * Phase 8 — carrier operational review in Highway. Carrier applicants only.
 *
 * MANUAL, AND SHAPED FOR THE PARSER THAT COMES LATER. There is no Highway API, so every figure here is
 * read off Highway by the agent and typed in. What the field names are NOT arbitrary about is their
 * mapping: each one is named after the column that already exists in the warehouse's Highway snapshot
 * (`verification_public."Highway_carriers"` — `safety_csa_percentile`, `authority_common_age_months`,
 * `equipment_observed_power_units`, `authority_eld`, `bluewire_score`, and the rest), so wiring a
 * parser to it later is a mapping rather than a redesign of this pane.
 *
 * The warehouse copy is deliberately NOT read today: measured, it is a one-off load of 975 rows that
 * matched 0 of our 20 carrier DOTs, so treating it as a source would return blanks and look like a
 * carrier with no Highway presence.
 *
 * WHERE IT IS STORED. The underwriting summary the SOP enumerates already reads Phase 8's `findings`
 * for its "Highway findings" line (`buildSummary`), and nothing has ever written it — so that line has
 * always been blank. These go there, which is why no new table is needed.
 *
 * THE SOP'S OWN CAVEAT IS LOAD-BEARING: "Fleet size and requested cards are risk indicators, but do
 * not automatically cap the LOC for legitimate non-carrier or financially strong applicants." So the
 * cards-against-fleet comparison below is an INDICATOR and never a gate — see `cardsVsFleet`.
 */
import type { ReviewField, ReviewValues } from './caseCreditBanking';

/** OK / concern / missing, the same three the banking judgement rows use. */
export type HighwayMark = 'ok' | 'concern' | 'missing';

/** The phase decision: the SOP's two branches, plus the honest not-yet. */
export type HighwayVerdict = 'consistent' | 'discrepancy';

export interface HighwayMarks {
  checks: Record<string, HighwayMark>;
  verdict: HighwayVerdict | null;
}

export const EMPTY_HIGHWAY_MARKS: HighwayMarks = { checks: {}, verdict: null };

/**
 * The SOP's eleven review items, minus the last — "overall consistency" is the VERDICT, not a row, and
 * listing it twice would let a reviewer mark it OK and then rule discrepancy.
 */
export interface HighwayCheck {
  id: string;
  label: string;
  /** What the agent is looking at in Highway, when the label alone is not enough. */
  hint?: string;
}

export const HIGHWAY_CHECKS: readonly HighwayCheck[] = [
  { id: 'safety', label: 'Safety score', hint: 'Rating, CSA percentile and the trend on it' },
  { id: 'alerts', label: 'Alerts and insights', hint: 'Highway’s own flags, and the Bluewire score' },
  { id: 'fleet', label: 'Fleet / truck count', hint: 'Observed against reported power units' },
  { id: 'logbook', label: 'Logbook connection and activity', hint: 'ELD connected, and recently reporting' },
  { id: 'connected', label: 'Number of connected trucks' },
  { id: 'insurance', label: 'Insurance status and compliance' },
  { id: 'history', label: 'MC/DOT operating history' },
  { id: 'authority_age', label: 'Authority age' },
  { id: 'activity', label: 'Current operating activity' },
];

/**
 * The measurable half, named after the Highway columns that hold each one.
 *
 * `pct` is used for the CSA percentile and the Bluewire confidence because both are 0-100 figures a
 * reviewer reads as percentages, even though Highway stores one as a numeric and the other as a
 * percent — the input is the same shape either way.
 */
export const HIGHWAY_FIELDS: readonly ReviewField[] = [
  { id: 'safetyCsaPercentile', label: 'CSA percentile', kind: 'pct' },
  { id: 'safetyTotalViolations', label: 'Total violations', kind: 'count' },
  { id: 'bluewireScore', label: 'Bluewire score', kind: 'count' },
  {
    id: 'observedPowerUnits',
    label: 'Power units observed',
    kind: 'count',
    hint: 'What Highway sees. Compared with the reported figure below and with the cards requested.',
  },
  { id: 'reportedPowerUnits', label: 'Power units reported', kind: 'count' },
  { id: 'connectedTrucks', label: 'Trucks connected', kind: 'count' },
  { id: 'authorityAgeMonths', label: 'Authority age', kind: 'months' },
  { id: 'insuranceLimit', label: 'Insurance limit', kind: 'money' },
];

export const HIGHWAY_SAFETY_TRENDS = [
  { value: 'improving' as const, label: 'Improving' },
  { value: 'stable' as const, label: 'Stable' },
  { value: 'deteriorating' as const, label: 'Deteriorating' },
];

export const HIGHWAY_ACTIVITY = [
  { value: 'active' as const, label: 'Active' },
  { value: 'limited' as const, label: 'Limited' },
  { value: 'none' as const, label: 'None observed' },
];

export const HIGHWAY_ELD = [
  { value: 'connected' as const, label: 'Connected' },
  { value: 'not_connected' as const, label: 'Not connected' },
  { value: 'unknown' as const, label: 'Not shown' },
];

export type HighwaySafetyTrend = 'improving' | 'stable' | 'deteriorating';
export type HighwayActivity = 'active' | 'limited' | 'none';
export type HighwayEld = 'connected' | 'not_connected' | 'unknown';

/**
 * Cards requested against the fleet Highway can actually see.
 *
 * AN INDICATOR, NEVER A CAP. The SOP says so in as many words, and it is the single easiest thing on
 * this phase to implement wrongly: a legitimate non-carrier, or a financially strong applicant, may
 * request more cards than they have trucks for perfectly good reasons. So this returns a reading for a
 * human and takes no part in `highwayCanPass`.
 *
 * Null when either side is unknown — a ratio against an unrecorded fleet is not a finding.
 */
export function cardsVsFleet(
  cardsRequested: number | null | undefined,
  observedPowerUnits: string | undefined,
): { cards: number; units: number; excess: number; note: string } | null {
  if (cardsRequested === null || cardsRequested === undefined) return null;
  const units = Number((observedPowerUnits ?? '').trim());
  if (!Number.isFinite(units) || (observedPowerUnits ?? '').trim() === '') return null;
  const excess = cardsRequested - units;
  return {
    cards: cardsRequested,
    units,
    excess,
    note:
      excess <= 0
        ? `${cardsRequested} card${cardsRequested === 1 ? '' : 's'} against ${units} power unit${units === 1 ? '' : 's'} — within the fleet Highway sees.`
        : `${cardsRequested} card${cardsRequested === 1 ? '' : 's'} against ${units} power unit${units === 1 ? '' : 's'} — ${excess} more card${excess === 1 ? '' : 's'} than trucks. An indicator to weigh, not a cap.`,
  };
}

/**
 * Whether Phase 8 may be passed.
 *
 * Every SOP row ruled on, and the verdict `consistent`. A row marked `missing` does NOT block —
 * Highway simply not showing a figure is a real state, and the SOP's failure branch is a SUSPICIOUS
 * DISCREPANCY, which is what the verdict is for. `discrepancy` takes the manager door instead.
 */
export function highwayCanPass(marks: HighwayMarks): boolean {
  if (marks.verdict !== 'consistent') return false;
  return HIGHWAY_CHECKS.every((c) => marks.checks[c.id] !== undefined);
}

/** How many rows have been ruled on, for the pane's progress line. */
export function highwayRuled(marks: HighwayMarks): number {
  return HIGHWAY_CHECKS.filter((c) => marks.checks[c.id] !== undefined).length;
}

/** The three tones `.va-id-check[data-mark]` styles. `concern` is a finding, `missing` is an absence. */
export function highwayTone(mark: HighwayMark | undefined): string {
  if (mark === 'ok') return 'ok';
  if (mark === 'concern') return 'inconsistent';
  if (mark === 'missing') return 'missing';
  return 'unset';
}

/** Read back what a previous sitting recorded, so the form is never a blank slate twice. */
export function highwayValuesFrom(findings: Record<string, unknown> | null | undefined): ReviewValues {
  const out: ReviewValues = {};
  const row = (findings ?? {}) as Record<string, unknown>;
  for (const field of HIGHWAY_FIELDS) {
    const v = row[field.id];
    out[field.id] = v === null || v === undefined ? '' : String(v);
  }
  return out;
}
