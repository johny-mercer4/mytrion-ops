/**
 * Shared vocabulary for the Mytrion Watch desk — band meaning, and how numbers are written.
 *
 * Kept out of the components because the queue and the detail must agree: a carrier shown as
 * "Elevated" in a list and "Watch" in its own page is the kind of drift that costs the desk its
 * trust in the score.
 *
 * Units are NOT defined here. They come down with the score (`featureMeta`), because only the model
 * knows that 26 is days and 0.333 is a ratio that runs to 2 — a units table copied into the client
 * is a units table that will drift the first time a feature is retrained.
 */
import type { WatchBand, WatchModel, WatchUnit } from '@/api/mytrionWatch';

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

/** Fallback cut-points, used only until the model arrives — `mytrion_watch_models` is authoritative. */
const FALLBACK_CUTS = { high: 520, elevated: 580, watch: 640 };

export interface BandCut {
  band: WatchBand;
  below: number;
}

/** Score cut-points from the model that actually produced the score, worst first. */
export function bandCuts(model: WatchModel | null | undefined): BandCut[] {
  return [
    { band: 'high', below: Number(model?.bandHighBelow ?? FALLBACK_CUTS.high) },
    { band: 'elevated', below: Number(model?.bandElevatedBelow ?? FALLBACK_CUTS.elevated) },
    { band: 'watch', below: Number(model?.bandWatchBelow ?? FALLBACK_CUTS.watch) },
  ];
}

export function bandOf(score: number, model?: WatchModel | null): WatchBand {
  const [high, elevated, watch] = bandCuts(model);
  if (score < (high?.below ?? FALLBACK_CUTS.high)) return 'high';
  if (score < (elevated?.below ?? FALLBACK_CUTS.elevated)) return 'elevated';
  if (score < (watch?.below ?? FALLBACK_CUTS.watch)) return 'watch';
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
 * A feature value written with its unit.
 *
 * The unit is the whole point. "26" is unreadable; "26 days" is a fact a credit agent can act on,
 * and "0.33 of 2" stops the night/weekend ratio being misread as 33%.
 */
export function fmtValue(v: number | null | undefined, unit: WatchUnit): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'No data';
  switch (unit) {
    case 'percent':
      return `${(v * 100).toFixed(v < 0.1 && v > 0 ? 1 : 0)}%`;
    case 'usd':
      return fmtMoney(v);
    case 'gallons':
      return `${v.toLocaleString('en-US', { maximumFractionDigits: 1 })} gal`;
    case 'ratio2':
      return `${v.toFixed(2)} of 2`;
    case 'days':
    default:
      return `${v.toLocaleString('en-US', { maximumFractionDigits: v < 10 ? 1 : 0 })} ${v === 1 ? 'day' : 'days'}`;
  }
}

/**
 * A bare number for a bin boundary — the unit is already on the row's value.
 *
 * One decimal, never rounded to whole: these bounds sit on half-values by construction (13.5, 23.5,
 * 210.5), and rounding 13.5 to "14" prints a boundary the model does not have.
 */
function fmtBound(v: number, unit: WatchUnit): string {
  if (unit === 'percent') return `${Math.round(v * 100)}%`;
  if (unit === 'usd') return fmtMoney(v);
  return v.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

/**
 * The bucket a value landed in, as an interval a person can read.
 *
 * This is the missing half of the explanation: a weight of +1.60 means nothing until you can see
 * that the value fell in "up to 47%" — the worst bucket of six.
 */
export function fmtBin(
  lower: number | null,
  upper: number | null,
  isNan: boolean,
  unit: WatchUnit,
): string {
  if (isNan) return 'no data';
  if (lower === null && upper === null) return 'any value';
  if (lower === null) return `up to ${fmtBound(upper as number, unit)}`;
  if (upper === null) return `over ${fmtBound(lower, unit)}`;
  return `${fmtBound(lower, unit)} – ${fmtBound(upper, unit)}`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** "2.3s" / "1m 17s" — how long the last scoring run took. */
export function fmtDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
