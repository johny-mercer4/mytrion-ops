/**
 * Shared value coercions for the CS Mytrion live-data adapters (live.ts, liveApplications.ts) —
 * split out so both can import them without one importing the other.
 */
export const str = (v: unknown): string => (v == null ? '' : typeof v === 'object' ? lookupName(v) : String(v));

export const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const bool01 = (v: unknown): 0 | 1 => (v === true || v === 'true' || v === 1 || v === '1' ? 1 : 0);

export function lookupName(v: unknown): string {
  if (v && typeof v === 'object') {
    const o = v as { name?: unknown; full_name?: unknown };
    return str(o.name ?? o.full_name ?? '');
  }
  return v == null ? '' : String(v);
}
