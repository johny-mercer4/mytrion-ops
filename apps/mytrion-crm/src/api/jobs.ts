/**
 * pg-boss job dashboard (GET /v1/agent/jobs) + manual trigger (POST /v1/agent/jobs/:name/run).
 * Admin-only on the backend (allDepartmentAccess).
 */
import { request } from './transport';

export type JobTriggerKind = 'cron' | 'on_demand' | 'dead_letter';

export interface CatalogJob {
  name: string;
  title: string;
  description: string;
  cron: string | null;
  trigger: JobTriggerKind;
  triggerLabel: string;
  scheduleLabel: string;
  active: boolean;
  statusLabel: string;
  manualTriggerable: boolean;
  policy: string | null;
  retryLimit: number | null;
  expireInSeconds: number | null;
}

export interface QueueStateCount {
  name: string;
  state: string;
  count: number;
}

export interface JobRunRow {
  id: string;
  name: string;
  state: string;
  data: unknown;
  output: unknown;
  createdOn: string | null;
  startedOn: string | null;
  completedOn: string | null;
}

export interface JobsDashboard {
  enabled: boolean;
  /** Present when jobs are off or pg-boss schema could not be read. */
  reason?: string;
  cronTz: string;
  workerMode: string;
  catalog: CatalogJob[];
  schedules: Array<{ name: string; cron: string; timezone: string | null }>;
  counts: QueueStateCount[];
  runs: JobRunRow[];
}

export async function fetchJobsDashboard(opts: {
  name?: string;
  state?: string;
  limit?: number;
} = {}): Promise<JobsDashboard> {
  return (await request('GET', '/agent/jobs', {
    impersonate: false,
    query: {
      name: opts.name,
      state: opts.state,
      limit: opts.limit ?? 40,
    },
  })) as JobsDashboard;
}

export async function triggerJob(
  name: string,
  opts: { lookbackDays?: number; limit?: number } = {},
): Promise<{ queued: boolean; jobId: string; name: string }> {
  return (await request('POST', `/agent/jobs/${encodeURIComponent(name)}/run`, {
    impersonate: false,
    body: {
      ...(opts.lookbackDays !== undefined ? { lookback_days: opts.lookbackDays } : {}),
      ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
    },
  })) as { queued: boolean; jobId: string; name: string };
}
