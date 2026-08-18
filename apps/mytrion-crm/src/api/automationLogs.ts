/**
 * Automation logs (GET /v1/admin/automation-logs) — one row per automation run, from Horizon and
 * from the legacy Zoho widget. The Admin "Automation Logs" tab reads from here.
 */
import { request } from './transport';

export const AUTOMATION_ORIGIN_SOURCES = ['Mytrion Horizon', 'Mytrion Zoho'] as const;
export type AutomationOriginSource = (typeof AUTOMATION_ORIGIN_SOURCES)[number];
export type AutomationPhase = 'started' | 'succeeded' | 'failed';

export interface AutomationLogEntry {
  id: string;
  runId: string;
  phase: AutomationPhase;
  durationMs: number | null;
  errorCode: string | null;
  sourceMytrion: string;
  automationType: string;
  agentName: string | null;
  originSource: AutomationOriginSource;
  /** Caller-supplied local trigger stamp (pass-through); `createdAt` is authoritative server time. */
  triggerTime: string | null;
  triggerDate: string | null;
  createdAt: string;
}

export interface AutomationLogFilter {
  automationType?: string;
  agentName?: string;
  originSource?: AutomationOriginSource;
  /** Free text across type + agent, matched server-side across ALL rows. */
  search?: string;
  /** ISO instants. */
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface AutomationLogFacets {
  automationTypes: string[];
  agentNames: string[];
  originSources: string[];
}

function toQuery(filter: AutomationLogFilter): Record<string, string | number | undefined> {
  return {
    automation_type: filter.automationType,
    agent_name: filter.agentName,
    origin_source: filter.originSource,
    search: filter.search,
    from: filter.from,
    to: filter.to,
  };
}

export async function listAutomationLogs(
  filter: AutomationLogFilter = {},
): Promise<{ entries: AutomationLogEntry[]; total: number }> {
  return (await request('GET', '/admin/automation-logs', {
    impersonate: false,
    query: { ...toQuery(filter), limit: filter.limit ?? 50, offset: filter.offset ?? 0 },
  })) as { entries: AutomationLogEntry[]; total: number };
}

export async function automationLogFacets(): Promise<AutomationLogFacets> {
  return (await request('GET', '/admin/automation-logs/facets', {
    impersonate: false,
  })) as AutomationLogFacets;
}

/** Hard ceiling the server also enforces. */
export const AUTOMATION_EXPORT_MAX = 10_000;

/** Every row matching the CURRENT filter, for export — not just the pages already loaded. */
export async function fetchAutomationLogsForExport(
  filter: AutomationLogFilter = {},
): Promise<AutomationLogEntry[]> {
  const res = (await request('GET', '/admin/automation-logs', {
    impersonate: false,
    timeoutMs: 120_000,
    query: { ...toQuery(filter), limit: AUTOMATION_EXPORT_MAX, offset: 0 },
  })) as { entries: AutomationLogEntry[]; total: number };
  return res.entries;
}
