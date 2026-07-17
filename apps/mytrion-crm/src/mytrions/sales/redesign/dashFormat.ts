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
