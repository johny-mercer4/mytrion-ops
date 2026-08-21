import type { MytrionPresenceStatus } from './mytrionUsageTypes.js';

export interface UsageRosterAgent {
  workerId: string;
  zohoUserId: string;
  displayName: string;
}

export interface AuditUsageDayFact {
  actorId: string;
  date: string;
  signIns: number;
  workspaceSessions: number;
  edits: number;
  retentionActions: number;
  ticketCreates: number;
  escalationCreates: number;
  lastAt: string | null;
}

export interface UsageBreakdownFact {
  actorId?: string;
  key: string;
  label: string;
  count: number;
}

export interface CallUsageDayFact {
  actorId: string;
  date: string;
  calls: number;
  talkSeconds: number;
  lastAt: string | null;
}

export interface TaskUsageDayFact {
  actorId: string;
  date: string;
  completed: number;
  lastAt: string | null;
}

export interface AutomationUsageDayFact {
  actorId: string;
  date: string;
  started: number;
  succeeded: number;
  failed: number;
  lastAt: string | null;
}

export interface AiUsageDayFact {
  actorId: string;
  date: string;
  turns: number;
  toolCalls: number;
  lastAt: string | null;
}

export interface PresenceUsageDayFact {
  workerId: string;
  date: string;
  onlineSeconds: number;
  activeSeconds: number;
  lastAt: string | null;
}

export interface ActivityUsageDayFact {
  workerId: string;
  date: string;
  eventName: string;
  count: number;
  lastAt: string | null;
}

export interface PresenceStatusFact {
  workerId: string;
  status: MytrionPresenceStatus;
}

export interface UsageRollupMetricFact {
  workerId: string;
  date: string;
  metricKey: string;
  value: number | null;
  status: 'complete' | 'partial' | 'unavailable';
}

export interface UsageTelemetryDayProof {
  date: string;
  presence: 'complete' | 'unavailable';
  activity: 'complete' | 'unavailable';
}

export interface UsageSourceSpan {
  source: string;
  availableFrom: string | null;
  availableThrough: string | null;
  /** Internal coverage boundary; complete daily rollups cover through day-end. */
  coveredThrough?: string | null;
}
