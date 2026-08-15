/**
 * Shared vocabulary for the Mytrion Watch desk — band meaning, and how numbers are written.
 *
 * Kept out of the components because the queue and the detail must agree: a carrier shown as
 * "Elevated" in a list and "Watch" in its own page is the kind of drift that costs the desk its
 * trust in the score.
 */
import type { WatchBand } from '@/api/mytrionWatch';

/**
 * The bands, worst LAST — a monotone risk ramp (emerald → amber → orange → red) rather than four
 * unrelated hues, so severity reads before the label does.
 */
export const BAND_ORDER: readonly WatchBand[] = ['low', 'watch', 'elevated', 'high'];

export const BAND_LABEL: Record<WatchBand, string> = {
  low: 'Low risk',
  watch: 'Watch',
  elevated: 'Elevated',
  high: 'High risk',
};

/** Short form for chips and legends, where the row already says what it is about. */
export const BAND_SHORT: Record<WatchBand, string> = {
  low: 'Low',
  watch: 'Watch',
  elevated: 'Elevated',
  high: 'High',
};

/** What the band means for the desk, in the words a credit agent would use. */
export const BAND_MEANING: Record<WatchBand, string> = {
  low: 'Paying as agreed. No action.',
  watch: 'Nothing wrong yet — worth a look if the score keeps falling.',
  elevated: 'Behaviour has deteriorated. Review the limit before it grows.',
  high: 'Default risk is material. Review now.',
};

/** Score cut-points, mirroring `mytrion_watch_models`. Used to draw the guides on the history chart. */
export const BAND_CUTS: ReadonlyArray<{ band: WatchBand; below: number }> = [
  { band: 'high', below: 520 },
  { band: 'elevated', below: 580 },
  { band: 'watch', below: 640 },
];

export function bandOf(score: number): WatchBand {
  if (score < 520) return 'high';
  if (score < 580) return 'elevated';
  if (score < 640) return 'watch';
  return 'low';
}

/** Scores are whole numbers on the desk — the two stored decimals are precision nobody reads. */
export function fmtScore(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '—' : Math.round(v).toString();
}

/** Signed, so "fell 25" and "rose 25" never look alike at a glance. */
export function fmtDelta(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const r = Math.round(v);
  return r > 0 ? `+${r}` : r.toString();
}

/** PD is a small probability; a percentage with one decimal is the readable form. */
export function fmtPd(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(1)}%`;
}

export function fmtMoney(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `$${Math.round(v).toLocaleString('en-US')}`;
}

/** Compact money for the aggregator tiles, where "$2.4M" beats seven digits. */
export function fmtMoneyShort(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${Math.round(v / 1_000)}k`;
  return `$${Math.round(v)}`;
}

/**
 * Feature values span six orders of magnitude — a ratio of 0.94, 782 months on book, $2,529
 * invoiced. One formatter with a magnitude rule keeps the column readable without a per-feature
 * lookup that would have to be maintained alongside the model.
 */
export function fmtFeature(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'No data';
  if (Number.isInteger(v)) return v.toLocaleString('en-US');
  if (Math.abs(v) < 10) return v.toFixed(3);
  return v.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
