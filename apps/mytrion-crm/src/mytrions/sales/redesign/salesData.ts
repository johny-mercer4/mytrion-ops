/**
 * Sales Mytrion redesign — model layer. Static data + pure styling helpers ported from the
 * reference prototype (Sales Mytrion.dc.html). The mock arrays seed the UI at pixel fidelity;
 * the live-data pass swaps the six already-wired tabs onto the existing touchpoints
 * (see ../live.ts) while the design/shape stays identical.
 */
import type { IconName } from './icons';

// ---------- pure styling helpers (reference deptStyle/badge/iconBox) ----------

export interface BadgeVM {
  text: string;
  style: string;
}

const RGB: Record<string, string> = {
  'var(--accent-rgb)': 'var(--accent-rgb)',
  'var(--violet-rgb)': 'var(--violet-rgb)',
};

/** Dept-code chip style (C=orange, Q=accent, V=ok, M=violet). */
export function deptStyle(code: string): string {
  const c = String(code || '')[0] ?? '';
  const map: Record<string, string> = {
    C: 'var(--orange)',
    Q: 'var(--accent)',
    V: 'var(--ok)',
    M: 'var(--violet)',
  };
  const col = map[c] ?? 'var(--muted)';
  return `font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;padding:2px 7px;border-radius:var(--radius-md);color:${col};background:color-mix(in srgb, ${col} 15%, transparent)`;
}

/** A rounded status pill. */
export function badge(text: string, col: string): BadgeVM {
  return {
    text,
    style: `font-size:10px;font-weight:700;padding:3px 8px;border-radius:99px;background:color-mix(in srgb, ${col} 16%, transparent);color:${col}`,
  };
}

/** A tinted square icon box. */
export function iconBox(col: string, size = 40): string {
  return `width:${size}px;height:${size}px;border-radius:var(--radius-md);flex-shrink:0;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb, ${col} 15%, transparent);color:${col}`;
}

void RGB;

// ---------- icons ----------
// Curated palette of semantic icon names. Each value is an `IconName` resolved to a ready-made
// lucide glyph by `<Icon>` (see ./icons). Consumers reference `ICO.bolt` etc. for autocomplete.

export const ICO = {
  calls: 'calls',
  notes: 'notes',
  lead: 'lead',
  inbox: 'inbox',
  star: 'star',
  doc: 'doc',
  check: 'check',
  users: 'users',
  warn: 'warn',
  clock: 'clock',
  money: 'money',
  card: 'card',
  fuel: 'fuel',
  trend: 'trend',
  bell: 'bell',
  bolt: 'bolt',
} satisfies Record<string, IconName>;

export type IcoKey = keyof typeof ICO;

export interface NavItem {
  id: string;
  label: string;
  icon: IconName;
  badge?: number;
  /** Rendered disabled with a "Coming soon" tag; not navigable. */
  comingSoon?: boolean;
}

export const NAV: NavItem[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  // Badges are filled in at runtime from real counts (see Shell.badgeCounts); no hardcoded numbers.
  { id: 'inbox', label: 'Inbox', icon: 'inbox' },
  // Tickets parked — current Desk feed isn't shippable. Drop `comingSoon` to re-enable; TicketsTab stays wired.
  { id: 'tickets', label: 'Tickets', icon: 'tickets', comingSoon: true },
  // Open Pool is shown but disabled ("Coming soon") — its live data flow is being rebuilt. Drop
  // `comingSoon` to re-enable; the PoolTab component + its `section === 'pool'` render stay wired.
  { id: 'pool', label: 'Open Pool', icon: 'pool', comingSoon: true },
  { id: 'records', label: 'Data Center', icon: 'records' },
  { id: 'create', label: 'Create', icon: 'create' },
  { id: 'auto', label: 'Automations', icon: ICO.bolt },
  { id: 'dash', label: 'Dashboard', icon: 'dash' },
  { id: 'carriers', label: 'Carriers', icon: 'carriers' },
];

export const NAVLABEL: Record<string, string> = {
  home: 'Home', inbox: 'Inbox', tickets: 'Tickets', pool: 'Open Pool', records: 'Data Center',
  create: 'Create Ticket', auto: 'Automations', dash: 'Dashboard', carriers: 'Carriers',
};

// ---------- time / workday ----------

const NY_TZ = 'America/New_York';

/**
 * yyyy-MM-dd for `n` days before "today" on the NY calendar — the sales floor's day, not the
 * viewer's or UTC (toISOString-based dates showed "tomorrow" for late-evening ET users).
 * en-CA formats as yyyy-MM-dd directly.
 */
export function nyDaysAgo(n: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: NY_TZ }).format(
    new Date(Date.now() - n * 86_400_000),
  );
}

/** Today's yyyy-MM-dd on the NY calendar. */
export function nyToday(): string {
  return nyDaysAgo(0);
}

export function timeParts(now: Date = new Date()) {
  // The workday progress + clock are always in New York (EST/EDT), regardless of the viewer's
  // own timezone — the sales floor runs on NY hours.
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: NY_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const h = Number(p.find((x) => x.type === 'hour')?.value ?? '0') % 24;
  const min = Number(p.find((x) => x.type === 'minute')?.value ?? '0');
  const tod = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  const startMin = 9 * 60;
  const endMin = 18 * 60;
  const nowMin = Math.max(startMin, Math.min(endMin, h * 60 + min));
  const pct = Math.round(((nowMin - startMin) / (endMin - startMin)) * 100);
  return {
    tod,
    pct: Math.max(2, pct),
    timeFmt: now.toLocaleTimeString('en-US', { timeZone: NY_TZ, hour: 'numeric', minute: '2-digit', hour12: true }),
    dateLabel: now.toLocaleDateString('en-US', { timeZone: NY_TZ, weekday: 'long', month: 'long', day: 'numeric' }),
  };
}

/** Build an SVG line+area path from a {m,tx} series. */
export function buildLine(series: { m: string; tx: number }[], w: number, h: number) {
  const max = Math.max(...series.map((d) => d.tx)) * 1.1;
  const n = series.length;
  const pad = 3;
  const X = (i: number) => pad + (i / (n - 1)) * (w - pad * 2);
  const Y = (v: number) => h - pad - (v / max) * (h - pad * 2);
  const pts = series.map((d, i) => ({ x: X(i), y: Y(d.tx), label: d.m, val: d.tx }));
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' ');
  const area = `${line} L ${X(n - 1).toFixed(1)} ${(h - pad).toFixed(1)} L ${X(0).toFixed(1)} ${(h - pad).toFixed(1)} Z`;
  return { line, area, pts };
}
