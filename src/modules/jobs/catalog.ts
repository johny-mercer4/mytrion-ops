/**
 * Typed job catalog — every queue's name, payload schema (zod-validated on BOTH send and work),
 * and pg-boss queue policy in one place. Payloads embed the caller's TenantContext verbatim so
 * workers execute with exactly the requester's authority — a worker must NEVER widen it.
 */
import { z } from 'zod';
import { AUDIENCES, ROLES, type TenantContext } from '../../types/tenantContext.js';

/** Subset of pg-boss queue options we use (typed locally; v12 doesn't export a types namespace). */
export interface QueueConfig {
  policy?: 'standard' | 'short' | 'singleton' | 'stately';
  retryLimit?: number;
  retryDelay?: number;
  retryBackoff?: boolean;
  expireInSeconds?: number;
  deadLetter?: string;
}

export interface JobDef<S extends z.ZodTypeAny> {
  name: string;
  schema: S;
  queue: QueueConfig;
}

export function defineJob<S extends z.ZodTypeAny>(def: JobDef<S>): JobDef<S> {
  return def;
}

/** Zod mirror of TenantContext — keeps job payloads honest about what authority they carry. */
export const tenantContextSchema = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  audience: z.enum(AUDIENCES),
  role: z.enum(ROLES),
  scopes: z.array(z.string()),
  departments: z.array(z.string()),
  allDepartmentAccess: z.boolean(),
  bypassRbac: z.boolean().optional(),
  profiles: z.array(z.string()).optional(),
  callerRole: z.string().optional(),
  userName: z.string().optional(),
  actingAgent: z.string().optional(),
  requestId: z.string().min(1),
});

/** Rebuild a real TenantContext from a parsed payload (drops explicit-undefined optionals). */
export function payloadToContext(parsed: z.infer<typeof tenantContextSchema>): TenantContext {
  const ctx: TenantContext = {
    tenantId: parsed.tenantId,
    userId: parsed.userId,
    audience: parsed.audience,
    role: parsed.role,
    scopes: parsed.scopes,
    departments: parsed.departments,
    allDepartmentAccess: parsed.allDepartmentAccess,
    requestId: parsed.requestId,
  };
  if (parsed.bypassRbac !== undefined) ctx.bypassRbac = parsed.bypassRbac;
  if (parsed.profiles !== undefined) ctx.profiles = parsed.profiles;
  if (parsed.callerRole !== undefined) ctx.callerRole = parsed.callerRole;
  if (parsed.userName !== undefined) ctx.userName = parsed.userName;
  if (parsed.actingAgent !== undefined) ctx.actingAgent = parsed.actingAgent;
  return ctx;
}

export const DEAD_LETTER_QUEUE = 'jobs.dead';

/** On-demand async agent run (POST /v1/agent/tasks). */
export const agentRunJob = defineJob({
  name: 'agent.run',
  schema: z.object({
    taskId: z.string().min(1),
    ctx: tenantContextSchema,
    message: z.string().min(1).max(8000),
    agent: z.string().optional(),
    conversationId: z.string().optional(),
  }),
  queue: { retryLimit: 1, retryDelay: 30, expireInSeconds: 900, deadLetter: DEAD_LETTER_QUEUE },
});

const emptyPayload = z.object({}).passthrough();

/** Cron automations — payload-less; the worker builds its own scoped system context. */
export const debtorSweepJob = defineJob({
  name: 'automation.collection.debtor-sweep',
  schema: emptyPayload,
  queue: { policy: 'singleton', retryLimit: 1, expireInSeconds: 600, deadLetter: DEAD_LETTER_QUEUE },
});

export const retentionScanJob = defineJob({
  name: 'automation.retention.weekly-scan',
  schema: emptyPayload,
  queue: { policy: 'singleton', retryLimit: 1, expireInSeconds: 600, deadLetter: DEAD_LETTER_QUEUE },
});

/** Nightly: DWH frequency-breach scan → create/refresh/close retention cases (no LLM). */
export const retentionCaseSyncJob = defineJob({
  name: 'automation.retention.case-sync',
  schema: emptyPayload,
  queue: { policy: 'singleton', retryLimit: 1, expireInSeconds: 600, deadLetter: DEAD_LETTER_QUEUE },
});

export const verificationRecheckJob = defineJob({
  name: 'automation.verification.recheck-reminders',
  schema: emptyPayload,
  queue: { policy: 'singleton', retryLimit: 1, expireInSeconds: 600, deadLetter: DEAD_LETTER_QUEUE },
});

/** Daily: decay agent-memory importance and evict faded/expired rows. */
export const memoryDecayJob = defineJob({
  name: 'maintenance.memory-decay',
  schema: emptyPayload,
  queue: { policy: 'singleton', retryLimit: 1, expireInSeconds: 300 },
});

/** Marks stale pending write-approvals expired (24h TTL). */
export const approvalsExpiryJob = defineJob({
  name: 'maintenance.approvals-expiry',
  schema: emptyPayload,
  queue: { policy: 'singleton', retryLimit: 1, expireInSeconds: 300 },
});

/** Deletes checkpointed LangGraph threads idle longer than AGENT_CHECKPOINT_TTL_DAYS. */
export const checkpointSweepJob = defineJob({
  name: 'maintenance.checkpoint-ttl-sweep',
  schema: emptyPayload,
  queue: { policy: 'singleton', retryLimit: 1, expireInSeconds: 600 },
});

/** Dead-letter sink: audit + mark the linked task failed. */
export const deadLetterJob = defineJob({
  name: DEAD_LETTER_QUEUE,
  schema: z.object({ taskId: z.string().optional() }).passthrough(),
  queue: {},
});

export const ALL_JOBS: Array<JobDef<z.ZodTypeAny>> = [
  agentRunJob,
  approvalsExpiryJob,
  memoryDecayJob,
  debtorSweepJob,
  retentionScanJob,
  retentionCaseSyncJob,
  verificationRecheckJob,
  checkpointSweepJob,
  deadLetterJob,
];

/** Department automations that run LLM agent turns — the scheduler gates these on the orchestrator flag. */
export const DEPARTMENT_AUTOMATION_QUEUES = new Set<string>([
  debtorSweepJob.name,
  retentionScanJob.name,
  verificationRecheckJob.name,
]);

/** Cron schedule per automation queue (tz = JOBS_CRON_TZ). */
export const CRON_SCHEDULES: Array<{ name: string; cron: string }> = [
  { name: debtorSweepJob.name, cron: '0 8 * * 1-5' }, // weekday mornings
  { name: retentionScanJob.name, cron: '0 9 * * 1' }, // Monday morning
  { name: retentionCaseSyncJob.name, cron: '0 5 * * *' }, // nightly, before shift start
  { name: verificationRecheckJob.name, cron: '0 7 * * *' }, // daily
  { name: checkpointSweepJob.name, cron: '30 3 * * *' }, // nightly
  { name: approvalsExpiryJob.name, cron: '15 * * * *' }, // hourly
  { name: memoryDecayJob.name, cron: '45 3 * * *' }, // nightly
];
