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
  email: z.string().email().optional(),
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
  if (parsed.email !== undefined) ctx.email = parsed.email;
  if (parsed.actingAgent !== undefined) ctx.actingAgent = parsed.actingAgent;
  return ctx;
}

export const DEAD_LETTER_QUEUE = 'jobs.dead';

/** Notification pollers (card_status diff, later limit/receipt/balance). Singleton cron —
 *  runs never overlap; no-ops with no registered owners and empty NOTIFY_POLL_CARRIERS. */
export const notificationPollJob = defineJob({
  name: 'notification.poll',
  schema: z.object({}),
  queue: { policy: 'singleton', retryLimit: 0, expireInSeconds: 110, deadLetter: DEAD_LETTER_QUEUE },
});

/** Mini-app notification delivery — one outbox row (mini_app_notifications) per job. The
 *  handler is idempotent (only 'new' rows act), so re-delivery and retries are safe. */
export const notificationDispatchJob = defineJob({
  name: 'notification.dispatch',
  schema: z.object({ notificationId: z.string().min(1) }),
  queue: { retryLimit: 4, retryDelay: 60, retryBackoff: true, expireInSeconds: 300, deadLetter: DEAD_LETTER_QUEUE },
});

/** Phase-2 T3 — weekly accounting bundle + statement notification (Monday, JOBS_CRON_TZ).
 *  retryLimit 0 on purpose: the document sends are not idempotent — a retry would re-send files
 *  (the statement TEXT is deduped by the outbox key, the files are not). */
export const statementWeeklyJob = defineJob({
  name: 'notification.statement-weekly',
  schema: z.object({}),
  queue: { policy: 'singleton', retryLimit: 0, expireInSeconds: 600, deadLetter: DEAD_LETTER_QUEUE },
});

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

/**
 * LLM Monday summary — parked while Sales Mytrion Phase-1 retention is finished first,
 * then CS. Kept in ALL_JOBS for Admin visibility; see DISABLED_JOB_QUEUES.
 */
export const retentionScanJob = defineJob({
  name: 'automation.retention.weekly-scan',
  schema: emptyPayload,
  queue: { policy: 'singleton', retryLimit: 1, expireInSeconds: 600, deadLetter: DEAD_LETTER_QUEUE },
});

/**
 * Every hour: DWH frequency-breach scan → create/refresh/close retention cases (no LLM).
 * Optional lookback/limit are for Admin manual / backfill runs; cron sends `{}`.
 */
export const retentionCaseSyncJob = defineJob({
  name: 'automation.retention.case-sync',
  schema: z.object({
    lookbackDays: z.number().int().min(3).max(365).optional(),
    limit: z.number().int().min(1).max(2000).optional(),
    trigger: z.enum(['cron', 'manual']).optional(),
  }),
  queue: { policy: 'singleton', retryLimit: 1, expireInSeconds: 600, deadLetter: DEAD_LETTER_QUEUE },
});

/** Manual referral-ledger backfill. The Manager workspace itself calculates selected months live. */
export const referralBonusCalcJob = defineJob({
  name: 'automation.referral.bonus-calc',
  schema: z.object({
    /** 'YYYY-MM-01'. Omitted on cron; supplied to recompute or backfill a specific month. */
    periodMonth: z.string().regex(/^\d{4}-\d{2}-01$/).optional(),
    trigger: z.enum(['cron', 'manual']).optional(),
    triggeredBy: z.string().max(120).optional(),
  }),
  queue: { policy: 'singleton', retryLimit: 1, expireInSeconds: 900, deadLetter: DEAD_LETTER_QUEUE },
});

/**
 * Every 15 minutes: apply overdue retention deadlines (2BD → Retention, vacation,
 * Open Pool SLA, 10BD → CITI, etc.). Deterministic — no LLM.
 */
export const retentionDeadlineSweepJob = defineJob({
  name: 'automation.retention.deadline-sweep',
  schema: z.object({
    limit: z.number().int().min(1).max(500).optional(),
    trigger: z.enum(['cron', 'manual']).optional(),
  }),
  queue: { policy: 'singleton', retryLimit: 1, expireInSeconds: 300, deadLetter: DEAD_LETTER_QUEUE },
});

export const kpiSalesHourlySyncJob = defineJob({
  name: 'kpi.sales.hourly-sync',
  schema: z.object({ trigger: z.enum(['cron', 'manual']).optional() }),
  queue: { policy: 'singleton', retryLimit: 2, retryDelay: 60, expireInSeconds: 1800, deadLetter: DEAD_LETTER_QUEUE },
});

export const kpiSalesReconcileJob = defineJob({
  name: 'kpi.sales.nightly-reconcile',
  schema: z.object({
    lookbackDays: z.number().int().min(1).max(90).optional(),
    mode: z.enum(['reconcile', 'backfill']).optional(),
    trigger: z.enum(['cron', 'manual']).optional(),
  }),
  queue: { policy: 'singleton', retryLimit: 2, retryDelay: 120, expireInSeconds: 3600, deadLetter: DEAD_LETTER_QUEUE },
});

export const kpiSalesDailyRollupJob = defineJob({
  name: 'kpi.sales.daily-rollup',
  schema: z.object({
    days: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(31).optional(),
    trigger: z.enum(['cron', 'manual']).optional(),
  }),
  queue: { policy: 'singleton', retryLimit: 1, expireInSeconds: 1800, deadLetter: DEAD_LETTER_QUEUE },
});

export const kpiSalesMonthCloseJob = defineJob({
  name: 'kpi.sales.month-close',
  schema: z.object({
    periodStart: z.string().regex(/^\d{4}-\d{2}-01$/).optional(),
    trigger: z.enum(['cron', 'manual']).optional(),
  }),
  queue: { policy: 'singleton', retryLimit: 1, expireInSeconds: 3600, deadLetter: DEAD_LETTER_QUEUE },
});

/** C-27 BOCA browser automation — queued so the HTTP/UI request returns immediately. */
export const salesBocaRequestJob = defineJob({
  name: 'sales.boca-request',
  schema: z.object({
    ctx: tenantContextSchema,
    requestKey: z.string().min(1).max(160),
    appId: z.string().min(1).max(120),
    assignedTo: z.string().max(200).default(''),
    priority: z.enum(['', 'High', 'Normal', 'Low']).default(''),
    dueDate: z.string().max(20).default(''),
    status: z.string().max(50).default('Not Started'),
  }),
  // Never retry automatically: an upstream timeout may have created the BOCA task already.
  queue: { policy: 'standard', retryLimit: 0, expireInSeconds: 900, deadLetter: DEAD_LETTER_QUEUE },
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

/** Nightly deterministic Horizon platform capability catalog refresh. */
export const platformKnowledgeSyncJob = defineJob({
  name: 'maintenance.platform-knowledge-sync',
  schema: emptyPayload,
  queue: { policy: 'singleton', retryLimit: 1, expireInSeconds: 900 },
});

/** Dead-letter sink: audit + mark the linked task failed. */
export const deadLetterJob = defineJob({
  name: DEAD_LETTER_QUEUE,
  schema: z.object({ taskId: z.string().optional() }).passthrough(),
  queue: {},
});

/**
 * Billing Ledger daily snapshot (TZ §9) — recompute every section's Closing for a day and reconcile it
 * against the independent source. Singleton so two runs never overlap; an hour to expire because a full
 * book pass touches the DWH several times per section.
 */
export const billingLedgerSnapshotJob = defineJob({
  name: 'billing.ledger.daily-snapshot',
  schema: z.object({
    /** Defaults to today in America/Chicago. A past date recomputes that day (the upsert is idempotent). */
    asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    sections: z.array(z.string()).optional(),
    trigger: z.enum(['cron', 'manual']).optional(),
  }),
  queue: { policy: 'singleton', retryLimit: 1, expireInSeconds: 3600, deadLetter: DEAD_LETTER_QUEUE },
});

export const ALL_JOBS: Array<JobDef<z.ZodTypeAny>> = [
  agentRunJob,
  approvalsExpiryJob,
  memoryDecayJob,
  debtorSweepJob,
  retentionScanJob,
  retentionCaseSyncJob,
  retentionDeadlineSweepJob,
  referralBonusCalcJob,
  kpiSalesHourlySyncJob,
  kpiSalesReconcileJob,
  kpiSalesDailyRollupJob,
  kpiSalesMonthCloseJob,
  salesBocaRequestJob,
  billingLedgerSnapshotJob,
  verificationRecheckJob,
  checkpointSweepJob,
  platformKnowledgeSyncJob,
  // Mini-app notification queues — MUST be here so boss.ts createQueue() provisions them; the
  // workers boss.work() these names and notifyMiniApp enqueues 'notification.dispatch'. Missing
  // them meant the queues were never created and dispatch threw under FF_JOBS_ENABLED (the dev
  // inline fallback masked it — the cron-points-at-a-defined-queue test is what caught it).
  notificationDispatchJob,
  notificationPollJob,
  // Scheduled in CRON_SCHEDULES (weekly), so its queue MUST be provisioned here too — otherwise
  // applySchedules' boss.schedule() hits a queue-not-found FK error and jobs boot crashes.
  statementWeeklyJob,
  deadLetterJob,
];

/**
 * Intentionally parked queues — not cron-scheduled, not Admin-triggerable, no worker.
 * Boot unschedules any leftover pg-boss cron for these names.
 */
export const KPI_JOB_QUEUES = new Set<string>([
  kpiSalesHourlySyncJob.name,
  kpiSalesReconcileJob.name,
  kpiSalesDailyRollupJob.name,
  kpiSalesMonthCloseJob.name,
]);

export const DISABLED_JOB_QUEUES = new Set<string>([
  // Finish Sales Mytrion retention (deterministic case-sync + deadline-sweep), then CS; LLM later.
  retentionScanJob.name,
  // Temporary collection pause: protect Zoho API capacity while KPI request volume is reviewed.
  ...KPI_JOB_QUEUES,
]);

/** Department automations that run LLM agent turns — the scheduler gates these on the orchestrator flag. */
export const DEPARTMENT_AUTOMATION_QUEUES = new Set<string>([
  debtorSweepJob.name,
  verificationRecheckJob.name,
]);

/** Cron schedule per automation queue. Per-job timezone overrides preserve existing schedules. */
export const CRON_SCHEDULES: Array<{ name: string; cron: string; timezone?: string }> = [
  // 05:00 Central — after the DWH's nightly refresh and after the 02:15/04:00 ET jobs.
  { name: billingLedgerSnapshotJob.name, cron: '0 5 * * *', timezone: 'America/Chicago' },
  { name: debtorSweepJob.name, cron: '0 8 * * 1-5' }, // weekday mornings
  // Every hour: DWH → retention cases (incl. auto-close Returned). Singleton so runs never
  // overlap; Admin can also enqueue on demand for a manual / backfill pass.
  { name: retentionCaseSyncJob.name, cron: '0 * * * *' },
  // Every 15 minutes: Phase-1/2 timer paths (2BD, vacation, pool SLA, 10BD→CITI).
  { name: retentionDeadlineSweepJob.name, cron: '*/15 * * * *' },
  { name: verificationRecheckJob.name, cron: '0 7 * * *' }, // daily
  { name: checkpointSweepJob.name, cron: '30 3 * * *' }, // nightly
  { name: approvalsExpiryJob.name, cron: '15 * * * *' }, // hourly
  { name: memoryDecayJob.name, cron: '45 3 * * *' }, // nightly
  { name: platformKnowledgeSyncJob.name, cron: '15 4 * * *' }, // nightly, after maintenance jobs
  { name: notificationPollJob.name, cron: '*/2 * * * *' }, // card_status diff (no-op w/o pilot carriers)
  { name: statementWeeklyJob.name, cron: '0 7 * * 1' }, // weekly accounting bundle (no-op w/o pilot carriers)
  { name: kpiSalesHourlySyncJob.name, cron: '10 * * * *', timezone: 'America/New_York' },
  { name: kpiSalesReconcileJob.name, cron: '15 2 * * *', timezone: 'America/New_York' },
  { name: kpiSalesDailyRollupJob.name, cron: '0 4 * * *', timezone: 'America/New_York' },
  { name: kpiSalesMonthCloseJob.name, cron: '15 0 3 * *', timezone: 'America/New_York' },
];

/** Queues an admin may trigger from Mytrion Admin (empty / optional payload only). */
export const MANUAL_TRIGGERABLE_QUEUES = new Set<string>([
  billingLedgerSnapshotJob.name,
  debtorSweepJob.name,
  retentionCaseSyncJob.name,
  retentionDeadlineSweepJob.name,
  referralBonusCalcJob.name,
  verificationRecheckJob.name,
  checkpointSweepJob.name,
  approvalsExpiryJob.name,
  memoryDecayJob.name,
  platformKnowledgeSyncJob.name,
]);
