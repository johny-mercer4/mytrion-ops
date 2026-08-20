export type MytrionUsageCoverageStatus = 'complete' | 'partial' | 'unavailable';
export type MytrionPresenceStatus = 'active' | 'idle' | 'offline';
export type MytrionUsageRangePreset = 'today' | 'last_7_days' | 'this_month' | 'custom';

export interface MytrionUsageCoverage {
  source: string;
  label: string;
  status: MytrionUsageCoverageStatus;
  availableFrom: string | null;
  availableThrough: string | null;
  note: string | null;
}

export interface MytrionUsageSummary {
  eligibleAgents: number;
  activeAgents: number | null;
  workspaceSessions: number | null;
  onlineSeconds: number | null;
  activeSeconds: number | null;
  uiActions: number | null;
  workOutcomes: number | null;
}

export interface MytrionUsageDay {
  date: string;
  partial: boolean;
  activeAgents: number | null;
  workspaceSessions: number | null;
  onlineSeconds: number | null;
  activeSeconds: number | null;
  uiActions: number | null;
  workOutcomes: number | null;
  aiTurns: number | null;
}

export interface SalesAgentUsageRow {
  workerId: string;
  displayName: string;
  currentStatus: MytrionPresenceStatus | null;
  signIns: number | null;
  workspaceSessions: number | null;
  onlineSeconds: number | null;
  activeSeconds: number | null;
  activeDays: number | null;
  uiActions: number | null;
  workOutcomes: number | null;
  ticketCreates: number | null;
  escalationCreates: number | null;
  automationStarted: number | null;
  automationSucceeded: number | null;
  automationFailed: number | null;
  calls: number | null;
  talkSeconds: number | null;
  aiTurns: number | null;
  aiToolCalls: number | null;
  lastActivityAt: string | null;
}

export interface MytrionUsageBreakdownRow {
  key: string;
  label: string;
  count: number | null;
}

export interface MytrionUsageSnapshot {
  scope: { mytrion: 'sales'; population: 'sales_agent' };
  timeZone: string;
  range: { preset: MytrionUsageRangePreset; from: string; to: string };
  computedAt: string;
  population: { eligibleAgents: number };
  coverage: MytrionUsageCoverage[];
  summary: MytrionUsageSummary;
  days: MytrionUsageDay[];
  agents: SalesAgentUsageRow[];
  breakdowns: {
    activity: MytrionUsageBreakdownRow[];
    workOutcomes: MytrionUsageBreakdownRow[];
    tickets: MytrionUsageBreakdownRow[];
    automations: MytrionUsageBreakdownRow[];
    ai: MytrionUsageBreakdownRow[];
  };
}
