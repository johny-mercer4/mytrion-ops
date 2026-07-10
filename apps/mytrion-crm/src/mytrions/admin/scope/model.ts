/**
 * Octane Scope — shared model: types, icon paths, platform logos and color maps.
 * Direct port of the RnD widget's agent-scope panel (zoho-octane/app/agent-scope),
 * kept 1:1 so both UIs read the same lifecycle map and risk-item node ids.
 */
import type { SyntheticEvent } from 'react';

/* ── flow / blueprint types ── */
export type NodeKind =
  | 'call'
  | 'good'
  | 'bad'
  | 'info'
  | 'decision'
  | 'start'
  | 'win'
  | 'handoff'
  | 'deal';

export interface FlowNodeDef {
  id: string;
  label: string;
  kind: NodeKind;
  icon?: string;
  platform?: string;
  depts?: string[];
  tools?: string;
  note?: string;
  side?: 'left' | 'right';
}

export interface FlowEdgeDef {
  from: string;
  to: string;
  label?: string;
}

export interface FlowDef {
  nodes: FlowNodeDef[];
  edges: FlowEdgeDef[];
}

export interface BlueprintDef {
  name: string;
  flow: FlowDef;
}

/* ── stage / cycle content ── */
export interface DepartmentDef {
  name: string;
  color: string;
  icon: string;
  items: string[];
  platforms: string[];
  external?: boolean;
}

export interface AutomationDef {
  icon: string;
  title?: string;
  when?: string;
  then?: string;
  text?: string;
  code?: string;
  desc?: string;
}

export interface MetricDef {
  label: string;
  icon: string;
  value?: string;
}

export interface EngineFactorDef {
  label: string;
  icon: string;
  color: string;
}

export interface EngineDef {
  by: string;
  trigger: string;
  engine: string;
  output: string;
  factors: EngineFactorDef[];
}

/** What the drill-down modal needs — both intake stages and After cycles satisfy it. */
export interface DetailNode {
  id: string;
  color: string;
  icon: string;
  title: string;
  num?: number;
  departments: DepartmentDef[];
  blueprints?: BlueprintDef[];
  flow?: FlowDef;
  engine?: EngineDef;
  autoBy?: string;
  autos?: AutomationDef[];
  platforms: string[];
  metrics?: MetricDef[];
}

export interface StageDef extends DetailNode {
  num: number;
  short: string;
  desc: string;
  terminal?: boolean;
}

export interface CycleDef extends DetailNode {
  label: string;
  short: string;
  from: string;
  desc: string;
}

/* ── icon path set (24×24 stroke paths) ── */
export const OCT_ICONS: Record<string, string> = {
  funnel: 'M3 5h18M7 10h10M10 15h4M11 19h2',
  refresh: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-14.357-2m14.357 2H15',
  megaphone: 'M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z',
  beaker: 'M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z',
  user: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  signal: 'M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0',
  calendar: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  clock: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  sliders: 'M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4',
  globe: 'M3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 010 18 15 15 0 010-18zM21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  bolt: 'M13 10V3L4 14h7v7l9-11h-7z',
  cpu: 'M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M8 8h8v8H8V8z',
  check: 'M5 13l4 4L19 7',
  phone: 'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11 11 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z',
  bell: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
  dollar: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  chart: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  people: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
  grid: 'M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z',
  eye: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z',
  clipboard: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01',
  external: 'M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14',
  card: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
  mail: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  cross: 'M6 18L18 6M6 6l12 12',
  flag: 'M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 2H21l-3 6 3 6h-8.5l-1-2H5a2 2 0 00-2 2z',
  ban: 'M18.364 5.636a9 9 0 11-12.728 0M5.636 5.636l12.728 12.728',
  device: 'M10 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4a2 2 0 01-2-2V5a2 2 0 012-2zm1 15h2',
  hand: 'M7 11V7a2 2 0 012-2 2 2 0 012 2m0 0V5a2 2 0 012-2 2 2 0 012 2v2m0 0a2 2 0 012-2 2 2 0 012 2v6a7 7 0 01-7 7H10a7 7 0 01-7-7v-1a2 2 0 012-2 2 2 0 012 2',
};

/** R&D rides a distinct accent everywhere it appears. */
export const OCT_RND = '#FACC15';

/* ── vendor → logo (Simple Icons slug) / inline icon / text fallback ── */
interface PlatformMeta {
  slug?: string;
  icon?: string;
  abbr?: string;
  logo?: string;
}

export const OCT_PLATFORMS: Record<string, PlatformMeta> = {
  Facebook: { slug: 'facebook' },
  Website: { icon: 'globe' },
  Meta: { slug: 'meta' },
  Instagram: { slug: 'instagram' },
  'Zoho CRM': { slug: 'zoho' },
  'Zoho Desk': { slug: 'zoho' },
  Zapier: { slug: 'zapier' },
  RingCentral: { abbr: 'RG' },
  Telegram: { slug: 'telegram' },
  Twilio: { abbr: 'TW' },
  Synology: { slug: 'synology' },
  WEX: { abbr: 'WEX' },
  EFS: { abbr: 'EFS' },
  'Broker Snapshot': { abbr: 'BS' },
  Gong: { abbr: 'GO' },
  'Zoho Flow': { slug: 'zoho' },
  Outlook: { abbr: 'OL' },
  'Sales Mytrion': { abbr: 'SM' },
  Gmail: { slug: 'gmail' },
  WhatsApp: { slug: 'whatsapp' },
  'Octane App': { icon: 'device' },
  Plaid: { slug: 'plaid' },
  Stripe: { slug: 'stripe' },
  FMCSA: { abbr: 'FM' },
  Highway: { abbr: 'HW' },
  CreditSafe: { abbr: 'CSf' },
  iSoftPull: { abbr: 'iSP' },
  CMP: { abbr: 'CMP' },
  'LOC Calculator': { abbr: 'LOC' },
  Merchant: { abbr: 'MCH' },
  Allianz: { abbr: 'ALZ' },
};

/* ── blueprint node-kind → color (React Flow edges + node accents) ── */
export const OCT_KIND: Record<NodeKind, string> = {
  call: '#8B5CF6',
  good: '#34D399',
  bad: '#EF4444',
  info: '#F59E0B',
  decision: '#F97316',
  start: '#64748B',
  win: '#2ECC71',
  handoff: '#F97316',
  deal: '#14B8A6',
};

/* ── department chips under blueprint status nodes ── */
export const OCT_DEPT_COLOR: Record<string, string> = {
  Sales: '#00BFFF',
  Marketing: '#EC4899',
  'R&D': '#06B6D4',
  'Customer Service': '#F97316',
  Verification: '#4ADE80',
  Billing: '#6366F1',
  WEX: '#6366F1',
};

/* ── icon choices offered when creating/editing a risk item ── */
export const OCT_RISK_ICONS = [
  'ban', 'flag', 'hand', 'clock', 'bell', 'dollar', 'phone', 'mail', 'user', 'people',
  'clipboard', 'eye', 'bolt', 'refresh', 'check', 'cross', 'sliders', 'signal', 'card',
  'globe', 'beaker', 'chart',
] as const;

export const OCT_RISK_DEFAULT_ICON: Record<string, string> = {
  blocker: 'ban',
  red_flag: 'flag',
  manual: 'hand',
};

/* ── helpers ── */
export function ic(key: string | undefined): string {
  return (key && OCT_ICONS[key]) || '';
}

/** #RRGGBB → rgba(r,g,b,a) */
export function hexA(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export function deptColor(d: Pick<DepartmentDef, 'name' | 'color'>): string {
  return d.name === 'R&D' ? OCT_RND : d.color;
}

export interface PlatformVM {
  name: string;
  logo: string | null;
  iconPath: string | null;
  abbr: string | null;
}

export function platVM(name: string): PlatformVM {
  const m = OCT_PLATFORMS[name] ?? {};
  if (m.logo) return { name, logo: m.logo, iconPath: null, abbr: null };
  if (m.slug) return { name, logo: `https://cdn.simpleicons.org/${m.slug}`, iconPath: null, abbr: null };
  if (m.icon) return { name, logo: null, iconPath: ic(m.icon), abbr: null };
  return { name, logo: null, iconPath: null, abbr: m.abbr ?? name.slice(0, 3).toUpperCase() };
}

/** Hide a simple-icons tile whose logo failed to load (offline / unknown slug). */
export function hideLogoTile(e: SyntheticEvent<HTMLImageElement>): void {
  const tile = e.currentTarget.closest<HTMLElement>('[data-logo-tile]');
  if (tile) tile.style.display = 'none';
}

/** Normalize a stage OR After-cycle to its list of blueprints. */
export function blueprintsOf(node: DetailNode | null | undefined): BlueprintDef[] {
  if (!node) return [];
  if (node.blueprints) return node.blueprints;
  if (node.flow) return [{ name: 'Blueprint', flow: node.flow }];
  return [];
}
