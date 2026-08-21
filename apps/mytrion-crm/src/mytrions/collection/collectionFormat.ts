/**
 * Shared money / date / identity formatters for Collection cases and Array reports.
 *
 * LOCALE IS PINNED to en-US, and that is a fix rather than a preference: these formatters passed
 * `undefined`, which means the VIEWER's locale, and on a machine set to anything non-US every
 * figure on the desk rendered as `168 555 $` and every date in that locale's month names. This is
 * a US debt book — the amounts are USD by construction (`currency` on the row is always 'USD')
 * and the dates are US calendar days. The presentation must not depend on where the browser
 * happens to be configured.
 */
export const LOCALE = 'en-US';

export function money(value: string | number | null | undefined, digits = 0): string {
  if (value == null || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(LOCALE, {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

export function moneyExact(value: string | number | null | undefined): string {
  return money(value, 2);
}

export function fmtDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value.length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function initials(name: string | null | undefined, fallback = '?'): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback.slice(0, 2).toUpperCase();
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
}
