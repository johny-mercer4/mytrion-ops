/**
 * Sales Mytrion redesign — model layer. Static data + pure styling helpers ported from the
 * reference prototype (Sales Mytrion.dc.html). The mock arrays seed the UI at pixel fidelity;
 * the live-data pass swaps the six already-wired tabs onto the existing touchpoints
 * (see ../live.ts) while the design/shape stays identical.
 */

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
  return `font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;padding:2px 7px;border-radius:6px;color:${col};background:color-mix(in srgb, ${col} 15%, transparent)`;
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
  return `width:${size}px;height:${size}px;border-radius:11px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb, ${col} 15%, transparent);color:${col}`;
}

void RGB;

// ---------- icons (stroked path `d`) ----------

export const ICO = {
  calls: 'M3 5a2 2 0 012-2h3.28a1 1 0 01.95.68l1.5 4.5a1 1 0 01-.5 1.21l-2.26 1.13a11 11 0 005.52 5.52l1.13-2.26a1 1 0 011.21-.5l4.5 1.5a1 1 0 01.68.95V19a2 2 0 01-2 2h-1C9.72 21 3 14.28 3 6V5z',
  notes: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  lead: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  inbox: 'M3 7l9 6 9-6M5 5h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z',
  star: 'M11.48 3.5l2.13 4.31 4.76.69-3.44 3.36.81 4.74-4.26-2.24-4.26 2.24.81-4.74L4.6 8.5l4.76-.69z',
  doc: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  check: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  users: 'M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4 0M17 8a3 3 0 11-2 0',
  warn: 'M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z',
  clock: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  money: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V7m0 10v1m0-1c-1.11 0-2.08-.4-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  card: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
  fuel: 'M3 22V5a2 2 0 012-2h8a2 2 0 012 2v17H3zm4-13h4v5H7V9zm8-4h1a2 2 0 012 2v4a2 2 0 01-2 2h-1m3 3v7',
  trend: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6',
  bell: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
} as const;

export type IcoKey = keyof typeof ICO;

export interface NavItem {
  id: string;
  label: string;
  icon: string;
  badge?: number;
}

export const NAV: NavItem[] = [
  { id: 'home', label: 'Home', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { id: 'inbox', label: 'Inbox', icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9', badge: 4 },
  { id: 'tickets', label: 'Tickets', icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4-.8L3 20l1.3-3.9A7.96 7.96 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z', badge: 2 },
  { id: 'pool', label: 'Open Pool', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4', badge: 7 },
  { id: 'records', label: 'Data Center', icon: 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4' },
  { id: 'create', label: 'Create', icon: 'M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z' },
  { id: 'auto', label: 'Automations', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  { id: 'dash', label: 'Dashboard', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  { id: 'carriers', label: 'Carriers', icon: 'M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0zM13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1' },
];

export const NAVLABEL: Record<string, string> = {
  home: 'Home', inbox: 'Inbox', tickets: 'Tickets', pool: 'Open Pool', records: 'Data Center',
  create: 'Create Ticket', auto: 'Automations', dash: 'Dashboard', carriers: 'Carriers',
};

export const USER = { name: 'Marcus Reyes', first: 'Marcus', initials: 'MR', role: 'Senior Sales Agent' };

// ---------- time / workday ----------

export function timeParts(now: Date = new Date()) {
  const h = now.getHours();
  const tod = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  const startMin = 9 * 60;
  const endMin = 18 * 60;
  const nowMin = Math.max(startMin, Math.min(endMin, h * 60 + now.getMinutes()));
  const pct = Math.round(((nowMin - startMin) / (endMin - startMin)) * 100);
  return {
    tod,
    pct: Math.max(2, pct),
    timeFmt: now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
    dateLabel: now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
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
