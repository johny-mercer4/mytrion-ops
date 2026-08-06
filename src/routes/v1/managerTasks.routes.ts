/**
 * Manager Tasks — department-scoped assign / list / update / events.
 * Sales KPI routes remain for telemetry; task CRUD for every desk lives here.
 */
import type { FastifyInstance, FastifyRequest, RouteShorthandOptions } from 'fastify';
import { z } from 'zod';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import {
  assertDepartmentAssignee,
  isManagerTaskDepartment,
  listDepartmentAssignees,
  type ManagerTaskDepartment,
} from '../../modules/manager/departmentAssignees.js';
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
  priority: prioritySchema.optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

function managerContext(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'management', 'Manager tasks');
}

function parseDepartment(raw: string): ManagerTaskDepartment {
  const dept = raw.trim().toLowerCase();
  if (!isManagerTaskDepartment(dept)) {
    throw new ValidationError(`Unknown manager department: ${raw}`);
  }
  return dept;
}

/**
 * A code must be usable on THIS desk — scoped to it, or shared (`department IS NULL`). Checking the
 * whole catalog would let a Billing form post `agency_filing` and file a Collection type under
 * Billing, which then breaks every per-desk report built on `task_type`.
 */
async function assertTaskType(
  ctx: TenantContext,
  department: ManagerTaskDepartment,
  code: string,
): Promise<void> {
  if (!(await workerTaskRepo.isTypeAllowed(ctx, department, code))) {
    throw new NotFoundError(`Active task type '${code}' is not available on the ${department} desk`);
  }
}

function taskDto(task: NonNullable<Awaited<ReturnType<typeof workerTaskRepo.findById>>>) {
  return {
    ...task,
    deadlineAt: task.deadlineAt?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
    cancelledAt: task.cancelledAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

export async function managerTasksRoutes(app: FastifyInstance): Promise<void> {
  const auth: RouteShorthandOptions = { onRequest: [app.authenticate] };

  app.get<{ Params: { department: string } }>(
    '/manager/:department/workers',
    auth,
    async (request) => {
      const ctx = managerContext(request);
      const department = parseDepartment(request.params.department);
      const workers = await listDepartmentAssignees(ctx, department);
      return { workers };
    },
  );

  app.get<{ Params: { department: string } }>(
    '/manager/:department/tasks/types',
    auth,
    async (request) => {
      const ctx = managerContext(request);
      const department = parseDepartment(request.params.department);
      return { types: await workerTaskRepo.listTypes(ctx, department) };
    },
  );

  app.get<{ Params: { department: string } }>(
    '/manager/:department/tasks',
    auth,
    async (request) => {
      const ctx = managerContext(request);
      const department = parseDepartment(request.params.department);
      const query = listTaskQuerySchema.parse(request.query ?? {});
      const limit = query.limit ?? 100;
      const offset = query.offset ?? 0;
      const filter = {
        department,
        ...(query.assigneeZohoUserId !== undefined
          ? { assigneeZohoUserId: query.assigneeZohoUserId }
          : {}),
        ...(query.status !== undefined ? { status: query.status } : {}),
        ...(query.priority !== undefined ? { priority: query.priority } : {}),
        ...(query.q ? { search: query.q } : {}),
      };
      /*
       * TWO round trips, not four. A prod DB round trip is ~550ms, so the old four-way fan-out
       * charged an EMPTY desk ~2.2s of database time to report that it is empty.
       *   tasks       the page
       *   deskCounts  desk-wide status totals AND the filter-matching total, from one FILTER scan
       *
       * The per-assignee load is a third query, so it is skipped entirely when nothing is open —
       * on an empty desk there is no workload to describe.
       */
      const [tasks, summary] = await Promise.all([
        workerTaskRepo.list(ctx, { ...filter, limit, offset }),
        workerTaskRepo.deskCounts(ctx, department, filter),
      ]);
      const active = summary.counts.open + summary.counts.in_progress;
      const load = active > 0 ? await workerTaskRepo.openLoadByAssignee(ctx, department) : [];
      const total = summary.matching;
      return {
        tasks: tasks.map((task) => taskDto(task)),
        counts: summary.counts,
        load,
        pagination: { limit, offset, total, hasMore: offset + tasks.length < total },
      };
    },
  );

  app.post<{ Params: { department: string } }>(
    '/manager/:department/tasks',
    auth,
    async (request, reply) => {
      const ctx = managerContext(request);
      const department = parseDepartment(request.params.department);
      const body = taskBodySchema.parse(request.body ?? {});
      try {
        await assertDepartmentAssignee(ctx, department, body.assigneeZohoUserId);
      } catch {
        throw new NotFoundError('Eligible assignee not found for this department');
      }
      await assertTaskType(ctx, department, body.type);
      const task = await workerTaskRepo.create(ctx, ctx.userId, {
        assigneeZohoUserId: body.assigneeZohoUserId,
        taskType: body.type,
        subject: body.subject,
        description: body.description ?? null,
        content: body.content ?? null,
        deadlineAt: body.deadlineAt ? new Date(body.deadlineAt) : null,
        priority: body.priority ?? 'normal',
        source: 'manager',
        department,
        externalId: body.externalId ?? null,
      });
      await auditFromContext(ctx, {
        action: 'worker_task.create',
        status: 'ok',
        resourceType: 'mytrion_worker_task',
        resourceId: task.id,
        detail: {
          department,
          assigneeZohoUserId: task.assigneeZohoUserId,
          taskType: task.taskType,
        },
      });
      reply.code(201);
      return { task: taskDto(task) };
    },
  );

  app.patch<{ Params: { department: string; taskId: string } }>(
    '/manager/:department/tasks/:taskId',
    auth,
    async (request) => {
      const ctx = managerContext(request);
      const department = parseDepartment(request.params.department);
      const taskId = z.string().min(1).parse(request.params.taskId);
      const body = managerPatchSchema.parse(request.body ?? {});
      const existing = await workerTaskRepo.findById(ctx, taskId);
      if (!existing || existing.department !== department) {
        throw new NotFoundError('Task not found');
      }
      if (body.assigneeZohoUserId !== undefined) {
        try {
          await assertDepartmentAssignee(ctx, department, body.assigneeZohoUserId);
        } catch {
          throw new NotFoundError('Eligible assignee not found for this department');
        }
      }
      if (body.type !== undefined) await assertTaskType(ctx, department, body.type);
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
        detail: { department, version: task.version, status: task.status },
      });
      return { task: taskDto(task) };
    },
  );

  app.get<{ Params: { department: string; taskId: string } }>(
    '/manager/:department/tasks/:taskId/events',
    auth,
    async (request) => {
      const ctx = managerContext(request);
      const department = parseDepartment(request.params.department);
      const taskId = z.string().min(1).parse(request.params.taskId);
      const task = await workerTaskRepo.findById(ctx, taskId);
      if (!task || task.department !== department) throw new NotFoundError('Task not found');
      const events = await workerTaskRepo.listEvents(ctx, taskId);
      return {
        events: events.map((event) => ({
          ...event,
          occurredAt: event.occurredAt.toISOString(),
        })),
      };
    },
  );
}
