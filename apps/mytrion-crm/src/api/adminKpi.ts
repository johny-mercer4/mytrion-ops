import { request } from './transport';

export type KpiDataStatus = 'complete' | 'partial' | 'unavailable';

export interface AdminKpiTable {
  name: string;
  group: 'identity' | 'collection' | 'tasks' | 'telemetry' | 'reporting';
  purpose: string;
  createdForKpi: boolean;
  rowCount: number;
}

export interface AdminKpiMetric {
  metricKey: string;
  label: string;
  unit: string;
  aggregation: 'sum' | 'last' | 'ratio';
  version: number;
  numericValue: number | null;
  numerator: number | null;
  denominator: number | null;
  dataStatus: KpiDataStatus;
}

export interface AdminKpiRun {
  id: string;
  source: string;
  mode: string;
  status: 'running' | 'completed' | 'partial' | 'failed';
  windowStart: string | null;
  windowEnd: string | null;
  cursor: string | null;
  recordsSeen: number;
  recordsWritten: number;
  linkedFacts: number;
  unresolvedMappings: number;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface AdminKpiMapping {
  id: string;
  source: string;
  sourceKey: string;
  observedLabel: string | null;
  reason: string;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface AdminKpiOverview {
  enabled: boolean;
  reportingTimezone: string;
  range: {
    from: string;
    to: string;
    availableFrom: string | null;
    availableTo: string | null;
  };
  tables: AdminKpiTable[];
  metrics: AdminKpiMetric[];
  ingestionRuns: AdminKpiRun[];
  unresolvedWorkerMappings: AdminKpiMapping[];
}

export interface AdminKpiWorker {
  id: string;
  zohoUserId: string;
  displayName: string | null;
  email: string | null;
  currentProfileName: string | null;
  currentRoleName: string | null;
  sourceActive: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  eligible: boolean;
}

export interface AdminKpiMetricValue {
  metricKey: string;
  metricVersion: number;
  numericValue: number | null;
  numerator: number | null;
  denominator: number | null;
  dataStatus: KpiDataStatus;
}

export interface AdminKpiDay {
  id: string;
  reportingDate: string;
  calculationVersion: number;
  computedAt: string;
  sourceWatermarks: Record<string, string>;
  values: AdminKpiMetricValue[];
}

export interface AdminKpiSnapshot {
  id: string;
  periodStart: string;
  revision: number;
  timezone: string;
  workerProfileName: string | null;
  workerRoleName: string | null;
  sourceWatermarks: Record<string, string>;
  finalizedAt: string;
  values: AdminKpiMetricValue[];
}

export interface AdminKpiFact {
  id: number;
  workerId: string;
  workerName: string | null;
  source: string;
  sourceKey: string;
  metricKey: string;
  metricVersion: number;
  revision: number;
  occurredAt: string;
  reportingDate: string;
  numericValue: number;
  dataStatus: KpiDataStatus;
  dimensions: Record<string, string | number | boolean | null> | null;
  supersedesId: number | null;
  observedAt: string;
}

export async function getAdminKpiOverview(
  range: { from?: string; to?: string } = {},
): Promise<AdminKpiOverview> {
  return (await request('GET', '/admin/kpi/overview', { query: range })) as AdminKpiOverview;
}

export async function listAdminKpiWorkers(): Promise<AdminKpiWorker[]> {
  const data = (await request('GET', '/admin/kpi/workers')) as {
    workers: AdminKpiWorker[];
  };
  return data.workers;
}

export async function listAdminKpiDays(
  workerId: string,
  from: string,
  to: string,
): Promise<AdminKpiDay[]> {
  const data = (await request(
    'GET',
    `/admin/kpi/workers/${encodeURIComponent(workerId)}/daily`,
    { query: { from, to } },
  )) as { days: AdminKpiDay[] };
  return data.days;
}

export async function listAdminKpiSnapshots(
  workerId: string,
): Promise<AdminKpiSnapshot[]> {
  const data = (await request(
    'GET',
    `/admin/kpi/workers/${encodeURIComponent(workerId)}/monthly`,
  )) as { snapshots: AdminKpiSnapshot[] };
  return data.snapshots;
}

export async function listAdminKpiFacts(filters: {
  source?: string;
  metricKey?: string;
  workerId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}): Promise<AdminKpiFact[]> {
  const data = (await request('GET', '/admin/kpi/facts', {
    query: filters,
  })) as { facts: AdminKpiFact[] };
  return data.facts;
}
