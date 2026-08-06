import { and, asc, count, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  mytrionTaskTypes,
  mytrionWorkerTaskEvents,
  mytrionWorkerTasks,
  type MytrionTaskType,
  type MytrionWorkerTask,
  type WorkerTaskEventType,
  type WorkerTaskPriority,
  type WorkerTaskSource,
  type WorkerTaskStatus,
} from '../db/schema/index.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow } from './util.js';

export interface CreateWorkerTaskInput {
  assigneeZohoUserId: string;
  taskType: string;
  subject: string;
  description?: string | null;
  content?: Record<string, unknown> | null;
  deadlineAt?: Date | null;
  priority?: WorkerTaskPriority;
  source: WorkerTaskSource;
  /** Manager desk slug; defaults to `sales` for legacy callers. */
  department?: string;
  externalId?: string | null;
  webhookKeyId?: string | null;
  idempotencyKey?: string | null;
  payloadHash?: string | null;
}

export interface UpdateWorkerTaskInput {
  expectedVersion: number;
  assigneeZohoUserId?: string;
  taskType?: string;
  subject?: string;
  description?: string | null;
  content?: Record<string, unknown> | null;
  deadlineAt?: Date | null;
  priority?: WorkerTaskPriority;
  status?: WorkerTaskStatus;
  comment?: string;
}

export interface ListWorkerTaskFilter {
  assigneeZohoUserId?: string;
  status?: WorkerTaskStatus;
  priority?: WorkerTaskPriority;
  department?: string;
  /** Free text over subject / description / task type. */
  search?: string;
  limit?: number;
  offset?: number;
}

/**
 * The WHERE for a task list. Shared by `list` and `countMatching` so a page and its total can never
 * disagree about what is being counted.
 */
function listClauses(ctx: TenantContext, filter: ListWorkerTaskFilter): SQL[] {
  const clauses: SQL[] = [eq(mytrionWorkerTasks.tenantId, ctx.tenantId)];
  if (filter.assigneeZohoUserId) {
    clauses.push(eq(mytrionWorkerTasks.assigneeZohoUserId, filter.assigneeZohoUserId));
  }
  if (filter.status) clauses.push(eq(mytrionWorkerTasks.status, filter.status));
  if (filter.priority) clauses.push(eq(mytrionWorkerTasks.priority, filter.priority));
  if (filter.department?.trim()) {
    clauses.push(eq(mytrionWorkerTasks.department, filter.department.trim()));
  }
  const needle = filter.search?.trim();
  if (needle) {
    // Escape the LIKE metacharacters so a subject search for "100%" or "a_b" matches literally
    // rather than turning into a wildcard.
    const escaped = needle.replace(/[\\%_]/g, (char) => `\\${char}`);
    const pattern = `%${escaped}%`;
    const matches = or(
      ilike(mytrionWorkerTasks.subject, pattern),
      ilike(mytrionWorkerTasks.description, pattern),
      ilike(mytrionWorkerTasks.taskType, pattern),
    );
    if (matches) clauses.push(matches);
  }
  return clauses;
}

function eventTypeForStatus(from: WorkerTaskStatus, to: WorkerTaskStatus): WorkerTaskEventType {
  if (to === 'completed') return 'completed';
  if (to === 'cancelled') return 'cancelled';
  if ((from === 'completed' || from === 'cancelled') && to === 'open') return 'reopened';
  return 'status_changed';
}

export const workerTaskRepo = {
  /**
   * Active task types a desk may use: the ones scoped to it, plus the shared ones (`department IS
   * NULL`). Omit `department` to get the whole catalog — that is the admin/reporting view, not what
   * a desk's picker should show.
   */
  async listTypes(ctx: TenantContext, department?: string): Promise<MytrionTaskType[]> {
    const desk = department?.trim();
    const clauses = [eq(mytrionTaskTypes.tenantId, ctx.tenantId), eq(mytrionTaskTypes.active, true)];
    if (desk) {
      const scoped = or(
        isNull(mytrionTaskTypes.department),
        eq(mytrionTaskTypes.department, desk),
      );
      // `or()` is only undefined when given no arguments; the guard keeps the types honest.
      if (scoped) clauses.push(scoped);
    }
    return db
      .select()
      .from(mytrionTaskTypes)
      .where(and(...clauses))
      .orderBy(asc(mytrionTaskTypes.sortOrder), asc(mytrionTaskTypes.label));
  },

  /**
   * Whether a code is usable on this desk. A code scoped to another desk must NOT be accepted just
   * because it exists — checking `listTypes(ctx)` for membership, as the routes used to, let a
   * Billing form post `agency_filing` and file it under Billing.
   */
  async isTypeAllowed(ctx: TenantContext, department: string, code: string): Promise<boolean> {
    const types = await this.listTypes(ctx, department);
    return types.some((type) => type.code === code);
  },

  async list(
    ctx: TenantContext,
    filter: ListWorkerTaskFilter = {},
  ): Promise<MytrionWorkerTask[]> {
    return db
      .select()
      .from(mytrionWorkerTasks)
      .where(and(...listClauses(ctx, filter)))
      .orderBy(desc(mytrionWorkerTasks.createdAt))
      .limit(Math.min(Math.max(filter.limit ?? 100, 1), 500))
      .offset(Math.max(filter.offset ?? 0, 0));
  },

  /** Total matching the SAME filter as `list`, so pagination reports the real size of the result. */
  async countMatching(ctx: TenantContext, filter: ListWorkerTaskFilter = {}): Promise<number> {
    const rows = await db
      .select({ n: count() })
      .from(mytrionWorkerTasks)
      .where(and(...listClauses(ctx, filter)));
    return Number(rows[0]?.n ?? 0);
  },

  /**
   * The board's numbers in ONE round trip: desk-wide status counts AND the count matching the
   * caller's filter.
   *
   * These used to be two queries plus a third for per-assignee load. A single round trip to the
   * prod DB costs ~550ms, so a desk with ZERO tasks paid ~2.2s of database time to be told it has
   * nothing — which is exactly what made an empty Tasks block feel broken. `FILTER` answers both
   * from one scan.
   *
   * The status counts deliberately ignore status/priority/search — they are what you read to decide
   * what to filter BY. Only the assignee filter narrows them, because "this agent's board" is a
   * different board rather than a filtered view of the same one.
   */
  async deskCounts(
    ctx: TenantContext,
    department: string,
    filter: ListWorkerTaskFilter = {},
  ): Promise<{ counts: Record<WorkerTaskStatus, number>; matching: number }> {
    const scope = [
      eq(mytrionWorkerTasks.tenantId, ctx.tenantId),
      eq(mytrionWorkerTasks.department, department),
    ];
    if (filter.assigneeZohoUserId) {
      scope.push(eq(mytrionWorkerTasks.assigneeZohoUserId, filter.assigneeZohoUserId));
    }
    const matching = and(...listClauses(ctx, { ...filter, department }));

    const rows = await db
      .select({
        open: sql<number>`count(*) FILTER (WHERE ${mytrionWorkerTasks.status} = 'open')::int`,
        inProgress: sql<number>`count(*) FILTER (WHERE ${mytrionWorkerTasks.status} = 'in_progress')::int`,
        completed: sql<number>`count(*) FILTER (WHERE ${mytrionWorkerTasks.status} = 'completed')::int`,
        cancelled: sql<number>`count(*) FILTER (WHERE ${mytrionWorkerTasks.status} = 'cancelled')::int`,
        matching: sql<number>`count(*) FILTER (WHERE ${matching})::int`,
      })
      .from(mytrionWorkerTasks)
      .where(and(...scope));

    const row = rows[0];
    return {
      counts: {
        open: Number(row?.open ?? 0),
        in_progress: Number(row?.inProgress ?? 0),
        completed: Number(row?.completed ?? 0),
        cancelled: Number(row?.cancelled ?? 0),
      },
      matching: Number(row?.matching ?? 0),
    };
  },

  async countByStatus(
    ctx: TenantContext,
    assigneeZohoUserId: string,
  ): Promise<Record<WorkerTaskStatus, number>> {
    const rows = await db
      .select({ status: mytrionWorkerTasks.status, count: sql<number>`count(*)::int` })
      .from(mytrionWorkerTasks)
      .where(
        and(
          eq(mytrionWorkerTasks.tenantId, ctx.tenantId),
          eq(mytrionWorkerTasks.assigneeZohoUserId, assigneeZohoUserId),
        ),
      )
      .groupBy(mytrionWorkerTasks.status);
    const counts: Record<WorkerTaskStatus, number> = {
      open: 0,
      in_progress: 0,
      completed: 0,
      cancelled: 0,
    };
    for (const row of rows) counts[row.status] = Number(row.count) || 0;
    return counts;
  },

  /**
   * Status counts across a whole desk (optionally narrowed to one assignee), independent of the
   * page being displayed. The Manager board's column headers and metric strip read this: printing
   * `rows.length` from a 100-row page over a 400-task desk is how a board quietly lies about the
   * size of the backlog.
   */
  async countByStatusForDepartment(
    ctx: TenantContext,
    department: string,
    assigneeZohoUserId?: string,
  ): Promise<Record<WorkerTaskStatus, number>> {
    const clauses = [
      eq(mytrionWorkerTasks.tenantId, ctx.tenantId),
      eq(mytrionWorkerTasks.department, department),
    ];
    if (assigneeZohoUserId) {
      clauses.push(eq(mytrionWorkerTasks.assigneeZohoUserId, assigneeZohoUserId));
    }
    const rows = await db
      .select({ status: mytrionWorkerTasks.status, n: count() })
      .from(mytrionWorkerTasks)
      .where(and(...clauses))
      .groupBy(mytrionWorkerTasks.status);
    const counts: Record<WorkerTaskStatus, number> = {
      open: 0,
      in_progress: 0,
      completed: 0,
      cancelled: 0,
    };
    for (const row of rows) counts[row.status] = Number(row.n) || 0;
    return counts;
  },

  /**
   * Open/in-progress assignments per assignee on a desk — the manager's "who is loaded" read.
   * Completed and cancelled work is excluded: a workload figure that counts finished tasks tells
   * you about history, not about who can take the next one.
   */
  async openLoadByAssignee(
    ctx: TenantContext,
    department: string,
  ): Promise<Array<{ assigneeZohoUserId: string; open: number; overdue: number }>> {
    const rows = await db
      .select({
        assigneeZohoUserId: mytrionWorkerTasks.assigneeZohoUserId,
        open: count(),
        overdue: sql<number>`count(*) FILTER (
          WHERE ${mytrionWorkerTasks.deadlineAt} IS NOT NULL
            AND ${mytrionWorkerTasks.deadlineAt} < now()
        )::int`,
      })
      .from(mytrionWorkerTasks)
      .where(
        and(
          eq(mytrionWorkerTasks.tenantId, ctx.tenantId),
          eq(mytrionWorkerTasks.department, department),
          or(
            eq(mytrionWorkerTasks.status, 'open'),
            eq(mytrionWorkerTasks.status, 'in_progress'),
          ) ?? sql`true`,
        ),
      )
      .groupBy(mytrionWorkerTasks.assigneeZohoUserId);
    return rows.map((row) => ({
      assigneeZohoUserId: row.assigneeZohoUserId,
      open: Number(row.open) || 0,
      overdue: Number(row.overdue) || 0,
    }));
  },

  async findById(ctx: TenantContext, taskId: string): Promise<MytrionWorkerTask | undefined> {
    const rows = await db
      .select()
      .from(mytrionWorkerTasks)
      .where(
        and(
          eq(mytrionWorkerTasks.tenantId, ctx.tenantId),
          eq(mytrionWorkerTasks.id, taskId),
        ),
      )
      .limit(1);
    return rows[0];
  },

  async findWebhookReplay(
    ctx: TenantContext,
    webhookKeyId: string,
    idempotencyKey: string,
  ): Promise<MytrionWorkerTask | undefined> {
    const rows = await db
      .select()
      .from(mytrionWorkerTasks)
      .where(
        and(
          eq(mytrionWorkerTasks.tenantId, ctx.tenantId),
          eq(mytrionWorkerTasks.webhookKeyId, webhookKeyId),
          eq(mytrionWorkerTasks.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    return rows[0];
  },

  async listEvents(ctx: TenantContext, taskId: string) {
    return db
      .select()
      .from(mytrionWorkerTaskEvents)
      .where(
        and(
          eq(mytrionWorkerTaskEvents.tenantId, ctx.tenantId),
          eq(mytrionWorkerTaskEvents.taskId, taskId),
        ),
      )
      .orderBy(asc(mytrionWorkerTaskEvents.occurredAt));
  },

  async create(
    ctx: TenantContext,
    actorUserId: string,
    input: CreateWorkerTaskInput,
  ): Promise<MytrionWorkerTask> {
    return db.transaction(async (tx) => {
      const rows = await tx
        .insert(mytrionWorkerTasks)
        .values({
          tenantId: ctx.tenantId,
          assigneeZohoUserId: input.assigneeZohoUserId,
          createdByUserId: actorUserId,
          source: input.source,
          webhookKeyId: input.webhookKeyId ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
          payloadHash: input.payloadHash ?? null,
          externalId: input.externalId ?? null,
          department: input.department?.trim() || 'sales',
          taskType: input.taskType,
          subject: input.subject,
          description: input.description ?? null,
          content: input.content ?? null,
          deadlineAt: input.deadlineAt ?? null,
          priority: input.priority ?? 'normal',
        })
        .returning();
      const task = firstOrThrow(rows, 'Failed to create worker task');
      await tx.insert(mytrionWorkerTaskEvents).values({
        tenantId: ctx.tenantId,
        taskId: task.id,
        eventType: 'created',
        actorUserId,
        toStatus: 'open',
        detail: {
          source: input.source,
          assigneeZohoUserId: input.assigneeZohoUserId,
          deadlineAt: input.deadlineAt?.toISOString() ?? null,
          priority: input.priority ?? 'normal',
          taskType: input.taskType,
        },
      });
      return task;
    });
  },

  async update(
    ctx: TenantContext,
    actorUserId: string,
    taskId: string,
    input: UpdateWorkerTaskInput,
  ): Promise<MytrionWorkerTask> {
    const existing = await this.findById(ctx, taskId);
    if (!existing) throw new NotFoundError('Worker task not found');

    const nextStatus = input.status ?? existing.status;
    const now = new Date();
    const set = {
      ...(input.assigneeZohoUserId !== undefined
        ? { assigneeZohoUserId: input.assigneeZohoUserId }
        : {}),
      ...(input.taskType !== undefined ? { taskType: input.taskType } : {}),
      ...(input.subject !== undefined ? { subject: input.subject } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.deadlineAt !== undefined ? { deadlineAt: input.deadlineAt } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      completedAt: nextStatus === 'completed' ? existing.completedAt ?? now : null,
      cancelledAt: nextStatus === 'cancelled' ? existing.cancelledAt ?? now : null,
      version: sql`${mytrionWorkerTasks.version} + 1`,
      updatedAt: now,
    };
    return db.transaction(async (tx) => {
      const rows = await tx
        .update(mytrionWorkerTasks)
        .set(set)
        .where(
          and(
            eq(mytrionWorkerTasks.tenantId, ctx.tenantId),
            eq(mytrionWorkerTasks.id, taskId),
            eq(mytrionWorkerTasks.version, input.expectedVersion),
          ),
        )
        .returning();
      const task = rows[0];
      if (!task) throw new ConflictError('Task changed; refresh and try again');

      const events: Array<{
        eventType: WorkerTaskEventType;
        detail?: Record<string, unknown>;
        fromStatus?: WorkerTaskStatus;
        toStatus?: WorkerTaskStatus;
      }> = [];
      if (input.status && input.status !== existing.status) {
        events.push({
          eventType: eventTypeForStatus(existing.status, input.status),
          fromStatus: existing.status,
          toStatus: input.status,
        });
      }
      if (
        input.assigneeZohoUserId &&
        input.assigneeZohoUserId !== existing.assigneeZohoUserId
      ) {
        events.push({
          eventType: 'reassigned',
          detail: {
            from: existing.assigneeZohoUserId,
            to: input.assigneeZohoUserId,
          },
        });
      }
      if (input.deadlineAt !== undefined) {
        events.push({
          eventType: 'deadline_changed',
          detail: {
            from: existing.deadlineAt?.toISOString() ?? null,
            to: input.deadlineAt?.toISOString() ?? null,
          },
        });
      }
      if (input.priority && input.priority !== existing.priority) {
        events.push({
          eventType: 'priority_changed',
          detail: { from: existing.priority, to: input.priority },
        });
      }
      if (input.comment) events.push({ eventType: 'commented', detail: { comment: input.comment } });
      for (const event of events) {
        await tx.insert(mytrionWorkerTaskEvents).values({
          tenantId: ctx.tenantId,
          taskId,
          actorUserId,
          eventType: event.eventType,
          ...(event.fromStatus ? { fromStatus: event.fromStatus } : {}),
          ...(event.toStatus ? { toStatus: event.toStatus } : {}),
          ...(event.detail ? { detail: event.detail } : {}),
        });
      }
      return task;
    });
  },
};
