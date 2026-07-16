// View-model types + formatting/color helpers for the Customer Service Mytrion. The
// panels render these shapes; live.ts maps the real backend payloads onto them (the
// static fixtures this file used to carry died with the live-data pass).

export type Business = string;
export type PayType = string;

export interface Application {
  id: string;
  appId: string;
  company: string;
  first: string;
  last: string;
  biz: Business;
  stage: string;
  wex: string;
  mc: string;
  dot: string;
  phone: string;
  email: string;
  city: string;
  state: string;
  credit: number | null;
  trucks: number;
  cards: number;
  date: string;
  agent: string;
  notes: string;
  cycle: string;
  pay: PayType;
  ta: 0 | 1;
  efs: 0 | 1;
  lmt: 0 | 1;
  mob: 0 | 1;
  chn: 0 | 1;
  verified: boolean;
  carrierId: string;
}

export type CitiStatus = string;
export type CitiRequest = string;
export type CitiDecision = string;

export interface CitiClient {
  id: string;
  name: string;
  appId: string;
  status: CitiStatus;
  request: CitiRequest;
  decision: CitiDecision;
  date: string;
  phone: string;
  email: string;
  agent: string;
  notes: string;
}

// ---- Analytics view-model ----

export interface KpiStat {
  label: string;
  value: string;
  hint?: string;
  delta?: { prev: number; current: number; higherIsBetter: boolean };
}

export interface VolumeDay {
  label: string;
  value: number;
  partial?: boolean;
}

export interface BreakdownItem {
  label: string;
  value: number;
  tone: 'good' | 'warn' | 'bad' | 'info' | 'neutral' | 'purple' | 'sky' | 'teal' | 'amber';
}

export interface LeaderboardRow {
  agent: string;
  col1: number;
  col2: number | string;
  col3: number;
}

export interface AnalyticsBlock {
  kpis: KpiStat[];
  volume: VolumeDay[];
  breakdown: BreakdownItem[];
  leaderboardCols: [string, string, string];
  leaderboard: LeaderboardRow[];
}

// ---- Home view-model ----

export interface ActivityRow {
  id: string;
  text: string;
  sub: string;
  time: string;
  dot: 'purple' | 'sky' | 'good' | 'bad' | 'orange';
}

export interface PriorityRow {
  label: string;
  count: number;
  tone: 'bad' | 'warn' | 'info' | 'neutral';
}

// ---- formatting / meta helpers ----
// Tones are restricted to StatusTone ('good'|'warn'|'bad'|'info'|'neutral') so
// every badge-facing helper below can feed StatusBadge directly. All helpers are
// tolerant of unknown values (live picklists drift) — unknown maps to 'neutral'.

export function stageMeta(stage: string): { tone: 'good' | 'bad' | 'info' | 'neutral' | 'warn' } {
  const map: Record<string, 'good' | 'bad' | 'info' | 'neutral' | 'warn'> = {
    'Application': 'info',
    'Application Sent': 'info',
    'Application Filled': 'info',
    'Adjudication': 'warn',
    'Credit Follow-up': 'bad',
    'CS Validation': 'warn',
    'Vendor Validation': 'warn',
    'EFS Processing': 'warn',
    'Implementation': 'info',
    'Expansion': 'good',
    'Cards Sent': 'info',
    'Cards Activated': 'info',
    'Card Funded': 'good',
    'Card Swiped': 'info',
    'Billing Form Sent': 'info',
    'Billing Form Filled': 'good',
    'Closed Won': 'good',
    'Closed Lost': 'bad',
  };
  return { tone: map[stage] ?? 'neutral' };
}

export function bizMeta(biz: Business): { tone: 'good' | 'bad' | 'info' | 'neutral' | 'warn' } {
  const map: Record<string, 'good' | 'bad' | 'info' | 'neutral' | 'warn'> = {
    LLC: 'info',
    Corporation: 'neutral',
    'Sole Proprietorship': 'neutral',
    Partnership: 'warn',
  };
  return { tone: map[biz] ?? 'neutral' };
}

export function creditTone(credit: number | null): 'good' | 'warn' | 'bad' | 'neutral' {
  if (credit == null) return 'neutral';
  if (credit >= 700) return 'good';
  if (credit >= 660) return 'warn';
  return 'bad';
}

export function citiStatusMeta(status: CitiStatus): { tone: 'good' | 'warn' | 'info' | 'neutral' } {
  const s = status.toLowerCase();
  if (s.includes('sent')) return { tone: 'info' };
  if (s.includes('closed')) return { tone: 'neutral' };
  if (s.includes('process')) return { tone: 'warn' };
  return { tone: 'neutral' };
}

export function citiRequestMeta(request: CitiRequest): { tone: 'good' | 'warn' | 'info' | 'neutral' } {
  return request.toLowerCase() === 'outbound' ? { tone: 'warn' } : { tone: 'info' };
}

export function citiDecisionMeta(decision: CitiDecision): { tone: 'good' | 'warn' | 'bad' | 'info' | 'neutral' } {
  const d = decision.toLowerCase();
  if (d.includes('octane')) return { tone: 'good' };
  if (d.includes('citi')) return { tone: 'info' };
  if (d.includes('debtor')) return { tone: 'bad' };
  return { tone: 'neutral' };
}

export function onboardingCount(app: Application): number {
  return app.ta + app.efs + app.lmt + app.mob + app.chn;
}

export function isClient(app: Application): boolean {
  return app.carrierId !== '';
}

export function fullName(app: Application): string {
  return `${app.first} ${app.last}`.trim();
}

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
