import { and, asc, desc, eq, sql } from 'drizzle-orm';
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

function eventTypeForStatus(from: WorkerTaskStatus, to: WorkerTaskStatus): WorkerTaskEventType {
  if (to === 'completed') return 'completed';
  if (to === 'cancelled') return 'cancelled';
  if ((from === 'completed' || from === 'cancelled') && to === 'open') return 'reopened';
  return 'status_changed';
}

export const workerTaskRepo = {
  async listTypes(ctx: TenantContext): Promise<MytrionTaskType[]> {
    return db
      .select()
      .from(mytrionTaskTypes)
      .where(and(eq(mytrionTaskTypes.tenantId, ctx.tenantId), eq(mytrionTaskTypes.active, true)))
      .orderBy(asc(mytrionTaskTypes.label));
  },

  async list(
    ctx: TenantContext,
    filter: {
      assigneeZohoUserId?: string;
      status?: WorkerTaskStatus;
      department?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<MytrionWorkerTask[]> {
    const clauses = [eq(mytrionWorkerTasks.tenantId, ctx.tenantId)];
    if (filter.assigneeZohoUserId) {
      clauses.push(eq(mytrionWorkerTasks.assigneeZohoUserId, filter.assigneeZohoUserId));
    }
    if (filter.status) clauses.push(eq(mytrionWorkerTasks.status, filter.status));
    if (filter.department?.trim()) {
      clauses.push(eq(mytrionWorkerTasks.department, filter.department.trim()));
    }
    return db
      .select()
      .from(mytrionWorkerTasks)
      .where(and(...clauses))
      .orderBy(desc(mytrionWorkerTasks.createdAt))
      .limit(Math.min(Math.max(filter.limit ?? 100, 1), 500))
      .offset(Math.max(filter.offset ?? 0, 0));
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
