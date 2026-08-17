/** Number / money / date formatters matching self-service dashboard-panel. */

export function msdFmtNum(v: number): string {
  const n = Number(v) || 0;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return n.toLocaleString('en-US');
}

export function msdFmtK(v: number): string {
  const n = Number(v) || 0;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return String(Math.round(n));
}

/**
 * Gallons, in full. `msdFmtK` turns 9,241.36 into "9k", which is the one number on this dashboard
 * nobody can afford to read approximately — it is what the carrier is billed on, and the
 * Transaction Details table right below has always shown it exactly. Trailing zeros are dropped, so
 * a whole-gallon day reads "9,241" rather than "9,241.00".
 */
export function msdFmtGallons(v: number): string {
  return (Number(v) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/**
 * Gallons, compact but not lossy — `9.24k`, `0.74k`, `1.23M`.
 *
 * `msdFmtK` keeps one significant figure ("9k"), which is where 241 gallons went missing. Two
 * decimals is the smallest abbreviation that still resolves ~10 gallons at this scale. Always two,
 * never trimmed: these sit in a tabular-mono column, and a "10k" beside a "9.24k" breaks the
 * alignment the column is for. Sub-thousand reads `0.74k` rather than switching units mid-column.
 */
export function msdFmtGallonsK(v: number): string {
  const n = Number(v) || 0;
  if (n === 0) return '0';
  const abs = Math.abs(n);
  const [scaled, unit] = abs >= 1e6 ? [n / 1e6, 'M'] : [n / 1e3, 'k'];
  return `${scaled.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${unit}`;
}

export function dbtFormatMoney(v: number): string {
  const n = Number(v) || 0;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function dbtFormatDate(val: string | undefined): string {
  if (!val) return '—';
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return val;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function dbtFormatPeriod(from: string | undefined, to: string | undefined): string {
  const a = from ? new Date(from) : null;
  const b = to ? new Date(to) : null;
  if (!a || Number.isNaN(a.getTime())) return '—';
  const fmt = (d: Date): string => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (!b || Number.isNaN(b.getTime())) return fmt(a);
  return `${fmt(a)} – ${fmt(b)}`;
}

export function dbtFormatStatus(status: string | undefined): string {
  const s = (status || '').toLowerCase();
  if (s === 'pending') return 'Pending';
  if (s === 'partially_paid' || s === 'partial') return 'Partial';
  if (s === 'rejected') return 'Rejected';
  if (!s) return '—';
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Billing cycle: 26th → 25th (widget parity). */
export function currentBillingCycle(): { start: Date; end: Date; label: string } {
  const now = new Date();
  const day = now.getDate();
  const y = now.getFullYear();
  const m = now.getMonth();
  let startY: number;
  let startM: number;
  let endY: number;
  let endM: number;
  if (day >= 26) {
    startY = y;
    startM = m;
    endY = m === 11 ? y + 1 : y;
    endM = (m + 1) % 12;
  } else {
    startM = m === 0 ? 11 : m - 1;
    startY = m === 0 ? y - 1 : y;
    endY = y;
    endM = m;
  }
  const start = new Date(startY, startM, 26);
  const end = new Date(endY, endM, 25, 23, 59, 59);
  const fmt = (d: Date): string => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return { start, end, label: `${fmt(start)} – ${fmt(end)}` };
}

export function n(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  }
  return 0;
}
