/**
 * Read-only job observability for Admin: catalog + schedules, per-queue/state counts,
 * and recent run rows (completed/failed/active) with pg-boss `output`.
 */
import { env } from '../../config/env.js';
import { pg } from '../../db/client.js';
import { ALL_JOBS, CRON_SCHEDULES, MANUAL_TRIGGERABLE_QUEUES } from './catalog.js';
import {
  jobMeta,
  scheduleLabelFor,
  triggerKindLabel,
  type JobTriggerKind,
} from './jobCatalogMeta.js';
import { bulkIngestJob } from './workers/knowledgeIngest.js';

export type { JobTriggerKind } from './jobCatalogMeta.js';

export interface QueueStateCount {
  name: string;
  state: string;
  count: number;
}

export interface RecentFailure {
  id: string;
  name: string;
  completedOn: string | null;
  output: unknown;
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

export interface CatalogJob {
  name: string;
  title: string;
  description: string;
  /** Cron expression when `trigger === 'cron'`; otherwise null. */
  cron: string | null;
  trigger: JobTriggerKind;
  /** "Scheduled (cron)" / "On demand (triggered)" / … */
  triggerLabel: string;
  /** Plain English: "Every 2 hours (America/Chicago)". */
  scheduleLabel: string;
  /**
   * Whether the queue is live right now.
   * Cron: registered in pg-boss schedules. On-demand/dead-letter: jobs subsystem enabled.
   */
  active: boolean;
  statusLabel: string;
  manualTriggerable: boolean;
  policy: string | null;
  retryLimit: number | null;
  expireInSeconds: number | null;
}

export async function jobCounts(): Promise<QueueStateCount[]> {
  const rows = await pg<{ name: string; state: string; count: string }[]>`
    SELECT name, state, count(*)::text AS count
    FROM ${pg(env.PGBOSS_SCHEMA)}.job
    GROUP BY name, state
    ORDER BY name, state
  `;
  return rows.map((r) => ({ name: r.name, state: r.state, count: Number(r.count) }));
}

export async function recentFailures(limit = 20): Promise<RecentFailure[]> {
  const rows = await pg<{ id: string; name: string; completed_on: Date | null; output: unknown }[]>`
    SELECT id, name, completed_on, output
    FROM ${pg(env.PGBOSS_SCHEMA)}.job
    WHERE state = 'failed'
    ORDER BY completed_on DESC NULLS LAST
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    completedOn: r.completed_on ? r.completed_on.toISOString() : null,
    output: r.output,
  }));
}

export async function recentJobRuns(opts: {
  name?: string | undefined;
  state?: string | undefined;
  limit?: number | undefined;
}): Promise<JobRunRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 40, 1), 100);
  const name = opts.name?.trim() || null;
  const state = opts.state?.trim() || null;
  const rows = await pg<
    {
      id: string;
      name: string;
      state: string;
      data: unknown;
      output: unknown;
      created_on: Date | null;
      started_on: Date | null;
      completed_on: Date | null;
    }[]
  >`
    SELECT id, name, state, data, output, created_on, started_on, completed_on
    FROM ${pg(env.PGBOSS_SCHEMA)}.job
    WHERE (${name}::text IS NULL OR name = ${name})
      AND (${state}::text IS NULL OR state = ${state})
    ORDER BY coalesce(completed_on, started_on, created_on) DESC NULLS LAST
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    state: r.state,
    data: r.data,
    output: r.output,
    createdOn: r.created_on ? r.created_on.toISOString() : null,
    startedOn: r.started_on ? r.started_on.toISOString() : null,
    completedOn: r.completed_on ? r.completed_on.toISOString() : null,
  }));
}

function triggerOf(name: string, cron: string | null): JobTriggerKind {
  if (cron) return 'cron';
  if (name === 'jobs.dead') return 'dead_letter';
  return 'on_demand';
}

/**
 * Static catalog from code. Pass live schedule names + jobsEnabled so Active reflects
 * whether cron is actually registered in pg-boss (LLM automations can be gated off).
 */
export function listJobCatalog(opts: {
  jobsEnabled: boolean;
  liveScheduleNames?: ReadonlySet<string> | undefined;
} = { jobsEnabled: false }): CatalogJob[] {
  const cronByName = new Map(CRON_SCHEDULES.map((s) => [s.name, s.cron]));
  const live = opts.liveScheduleNames ?? new Set<string>();
  const defs = [...ALL_JOBS, bulkIngestJob];
  return defs.map((j) => {
    const cron = cronByName.get(j.name) ?? null;
    const trigger = triggerOf(j.name, cron);
    const meta = jobMeta(j.name);
    const scheduleLabel = scheduleLabelFor({ trigger, cron, name: j.name });
    let active = false;
    let statusLabel = 'Off';
    if (!opts.jobsEnabled) {
      active = false;
      statusLabel = 'Off — jobs disabled';
    } else if (trigger === 'cron') {
      active = live.has(j.name);
      statusLabel = active ? 'Active' : 'Inactive — not scheduled';
    } else if (trigger === 'dead_letter') {
      active = true;
      statusLabel = 'Active — receives failures';
    } else {
      active = true;
      statusLabel = 'Ready — waits for a trigger';
    }
    return {
      name: j.name,
      title: meta.title,
      description: meta.description,
      cron,
      trigger,
      triggerLabel: triggerKindLabel(trigger),
      scheduleLabel,
      active,
      statusLabel,
      manualTriggerable: MANUAL_TRIGGERABLE_QUEUES.has(j.name),
      policy: j.queue.policy ?? null,
      retryLimit: j.queue.retryLimit ?? null,
      expireInSeconds: j.queue.expireInSeconds ?? null,
    };
  });
}
