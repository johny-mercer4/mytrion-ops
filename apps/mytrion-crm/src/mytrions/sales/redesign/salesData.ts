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
  return `font-family:'Space Mono',monospace;font-size:10px;font-weight:600;padding:2px 7px;border-radius:var(--radius-md);color:${col};background:color-mix(in srgb, ${col} 15%, transparent)`;
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
 * Order: daily → sell → measure → parked soon (SOON tabs always last).
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
      { id: 'tasks', label: 'My Tasks', icon: 'clipboardCheck' },
    ],
  },
  {
    id: 'sell',
    items: [
      { id: 'records', label: 'Data Center', icon: 'records' },
      { id: 'create', label: 'Create', icon: 'create' },
      { id: 'carriers', label: 'Carriers', icon: 'carriers' },
      // Retention owns Cases + Open Pool as in-page tabs (Phase 1 live).
      { id: 'retention', label: 'Retention', icon: 'retention' },
    ],
  },
  {
    id: 'measure',
    items: [
      { id: 'auto', label: 'Automations', icon: ICO.bolt },
      { id: 'dash', label: 'Dashboard', icon: 'dash' },
    ],
  },
  {
    id: 'soon',
    items: [
      // LIVE on the native comms path (/v1/comms), not Zoho Desk. The old Desk-backed TicketsTab is no
      // longer rendered; Sales now mounts the shared TicketConsole in requester mode.
      { id: 'tickets', label: 'Tickets', icon: 'tickets' },
      { id: 'verification', label: 'Verification', icon: 'verification' },
      // `soon` is now a LAYOUT SLOT, not a status: every tab in it has shipped (My Tasks moved up to
      // `daily`, Tickets went native, Verification and Call Hub landed). Kept as its own group for
      // the sidebar divider. Re-parking anything is still a one-word change.
      { id: 'callHub', label: 'Call Hub', icon: 'callHub' },
    ],
  },
];

/** Flat list for lookups (comingSoon checks, labels, etc.). */
export const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/**
 * True when the Tickets tab is navigable (comingSoon dropped in NAV_GROUPS). Gates the unread
 * badge (`/v1/comms/unread`) and openTicket navigation. Flip the NAV entry's comingSoon to park
 * everything at once.
 *
 * Currently TRUE — the native comms queue is live. The old gate existed because the Desk-backed
 * badge paged up to 20 ticket pages for a number nobody could see while parked; the comms badge is
 * a single count query, so the cost that motivated the gate is gone.
 */
export const TICKETS_ENABLED: boolean = !NAV.some((n) => n.id === 'tickets' && n.comingSoon === true);

/**
 * One-line description per tab — the single source of truth for the sentence under a page's header
 * (see `SalesPageHead`). These used to be a second set of TITLES ("Assignments", "Pipeline Hub")
 * printed in the top bar beside the nav label, while every tab separately hard-coded both a heading
 * and its own description. The section NAME now lives only in the sidebar + top bar, and the
 * sentence explaining it lives only here, so the two can never drift or echo each other.
 *
 * A tab may pass its own `description` to `SalesPageHead` when the copy has to be dynamic
 * (Call Hub names the agent, Automations counts the catalog).
 */
// `as const` (not `Record<string, string>`) so a literal key resolves to a definite string under
// `noUncheckedIndexedAccess`, and a typo in `NAV_DESC.taks` is a compile error.
export const NAV_DESC = {
  home: 'Your day at a glance — goal, announcements and what needs a call.',
  inbox: 'Reminders, alerts and tasks assigned to you.',
  tasks: 'Drag cards across columns to update status. Open any card for full detail and history.',
  tickets: 'Tickets and escalations you raised, with their live conversation.',
  retention: 'Quiet clients that need winning back — your cases and the shared open pool.',
  verification: 'Newest applications first. Review live compliance stages and answer Verification requests.',
  records: 'Everything about your pipeline — clients, leads, deals, rejections and money codes.',
  create: 'Raise a ticket, escalate a request, or add a lead.',
  auto: 'Handle Customer Service, Billing and Verification yourself — no ticket needed.',
  dash: 'Live sales, company and debtor performance.',
  carriers: 'Search by DOT number, company name or phone — then create a lead when it’s a fit.',
  callHub: 'Your Mytrion and Zoho call history, merged. Open a row to redial.',
} as const;

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
    /** Knob sits on the fill end. Floor 2% keeps it off the left cap; ceiling 100% lets it reach
     *  the end when the workday is over (the track container is overflow:visible, so no clip). */
    knobPct: before ? 0 : Math.min(Math.max(pct, 2), 100),
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
