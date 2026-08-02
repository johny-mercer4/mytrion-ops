import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { env } from '../../config/env.js';
import type { WorkerTaskStatus } from '../../db/schema/index.js';
import {
  AppError,
  AuthError,
  ConflictError,
  NotFoundError,
  RBACError,
} from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { systemContext } from '../../modules/auth/authService.js';
import {
  verifyTaskWebhookSignature,
  webhookPayloadHash,
} from '../../modules/kpi/taskWebhookAuth.js';
import {
  KPI_ACTIVITY_EVENT_NAMES,
  kpiTelemetryRepo,
} from '../../repos/kpiTelemetryRepo.js';
import { kpiWorkerRepo } from '../../repos/kpiWorkerRepo.js';
import { isUniqueViolation } from '../../repos/util.js';
import { workerTaskRepo } from '../../repos/workerTaskRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment } from './helpers.js';

const prioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);
const statusSchema = z.enum(['open', 'in_progress', 'completed', 'cancelled']);
const taskBodySchema = z.object({
  assigneeZohoUserId: z.string().trim().min(1).max(120),
  type: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  subject: z.string().trim().min(1).max(200),
  description: z.string().max(10_000).optional(),
  content: z.record(z.unknown()).optional(),
  deadlineAt: z.string().datetime({ offset: true }).optional(),
  priority: prioritySchema.optional(),
  externalId: z.string().trim().max(200).optional(),
});
const managerPatchSchema = z
  .object({
    version: z.number().int().positive(),
    assigneeZohoUserId: z.string().trim().min(1).max(120).optional(),
    type: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/).optional(),
    subject: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(10_000).nullable().optional(),
    content: z.record(z.unknown()).nullable().optional(),
    deadlineAt: z.string().datetime({ offset: true }).nullable().optional(),
    priority: prioritySchema.optional(),
    status: statusSchema.optional(),
    comment: z.string().trim().min(1).max(4000).optional(),
  })
  .refine((value) => Object.keys(value).some((key) => key !== 'version'), {
    message: 'At least one task change is required',
  });
const listTaskQuerySchema = z.object({
  assigneeZohoUserId: z.string().max(120).optional(),
  status: statusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
const myTaskQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
/** Assignee kanban may land on any board column (incl. reopen from terminal). */
const workerStatusSchema = z.object({
  version: z.number().int().positive(),
  status: statusSchema,
});
const presenceSchema = z.object({
  sessionId: z.string().trim().min(8).max(128),
  events: z
    .array(
      z.object({
        clientEventId: z.string().trim().min(8).max(128),
        state: z.enum(['active', 'idle', 'hidden', 'ended']),
        occurredAt: z.string().datetime({ offset: true }).optional(),
      }),
    )
    .min(1)
    .max(100),
});
const primitiveMetadata = z
  .record(z.union([z.string().max(200), z.number().finite(), z.boolean(), z.null()]))
  .refine((value) => Object.keys(value).length <= 10, 'At most 10 metadata keys are allowed');
const activitySchema = z.object({
  events: z
    .array(
      z.object({
        clientEventId: z.string().trim().min(8).max(128),
        eventName: z.enum(KPI_ACTIVITY_EVENT_NAMES),
        sessionId: z.string().trim().max(128).optional(),
        entityType: z.enum(['lead', 'deal', 'tab']).optional(),
        entityId: z.string().trim().max(120).optional(),
        outcome: z.enum(['success', 'failed', 'attempted']).optional(),
        metadata: primitiveMetadata.optional(),
        occurredAt: z.string().datetime({ offset: true }).optional(),
      }),
    )
    .min(1)
    .max(100),
});
function managerContext(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'management', 'Sales KPI management');
}

function salesContext(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'sales', 'Sales tasks and KPI telemetry');
}

function zohoUserId(ctx: TenantContext): string {
  if (!ctx.userId.startsWith('zoho:')) {
    throw new RBACError('A verified Zoho worker session is required');
  }
  return ctx.userId.slice('zoho:'.length);
}

async function telemetryWorker(ctx: TenantContext) {
  if (!ctx.sessionVerified || ctx.impersonatorUserId) {
    throw new RBACError('Telemetry requires the signed-in worker identity');
  }
  const profileName = ctx.profiles?.[0] ?? null;
  const worker = await kpiWorkerRepo.sync(ctx, {
    zohoUserId: zohoUserId(ctx),
    displayName: ctx.userName ?? null,
    email: ctx.email ?? null,
    profileName,
    roleName: ctx.callerRole ?? null,
    active: true,
  });
  return (await kpiWorkerRepo.isCurrentlyEligible(ctx, worker.id)) ? worker : null;
}

async function assertEligibleAssignee(ctx: TenantContext, assigneeZohoUserId: string): Promise<void> {
  const worker = await kpiWorkerRepo.findByZohoUserId(ctx, assigneeZohoUserId);
  if (!worker || !(await kpiWorkerRepo.isCurrentlyEligible(ctx, worker.id))) {
    throw new NotFoundError('Eligible Sales KPI worker not found');
  }
}

async function assertTaskType(ctx: TenantContext, code: string): Promise<void> {
  const types = await workerTaskRepo.listTypes(ctx);
  if (!types.some((type) => type.code === code)) {
    throw new NotFoundError(`Active task type '${code}' not found`);
  }
}

function taskDto(task: Awaited<ReturnType<typeof workerTaskRepo.findById>>) {
  if (!task) return null;
  return {
    ...task,
    deadlineAt: task.deadlineAt?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
    cancelledAt: task.cancelledAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

export async function salesKpiRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  app.post('/webhooks/mytrion-tasks', async (request, reply) => {
    const secret = env.MYTRION_TASK_WEBHOOK_SECRET;
    if (!secret) {
      throw new AppError('Worker-task webhook is not configured', {
        statusCode: 503,
        code: 'SERVER_MISCONFIGURED',
      });
    }
    const keyId = request.headers['x-webhook-key-id'];
    const timestamp = request.headers['x-webhook-timestamp'];
    const signature = request.headers['x-webhook-signature'];
    const idempotencyKey = request.headers['idempotency-key'];
    if (
      typeof keyId !== 'string' ||
      keyId !== env.MYTRION_TASK_WEBHOOK_KEY_ID ||
      typeof timestamp !== 'string' ||
      typeof signature !== 'string' ||
      typeof idempotencyKey !== 'string' ||
      idempotencyKey.length < 8 ||
      idempotencyKey.length > 200 ||
      !verifyTaskWebhookSignature({ secret, timestampSeconds: timestamp, signature, body: request.body })
    ) {
      throw new AuthError('Invalid task webhook authentication');
    }
    const body = taskBodySchema.parse(request.body ?? {});
    const ctx = systemContext(request.id);
    const hash = webhookPayloadHash(request.body);
    const replay = await workerTaskRepo.findWebhookReplay(ctx, keyId, idempotencyKey);
    if (replay) {
      if (replay.payloadHash !== hash) {
        throw new ConflictError('Idempotency key was already used with a different payload');
      }
      return { task: taskDto(replay), replayed: true };
    }
    await assertEligibleAssignee(ctx, body.assigneeZohoUserId);
    await assertTaskType(ctx, body.type);
    try {
      const task = await workerTaskRepo.create(ctx, `webhook:${keyId}`, {
        assigneeZohoUserId: body.assigneeZohoUserId,
        taskType: body.type,
        subject: body.subject,
        description: body.description ?? null,
        content: body.content ?? null,
        deadlineAt: body.deadlineAt ? new Date(body.deadlineAt) : null,
        priority: body.priority ?? 'normal',
        source: 'webhook',
        externalId: body.externalId ?? null,
        webhookKeyId: keyId,
        idempotencyKey,
        payloadHash: hash,
      });
      await auditFromContext(ctx, {
        action: 'worker_task.webhook_create',
        status: 'ok',
        resourceType: 'mytrion_worker_task',
        resourceId: task.id,
        detail: { webhookKeyId: keyId, taskType: task.taskType },
      });
      reply.code(201);
      return { task: taskDto(task), replayed: false };
    } catch (error) {
      if (isUniqueViolation(error)) {
        const winner = await workerTaskRepo.findWebhookReplay(ctx, keyId, idempotencyKey);
        if (winner?.payloadHash === hash) return { task: taskDto(winner), replayed: true };
      }
      throw error;
    }
  });

  app.get('/manager/sales/kpi/workers', guard, async (request) => {
    const ctx = managerContext(request);
    return { workers: await kpiWorkerRepo.list(ctx, true) };
  });

  app.get('/manager/sales/tasks/types', guard, async (request) => {
    const ctx = managerContext(request);
    return { types: await workerTaskRepo.listTypes(ctx) };
  });
  app.get('/manager/sales/tasks', guard, async (request) => {
    const ctx = managerContext(request);
    const query = listTaskQuerySchema.parse(request.query ?? {});
    const tasks = await workerTaskRepo.list(ctx, {
      department: 'sales',
      ...(query.assigneeZohoUserId !== undefined
        ? { assigneeZohoUserId: query.assigneeZohoUserId }
        : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      ...(query.offset !== undefined ? { offset: query.offset } : {}),
    });
    return { tasks: tasks.map((task) => taskDto(task)) };
  });
  app.post('/manager/sales/tasks', guard, async (request, reply) => {
    const ctx = managerContext(request);
    const body = taskBodySchema.parse(request.body ?? {});
    await assertEligibleAssignee(ctx, body.assigneeZohoUserId);
    await assertTaskType(ctx, body.type);
    const task = await workerTaskRepo.create(ctx, ctx.userId, {
      assigneeZohoUserId: body.assigneeZohoUserId,
      taskType: body.type,
      subject: body.subject,
      description: body.description ?? null,
      content: body.content ?? null,
      deadlineAt: body.deadlineAt ? new Date(body.deadlineAt) : null,
      priority: body.priority ?? 'normal',
      source: 'manager',
      department: 'sales',
      externalId: body.externalId ?? null,
    });
    await auditFromContext(ctx, {
      action: 'worker_task.create',
      status: 'ok',
      resourceType: 'mytrion_worker_task',
      resourceId: task.id,
      detail: { assigneeZohoUserId: task.assigneeZohoUserId, taskType: task.taskType },
    });
    reply.code(201);
    return { task: taskDto(task) };
  });
  app.patch('/manager/sales/tasks/:taskId', guard, async (request) => {
    const ctx = managerContext(request);
    const taskId = z.string().min(1).parse((request.params as { taskId?: string }).taskId);
    const body = managerPatchSchema.parse(request.body ?? {});
    if (body.assigneeZohoUserId !== undefined) {
      await assertEligibleAssignee(ctx, body.assigneeZohoUserId);
    }
    if (body.type !== undefined) await assertTaskType(ctx, body.type);
    const task = await workerTaskRepo.update(ctx, ctx.userId, taskId, {
      expectedVersion: body.version,
      ...(body.assigneeZohoUserId !== undefined
        ? { assigneeZohoUserId: body.assigneeZohoUserId }
        : {}),
      ...(body.type !== undefined ? { taskType: body.type } : {}),
      ...(body.subject !== undefined ? { subject: body.subject } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.content !== undefined ? { content: body.content } : {}),
      ...(body.deadlineAt !== undefined
        ? { deadlineAt: body.deadlineAt ? new Date(body.deadlineAt) : null }
        : {}),
      ...(body.priority !== undefined ? { priority: body.priority } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.comment !== undefined ? { comment: body.comment } : {}),
    });
    await auditFromContext(ctx, {
      action: 'worker_task.update',
      status: 'ok',
      resourceType: 'mytrion_worker_task',
      resourceId: task.id,
      detail: { version: task.version, status: task.status },
    });
    return { task: taskDto(task) };
  });

  app.get('/sales/tasks', guard, async (request) => {
    const ctx = salesContext(request);
    const query = myTaskQuerySchema.parse(request.query ?? {});
    const assigneeZohoUserId = zohoUserId(ctx);
    const [tasks, counts] = await Promise.all([
      workerTaskRepo.list(ctx, {
        assigneeZohoUserId,
        limit: query.limit,
        offset: query.offset,
      }),
      workerTaskRepo.countByStatus(ctx, assigneeZohoUserId),
    ]);
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    return {
      tasks: tasks.map((task) => taskDto(task)),
      counts,
      pagination: {
        limit: query.limit,
        offset: query.offset,
        total,
        hasMore: query.offset + tasks.length < total,
      },
    };
  });
  app.get('/sales/tasks/summary', guard, async (request) => {
    const ctx = salesContext(request);
    const counts = await workerTaskRepo.countByStatus(ctx, zohoUserId(ctx));
    return { counts, total: Object.values(counts).reduce((sum, value) => sum + value, 0) };
  });
  app.get('/sales/tasks/:taskId/events', guard, async (request) => {
    const ctx = salesContext(request);
    const taskId = z.string().min(1).parse((request.params as { taskId?: string }).taskId);
    const task = await workerTaskRepo.findById(ctx, taskId);
    if (!task || task.assigneeZohoUserId !== zohoUserId(ctx)) throw new NotFoundError('Task not found');
    return { events: await workerTaskRepo.listEvents(ctx, taskId) };
  });
  app.patch('/sales/tasks/:taskId/status', guard, async (request) => {
    const ctx = salesContext(request);
    const taskId = z.string().min(1).parse((request.params as { taskId?: string }).taskId);
    const body = workerStatusSchema.parse(request.body ?? {});
    const existing = await workerTaskRepo.findById(ctx, taskId);
    if (!existing || existing.assigneeZohoUserId !== zohoUserId(ctx)) {
      throw new NotFoundError('Task not found');
    }
    if (existing.status === body.status) {
      return { task: taskDto(existing) };
    }
    const allowed: Record<WorkerTaskStatus, WorkerTaskStatus[]> = {
      open: ['in_progress', 'completed', 'cancelled'],
      in_progress: ['open', 'completed', 'cancelled'],
      completed: ['open', 'in_progress'],
      cancelled: ['open', 'in_progress'],
    };
    if (!allowed[existing.status].includes(body.status)) {
      throw new ConflictError(`Task cannot move from ${existing.status} to ${body.status}`);
    }
    const task = await workerTaskRepo.update(ctx, ctx.userId, taskId, {
      expectedVersion: body.version,
      status: body.status,
    });
    await auditFromContext(ctx, {
      action: 'worker_task.status',
      status: 'ok',
      resourceType: 'mytrion_worker_task',
      resourceId: task.id,
      detail: { from: existing.status, to: task.status },
    });
    return { task: taskDto(task) };
  });

  app.post(
    '/kpi/presence',
    { ...guard, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const ctx = salesContext(request);
      if (!env.FF_KPI_COLLECTION_ENABLED) {
        reply.code(202);
        return { accepted: 0, enabled: false };
      }
      const worker = await telemetryWorker(ctx);
      if (!worker) {
        reply.code(202);
        return { accepted: 0, eligible: false };
      }
      const body = presenceSchema.parse(request.body ?? {});
      const sessionHash = createHash('sha256').update(body.sessionId).digest('hex').slice(0, 24);
      const sessionId = `kps_${worker.id}_${sessionHash}`;
      const accepted = await kpiTelemetryRepo.recordPresence(
        ctx,
        worker.id,
        sessionId,
        request.headers['user-agent']?.slice(0, 500) ?? null,
        body.events.map((event) => ({
          clientEventId: event.clientEventId,
          state: event.state,
          clientOccurredAt: event.occurredAt ? new Date(event.occurredAt) : null,
        })),
      );
      reply.code(202);
      return { accepted, enabled: true };
    },
  );
  app.post(
    '/kpi/activity-events',
    { ...guard, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const ctx = salesContext(request);
      if (!env.FF_KPI_COLLECTION_ENABLED) {
        reply.code(202);
        return { accepted: 0, enabled: false };
      }
      const worker = await telemetryWorker(ctx);
      if (!worker) {
        reply.code(202);
        return { accepted: 0, eligible: false };
      }
      const body = activitySchema.parse(request.body ?? {});
      const accepted = await kpiTelemetryRepo.recordActivity(
        ctx,
        worker.id,
        body.events.map((event) => ({
          clientEventId: event.clientEventId,
          eventName: event.eventName,
          sessionId: event.sessionId ?? null,
          entityType: event.entityType ?? null,
          entityId: event.entityId ?? null,
          outcome: event.outcome ?? null,
          metadata: event.metadata ?? null,
          clientOccurredAt: event.occurredAt ? new Date(event.occurredAt) : null,
        })),
      );
      reply.code(202);
      return { accepted, enabled: true };
    },
  );
}
