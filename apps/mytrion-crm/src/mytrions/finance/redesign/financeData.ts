import {
  activeClientCount,
  fmtCurrency,
  suspendedCount,
} from '../data';

export type FinanceSection = 'home' | 'transactions' | 'clients' | 'dashboard';
export type DashSub = 'debtors' | 'payments' | 'fueling';
export type ClientDrillTab = 'invoices' | 'payments' | 'fuel' | 'info';

export const NAV: { id: FinanceSection; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { id: 'transactions', label: 'Transactions', icon: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z' },
  { id: 'clients', label: 'Clients', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
  { id: 'dashboard', label: 'Dashboard', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
];

export const NAV_LABEL: Record<FinanceSection, string> = {
  home: 'Home',
  transactions: 'Transactions',
  clients: 'Clients',
  dashboard: 'Dashboard',
};

export type BadgeKind = 'ok' | 'warn' | 'danger' | 'orange' | 'violet' | 'blue' | 'accent' | 'muted';

const BADGE_BG: Record<BadgeKind, string> = {
  ok: 'var(--ok-s)',
  warn: 'var(--warn-s)',
  danger: 'var(--danger-s)',
  orange: 'var(--orange-s)',
  violet: 'var(--violet-s)',
  blue: 'var(--blue-s)',
  accent: 'var(--accent-s)',
  muted: 'var(--muted-s)',
};

const BADGE_FG: Record<BadgeKind, string> = {
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  danger: 'var(--danger)',
  orange: 'var(--orange)',
  violet: 'var(--violet)',
  blue: 'var(--blue)',
  accent: 'var(--accent)',
  muted: 'var(--muted)',
};

export function badge(text: string, kind: BadgeKind = 'muted'): { text: string; style: string } {
  const map: Record<BadgeKind, [string, string]> = {
    ok: ['var(--ok-s)', 'var(--ok)'],
    warn: ['var(--warn-s)', 'var(--warn)'],
    danger: ['var(--danger-s)', 'var(--danger)'],
    orange: ['var(--orange-s)', 'var(--orange)'],
    violet: ['var(--violet-s)', 'var(--violet)'],
    blue: ['var(--blue-s)', 'var(--blue)'],
    accent: ['var(--accent-s)', 'var(--accent)'],
    muted: ['var(--muted-s)', 'var(--text2)'],
  };
  const [bg, fg] = map[kind] ?? map.muted;
  return {
    text,
    style: `font-size:9.5px;font-weight:700;letter-spacing:.02em;padding:3px 8px;border-radius:var(--radius-md);background:${bg};color:${fg};white-space:nowrap`,
  };
}

export function chipStyle(active: boolean): string {
  return active
    ? 'display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 13px;border-radius:var(--radius-md);border:1px solid transparent;background:var(--accent);color:#04150F;font-size:11.5px;font-weight:700;cursor:pointer;white-space:nowrap'
    : 'display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 13px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text2);font-size:11.5px;font-weight:600;cursor:pointer;white-space:nowrap';
}

export function subTabStyle(active: boolean): string {
  return active
    ? 'display:inline-flex;align-items:center;gap:7px;height:36px;padding:0 15px;border-radius:var(--radius-md);border:none;background:var(--accent);color:#04150F;font-size:12.5px;font-weight:700;cursor:pointer;white-space:nowrap'
    : 'display:inline-flex;align-items:center;gap:7px;height:36px;padding:0 15px;border-radius:var(--radius-md);border:none;background:transparent;color:var(--text2);font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap';
}

export function segStyle(active: boolean): string {
  return active
    ? 'padding:5px 12px;border-radius:var(--radius-md);border:none;background:var(--accent);color:#04150F;font-size:11px;font-weight:700;cursor:pointer'
    : 'padding:5px 12px;border-radius:var(--radius-md);border:none;background:transparent;color:var(--muted);font-size:11px;font-weight:600;cursor:pointer';
}

export function navBtnStyle(active: boolean): string {
  return (
    `display:flex;align-items:center;gap:11px;height:40px;padding:0 12px;border-radius:var(--radius-md);border:none;cursor:pointer;font-size:13px;font-weight:${active ? 700 : 600};text-align:left;width:100%;` +
    (active ? 'background:var(--accent-s);color:var(--accent)' : 'background:transparent;color:var(--text2)')
  );
}

export function moneyC(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

export function balanceModeStyle(balance = 0): string {
  const mode = balance < 40_000 ? 'danger' : balance < 70_000 ? 'warn' : 'ok';
  const map = {
    danger: ['var(--danger-s)', 'var(--danger)'],
    warn: ['var(--warn-s)', 'var(--warn)'],
    ok: ['var(--ok-s)', 'var(--ok)'],
  } as const;
  const [bg, fg] = map[mode];
  return `font-size:9.5px;font-weight:800;letter-spacing:.05em;padding:3px 9px;border-radius:99px;background:${bg};color:${fg}`;
}

export function balanceModeLabel(balance = 0): string {
  if (balance < 40_000) return 'CRITICAL';
  if (balance < 70_000) return 'WARNING';
  return 'COMFORT';
}

export function kpiIcon(kind: BadgeKind | 'accent'): string {
  const bg = kind === 'accent' ? 'var(--accent-s)' : BADGE_BG[kind as BadgeKind] ?? 'var(--accent-s)';
  const fg = kind === 'accent' ? 'var(--accent)' : BADGE_FG[kind as BadgeKind] ?? 'var(--accent)';
  return `width:36px;height:36px;border-radius:var(--radius-md);background:${bg};color:${fg};display:flex;align-items:center;justify-content:center;flex-shrink:0`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

export function relTime(d: Date | number): string {
  const ms = typeof d === 'number' ? d : d.getTime();
  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

export function balanceMode(balance = 0): { mode: string; kind: BadgeKind } {
  if (balance < 40_000) return { mode: 'CRITICAL', kind: 'danger' };
  if (balance < 70_000) return { mode: 'WARNING', kind: 'warn' };
  return { mode: 'COMFORT', kind: 'ok' };
}

export function galC(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function dateTimeShort(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function paymentStatusLabel(st: string): string {
  if (st === 'APPROVED') return 'Approved';
  if (st === 'DECLINED') return 'Declined';
  if (st === 'POSTED') return 'Posted';
  if (st === 'SUCCESS') return 'Success';
  return st;
}

export function invoiceStatusLabel(st: string): string {
  return st.replace('_', ' ');
}

export {
  fmtCurrency,
  activeClientCount,
  suspendedCount,
} from '../data';
