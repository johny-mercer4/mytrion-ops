/**
 * Sales Mytrion redesign — nav labels, icon map, and pure styling helpers.
 * Live rows (clients, inbox, tickets, retention, etc.) come from APIs via live.ts /
 * retentionData.ts / dataCenterLive.ts — not from seed arrays here.
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

/** Code / label chip tinted with an explicit color (theme CSS vars preferred). */
export function chipStyle(col: string): string {
  return `font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;padding:2px 7px;border-radius:var(--radius-md);color:${col};background:color-mix(in srgb, ${col} 15%, transparent)`;
}

/** Dept-code chip style (C=orange, Q=accent, V=ok, M=violet). Pass `color` to override (e.g. per-automation accent). */
export function deptStyle(code: string, color?: string): string {
  if (color) return chipStyle(color);
  const c = String(code || '')[0] ?? '';
  const map: Record<string, string> = {
    C: 'var(--orange)',
    Q: 'var(--accent)',
    V: 'var(--ok)',
    M: 'var(--violet)',
  };
  return chipStyle(map[c] ?? 'var(--muted)');
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

/**
 * Sidebar clusters (no visible labels — only a hairline between groups).
 * Order: daily → sell → parked soon → measure.
 */
export interface NavGroup {
  id: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'daily',
    items: [
      { id: 'home', label: 'Home', icon: 'home' },
      // Badges filled at runtime (see Shell.badgeCounts).
      { id: 'inbox', label: 'Inbox', icon: 'inbox' },
    ],
  },
  {
    id: 'sell',
    items: [
      { id: 'records', label: 'Data Center', icon: 'records' },
      { id: 'create', label: 'Create', icon: 'create' },
      { id: 'carriers', label: 'Carriers', icon: 'carriers' },
    ],
  },
  {
    id: 'soon',
    items: [
      // Retention owns Cases + Open Pool as in-page tabs (Phase 1 live).
      { id: 'retention', label: 'Retention', icon: 'retention' },
      // Tickets sits right after Retention (the two live desks lead this cluster).
      { id: 'tickets', label: 'Tickets', icon: 'tickets' },
      // Verification Pipeline parked — process not ready yet; drop `comingSoon` to re-enable (VerificationTab stays wired).
      { id: 'verification', label: 'Verification Pipeline', icon: 'verification', comingSoon: true },
      { id: 'callHub', label: 'Call Hub', icon: 'callHub', comingSoon: true },
    ],
  },
  {
    id: 'measure',
    items: [
      { id: 'auto', label: 'Automations', icon: ICO.bolt },
      { id: 'dash', label: 'Dashboard', icon: 'dash' },
    ],
  },
];

/** Flat list for lookups (comingSoon checks, labels, etc.). */
export const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/**
 * True when the Tickets tab is navigable (comingSoon dropped in NAV_GROUPS). Gates the
 * shell-level full-ticket paging (sidebarBadges — up to 20 Desk pages for a badge nobody
 * sees while parked), the badge itself, and openTicket navigation. Flip the NAV entry's
 * comingSoon to re-enable everything at once.
 */
export const TICKETS_ENABLED: boolean = !NAV.some((n) => n.id === 'tickets' && n.comingSoon === true);

/**
 * Top-bar titles — deliberately different from in-page H1s so chrome + content don't echo
 * the same uppercase phrase (e.g. top "New Entry" vs form "Create a Lead").
 */
export const NAVLABEL: Record<string, string> = {
  home: "Today's Briefing",
  inbox: 'Message Center',
  tickets: 'Support Queue',
  retention: 'Retention Desk',
  verification: 'Verification Desk',
  records: 'Pipeline Hub',
  create: 'New Entry',
  auto: 'Action Catalog',
  dash: 'Live Dashboard',
  carriers: 'Carrier Lookup',
  callHub: 'Call Workspace',
};

// ---------- time / workday ----------

const NY_TZ = 'America/New_York';

/** Sales-floor workday window (New York hours). The bar, %, and endpoint labels all derive from
 *  these — change here and the HomeTab labels follow, so the math and the text can't drift. */
export const WORKDAY_START_HOUR = 10; // 10:00 AM ET
export const WORKDAY_END_HOUR = 19; //  7:00 PM ET

/**
 * yyyy-MM-dd for `n` days before "today" on the NY calendar — the sales floor's day, not the
 * viewer's or UTC (toISOString-based dates showed "tomorrow" for late-evening ET users).
 * en-CA formats as yyyy-MM-dd directly.
 */
export function nyDaysAgo(n: number): string {
  // Anchor on TODAY's NY calendar date, then step back n whole days in UTC (which has no DST). A
  // fixed 24h subtraction from `now` would skip a calendar day on spring-forward and duplicate one
  // on fall-back, silently corrupting the streak/week counts on those two mornings a year.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: NY_TZ }).format(new Date()); // yyyy-MM-dd
  const base = Date.parse(`${today}T00:00:00Z`) - n * 86_400_000;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date(base));
}

/** Today's yyyy-MM-dd on the NY calendar. */
export function nyToday(): string {
  return nyDaysAgo(0);
}

export type WorkdayPhase = 'pre' | 'morning' | 'midday' | 'afternoon' | 'closing' | 'overtime';

export interface WorkdayStyle {
  /** Fill gradient for the progress bar. */
  barGradient: string;
  /** Knob / status accent color. */
  accent: string;
  /** Short status under the bar ("42% done" / "Overtime"). */
  statusLabel: string;
}

const WORKDAY_STYLE: Record<WorkdayPhase, Omit<WorkdayStyle, 'statusLabel'> & { status: (pct: number) => string }> = {
  pre: {
    barGradient: 'linear-gradient(90deg, var(--muted), color-mix(in srgb, var(--muted) 60%, var(--accent)))',
    accent: 'var(--muted)',
    status: () => 'Not started',
  },
  morning: {
    barGradient: 'linear-gradient(90deg, #22c55e, var(--accent))',
    accent: '#22c55e',
    status: (pct) => `${pct}% done`,
  },
  midday: {
    barGradient: 'linear-gradient(90deg, var(--accent), var(--accent-2))',
    accent: 'var(--accent)',
    status: (pct) => `${pct}% done`,
  },
  afternoon: {
    barGradient: 'linear-gradient(90deg, var(--accent-2), var(--violet))',
    accent: 'var(--violet)',
    status: (pct) => `${pct}% done`,
  },
  closing: {
    barGradient: 'linear-gradient(90deg, var(--orange), var(--warn))',
    accent: 'var(--orange)',
    status: (pct) => `${pct}% done`,
  },
  overtime: {
    barGradient: 'linear-gradient(90deg, var(--warn), var(--danger))',
    accent: 'var(--danger)',
    status: () => 'Overtime',
  },
};

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
  const startMin = WORKDAY_START_HOUR * 60;
  const endMin = WORKDAY_END_HOUR * 60;
  const span = endMin - startMin;
  const rawMin = h * 60 + min;
  const before = rawMin < startMin;
  const overtime = rawMin > endMin;
  const clamped = Math.max(startMin, Math.min(endMin, rawMin));
  const pct = before ? 0 : overtime ? 100 : Math.round(((clamped - startMin) / span) * 100);

  // Phase thresholds as fractions of the workday so they track the window (not fixed clock hours).
  let phase: WorkdayPhase;
  if (before) phase = 'pre';
  else if (overtime) phase = 'overtime';
  else if (rawMin < startMin + span * 0.33) phase = 'morning';
  else if (rawMin < startMin + span * 0.55) phase = 'midday';
  else if (rawMin < startMin + span * 0.78) phase = 'afternoon';
  else phase = 'closing';

  const styleDef = WORKDAY_STYLE[phase];
  const workday: WorkdayStyle = {
    barGradient: styleDef.barGradient,
    accent: styleDef.accent,
    statusLabel: styleDef.status(pct),
  };

  return {
    tod,
    pct,
    phase,
    workday,
    /** Knob sits on the fill end; stay inset so it doesn't clip the track. */
    knobPct: before ? 0 : Math.min(Math.max(pct, 2), 96),
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
