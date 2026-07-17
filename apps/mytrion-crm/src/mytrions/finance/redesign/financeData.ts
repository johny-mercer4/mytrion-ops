/**
 * Finance redesign — nav, badge/chip styles, and aggregates ported from Finance Mytrion.dc.html.
 */
import {
  CLIENTS,
  DASHBOARD_DEBTORS,
  DASHBOARD_PAYMENTS,
  DOW_VOLUME,
  HOUR_VOLUME,
  PARENT_SNAPSHOT,
  TOP_LOCATIONS,
  TRANSACTION_LINES,
  activeClientCount,
  fmtCurrency,
  suspendedCount,
  type Client,
  type TransactionLine,
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

export function balanceModeStyle(balance = PARENT_SNAPSHOT.balance): string {
  const mode = balance < 40_000 ? 'danger' : balance < 70_000 ? 'warn' : 'ok';
  const map = {
    danger: ['var(--danger-s)', 'var(--danger)'],
    warn: ['var(--warn-s)', 'var(--warn)'],
    ok: ['var(--ok-s)', 'var(--ok)'],
  } as const;
  const [bg, fg] = map[mode];
  return `font-size:9.5px;font-weight:800;letter-spacing:.05em;padding:3px 9px;border-radius:99px;background:${bg};color:${fg}`;
}

export function balanceModeLabel(balance = PARENT_SNAPSHOT.balance): string {
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

export function debtTotal(): number {
  return DASHBOARD_DEBTORS.reduce((s, d) => s + d.debt, 0);
}

export function overdueInvTotal(): number {
  return DASHBOARD_DEBTORS.reduce((s, d) => s + d.inv, 0);
}

export function collectedToday(): number {
  return DASHBOARD_PAYMENTS.filter((p) => p.st !== 'DECLINED').slice(0, 4).reduce((s, p) => s + p.amt, 0);
}

export function fundedToday(): number {
  return TRANSACTION_LINES.slice(0, 5).reduce((s, t) => s + t.amount, 0);
}

export function healthScore(): { score: number; color: string; label: string } {
  const collectRatio = debtTotal() > 0 ? Math.max(0, 1 - debtTotal() / 2_200_000) : 1;
  const activeRatio = activeClientCount() / Math.max(1, CLIENTS.length);
  const suspRatio = 1 - suspendedCount() / Math.max(1, CLIENTS.length);
  const raw = Math.round((collectRatio * 0.5 + activeRatio * 0.35 + suspRatio * 0.15) * 100 * 0.92 + 6);
  const score = Math.min(99, Math.max(0, raw));
  const color = score >= 75 ? 'var(--ok)' : score >= 55 ? 'var(--warn)' : 'var(--danger)';
  const label = score >= 75 ? 'Strong · trending up' : score >= 55 ? 'Watch · action needed' : 'At risk · act today';
  return { score, color, label };
}

export function balanceMode(balance = PARENT_SNAPSHOT.balance): { mode: string; kind: BadgeKind } {
  if (balance < 40_000) return { mode: 'CRITICAL', kind: 'danger' };
  if (balance < 70_000) return { mode: 'WARNING', kind: 'warn' };
  return { mode: 'COMFORT', kind: 'ok' };
}

export interface LiveFeedItem {
  key: string;
  company: string;
  meta: string;
  amount: string;
  grade: string;
  time: string;
  flash?: boolean;
}

export function liveFeedItems(): LiveFeedItem[] {
  return TRANSACTION_LINES.slice(0, 5).map((t, i) => ({
    key: `${t.txId}-${i}`,
    company: t.company,
    meta: `${t.loc}, ${t.state}`,
    amount: fmtCurrency(t.amount).replace('.00', ''),
    grade: t.grade,
    time: relTime(new Date(t.date).getTime()),
    flash: false,
  }));
}

export function homeKpis() {
  const deltaStyle = (up: boolean) =>
    `font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:var(--radius-md);background:${up ? 'var(--ok-s)' : 'var(--danger-s)'};color:${up ? 'var(--ok)' : 'var(--danger)'}`;
  return [
    { label: 'Funded Today', help: 'across all carriers', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z', kind: 'accent' as const, color: 'var(--accent)', value: moneyC(fundedToday()), delta: '+12%', up: true },
    { label: 'Collected Today', help: 'payments received', icon: 'M5 13l4 4L19 7', kind: 'ok' as const, color: 'var(--ok)', value: moneyC(collectedToday()), delta: '+8%', up: true },
    { label: 'Active Clients', help: `of ${CLIENTS.length} total`, icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z', kind: 'blue' as const, color: 'var(--text)', value: String(activeClientCount()), delta: '+3', up: true },
    { label: 'Debt Outstanding', help: `${DASHBOARD_DEBTORS.length} debtors`, icon: 'M12 9v4m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z', kind: 'danger' as const, color: 'var(--danger)', value: moneyC(debtTotal()), delta: '-5%', up: false },
  ].map((k) => ({ ...k, iconStyle: kpiIcon(k.kind), deltaStyle: deltaStyle(k.up) }));
}

export function topDebtors(limit = 4) {
  return [...DASHBOARD_DEBTORS].sort((a, b) => b.debt - a.debt).slice(0, limit);
}

export function aiInsight(): string {
  const top = topDebtors(1)[0];
  if (!top) return 'Your book is fully collected. Fueling volume peaked Wednesday.';
  return `${top.company} now carries ${fmtCurrency(top.debt)} across ${top.inv} invoices — the largest single exposure in your book. Weekend fueling is up 14% vs last cycle.`;
}

export function paymentTrend14(): { label: string; h: string; title: string }[] {
  const dayMs = 86_400_000;
  const today = new Date('2026-06-28T12:00:00');
  today.setHours(0, 0, 0, 0);
  const days: { dt: number; sum: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const dt = today.getTime() - i * dayMs;
    const sum = DASHBOARD_PAYMENTS.filter((p) => {
      const pd = new Date(p.date);
      pd.setHours(0, 0, 0, 0);
      return pd.getTime() === dt;
    }).reduce((s, p) => s + p.amt, 0);
    days.push({ dt, sum });
  }
  const max = Math.max(1, ...days.map((d) => d.sum));
  return days.map((d) => ({
    label: String(new Date(d.dt).getDate()),
    h: `${Math.max(2, Math.round((d.sum / max) * 100))}%`,
    title: `${new Date(d.dt).toLocaleDateString()}: ${fmtCurrency(d.sum)}`,
  }));
}

export function agingBuckets(metric: 'debt' | 'invoices') {
  const buckets = [
    { label: '1-15', debt: 4200, inv: 12 },
    { label: '16-30', debt: 8900, inv: 18 },
    { label: '31-60', debt: 12400, inv: 9 },
    { label: '61-90', debt: 6200, inv: 5 },
    { label: '90+', debt: 3100, inv: 3 },
  ];
  const max = Math.max(1, ...buckets.map((b) => (metric === 'debt' ? b.debt : b.inv)));
  const colors = ['var(--warn)', 'var(--orange)', 'var(--danger)', 'var(--danger)', 'var(--danger)'];
  return buckets.map((b, i) => {
    const v = metric === 'debt' ? b.debt : b.inv;
    return {
      label: b.label,
      h: `${Math.max(3, Math.round((v / max) * 100))}%`,
      color: colors[i] ?? 'var(--warn)',
      valStr: metric === 'debt' ? fmtCurrency(v) : String(v),
      inv: b.inv,
    };
  });
}

export function dowBars() {
  const max = Math.max(1, ...DOW_VOLUME.map((d) => d.gal));
  return DOW_VOLUME.map((d, i) => ({
    label: d.name,
    h: `${Math.max(4, Math.round((d.gal / max) * 100))}%`,
    color: d.weekend ? 'var(--muted-s)' : 'linear-gradient(180deg,var(--accent),rgba(var(--accent-rgb),.5))',
    title: `${d.name}: ${Math.round(d.gal).toLocaleString()} gal · ${fmtCurrency(d.spend)}`,
    weekend: i >= 5,
  }));
}

export function hodBars() {
  const buckets: { h: number; tx: number }[] = [];
  for (let hour = 0; hour < 24; hour += 2) {
    const tx = (HOUR_VOLUME[hour]?.tx ?? 0) + (HOUR_VOLUME[hour + 1]?.tx ?? 0);
    buckets.push({ h: hour, tx });
  }
  const max = Math.max(1, ...buckets.map((b) => b.tx));
  return buckets.map((b) => ({
    label: `${b.h % 12 === 0 ? 12 : b.h % 12}${b.h < 12 ? 'a' : 'p'}`,
    h: `${Math.max(3, Math.round((b.tx / max) * 100))}%`,
    color:
      b.tx / max > 0.7
        ? 'linear-gradient(180deg,var(--accent),var(--accent-2))'
        : 'linear-gradient(180deg,rgba(var(--accent-rgb),.6),rgba(var(--accent-rgb),.28))',
    title: `${b.h}:00–${b.h + 2}:00 · ${b.tx} fills`,
  }));
}

export function topLocationsList() {
  const max = Math.max(1, ...TOP_LOCATIONS.map((l) => l.spend));
  return TOP_LOCATIONS.map((l, i) => ({
    rank: `#${i + 1}`,
    name: l.loc,
    state: l.state,
    spend: fmtCurrency(l.spend),
    gal: `${Math.round(l.gal).toLocaleString()} gal`,
    w: `${Math.round((l.spend / max) * 100)}%`,
  }));
}

export function filterTransactions(search: string, preset: string): TransactionLine[] {
  let rows = [...TRANSACTION_LINES];
  const q = search.trim().toLowerCase();
  if (q) rows = rows.filter((t) => `${t.company} ${t.carrier} ${t.txId} ${t.loc}`.toLowerCase().includes(q));
  if (preset === 'week') rows = rows.slice(0, 6);
  else if (preset === 'quarter') rows = rows.slice(0, 4);
  return rows;
}

export function galC(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function dateTimeShort(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function creditLimitNum(c: Client): number {
  if (c.credit === 'WEX') return 0;
  return parseFloat(c.credit.replace(/,/g, '')) || 0;
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

export function filterClients(
  search: string,
  status: string,
  flag: string,
): Client[] {
  let rows = [...CLIENTS];
  if (status === 'active') rows = rows.filter((c) => c.active);
  else if (status === 'inactive') rows = rows.filter((c) => !c.active);
  if (flag === 'suspended') rows = rows.filter((c) => c.suspended);
  else if (flag === 'debtor') rows = rows.filter((c) => c.debt > 0);
  const q = search.trim().toLowerCase();
  if (q) rows = rows.filter((c) => `${c.company} ${c.carrier}`.toLowerCase().includes(q));
  return rows;
}

export {
  fmtCurrency,
  fundedTotal,
  totalFuelGal,
  discountSaved,
  txCount,
  activeClientCount,
  suspendedCount,
  fueledRecentCount,
  TRANSACTION_LINES,
  CLIENTS,
  DASHBOARD_DEBTORS,
  DASHBOARD_PAYMENTS,
} from '../data';
