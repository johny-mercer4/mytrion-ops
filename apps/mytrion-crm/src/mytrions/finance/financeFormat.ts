/**
 * Finance formatting — one definition per figure so a dollar amount looks identical on the roster,
 * in the modal header and inside every table.
 */

const MONEY = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONEY_0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const NUM = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Coerce anything the API might hand us (numeric strings from pg/Deluge) to a finite number. */
export function toNum(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** $1,234.56 */
export const money = (v: unknown): string => `$${MONEY.format(toNum(v))}`;
/** $1,235 — for dense table cells and stat tiles where cents are noise. */
export const money0 = (v: unknown): string => `$${MONEY_0.format(Math.round(toNum(v)))}`;
export const num = (v: unknown): string => NUM.format(Math.round(toNum(v)));

/**
 * Split a dollar amount so the cents can be de-emphasised in the balance hero.
 * `715765.14` → `{ whole: '$715,765', cents: '.14' }`
 */
export function splitMoney(v: unknown): { whole: string; cents: string } {
  const n = toNum(v);
  const [w = '0', c = '00'] = MONEY.format(n).split('.');
  return { whole: `$${w}`, cents: `.${c}` };
}

/** '2026-07-26T18:30:04-04:00' → '26 Jul 2026, 18:30'. Empty string for missing input. */
export function dateTime(v: string | null | undefined): string {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * '2026-02-23' → '23 Feb 2026'.
 *
 * Date-only strings are parsed by hand rather than via `new Date('2026-02-23')`, which the spec
 * treats as UTC midnight — west of UTC that renders as the PREVIOUS day. These come from
 * `timestamp without time zone` columns the backend already flattened, so they carry no zone and
 * must not acquire one here.
 */
export function dateOnly(v: string | null | undefined): string {
  if (!v) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (!m) return dateTime(v);
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Value, or an em-dash — Finance data is sparse and blank cells read as broken. */
export const dash = (v: string | number | null | undefined): string => {
  const s = v == null ? '' : String(v).trim();
  return s === '' || s === '0' ? '—' : s;
};

/** Plain text, em-dash when empty (keeps '0' as a real value, unlike `dash`). */
export const orDash = (v: string | null | undefined): string => (v?.trim() ? v : '—');

/** Relative age in whole days, e.g. `154` → '154d'. */
export const days = (v: unknown): string => `${num(v)}d`;
