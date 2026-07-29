import type { FastifyInstance, FastifyRequest, RouteShorthandOptions } from 'fastify';
import { z } from 'zod';
import { ConflictError, NotFoundError, RBACError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import {
  cancelLeaveRequest,
  decideLeaveRequest,
  getLeaveRequestDetail,
  getTimeOffOverview,
  listApprovalInbox,
  listMyLeaveRequests,
  submitLeaveRequest,
} from '../../modules/hr/leave/service.js';
import { hrEmployeeRepo } from '../../repos/hrEmployeeRepo.js';
import { hrLeavePolicyRepo } from '../../repos/hrLeavePolicyRepo.js';
import {
  hrLeaveRequestRepo,
  type LeaveRequestView,
} from '../../repos/hrLeaveRequestRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireContext, requireDepartment, requireMytrionWrite } from './helpers.js';

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Invalid calendar date');
const year = z.coerce.number().int().min(2020).max(2100);
const requestStatus = z.enum([
  'pending_lead',
  'pending_hr',
  'approved',
  'rejected',
  'cancelled',
]);
const requestListQuery = z.object({
  scope: z.enum(['mine', 'inbox', 'all']).default('mine'),
  year: year.optional(),
  status: requestStatus.optional(),
  q: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(300).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
const submitBody = z.object({
  leaveTypeId: z.string().min(1).max(100),
  fromDate: date,
  toDate: date,
  dayPart: z.enum(['full', 'morning', 'afternoon']).default('full'),
  reason: z.string().max(2000).nullable().optional(),
});
const decisionBody = z.object({
  decision: z.enum(['approve', 'reject']),
  comment: z.string().max(2000).nullable().optional(),
});
const holidayFields = z.object({
  date,
  name: z.string().min(1).max(160),
  location: z.string().max(120).nullable().optional(),
  isHalfDay: z.boolean().default(false),
  session: z.enum(['morning', 'afternoon']).nullable().optional(),
  isActive: z.boolean().default(true),
  notes: z.string().max(1000).nullable().optional(),
});
const holidayBody = holidayFields
  .superRefine((value, ctx) => {
    if (value.isHalfDay && !value.session) {
      ctx.addIssue({
        code: 'custom',
        path: ['session'],
        message: 'A half-day holiday requires a morning or afternoon session',
      });
    }
  });
const holidayPatch = holidayFields.partial();
const typePatch = z
  .object({
    name: z.string().min(1).max(120).optional(),
    defaultDays: z.number().min(0).max(366).multipleOf(0.5).optional(),
    isPaid: z.boolean().optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(100).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one setting is required');

function requireTimeOffInternal(request: FastifyRequest): TenantContext {
  const ctx = requireContext(request);
  if (ctx.audience !== 'internal') throw new RBACError('Time Off is internal-only');
  return ctx;
}

function requireTimeOffAdmin(request: FastifyRequest): TenantContext {
  const ctx = requireMytrionWrite(request, 'hr', 'Time Off settings');
  if (!ctx.allDepartmentAccess && !ctx.bypassRbac && ctx.role !== 'admin') {
    throw new RBACError('Mytrion Admin access required for Time Off settings');
  }
  return ctx;
}

function requestDto(view: LeaveRequestView) {
  const row = view.request;
  return {
    id: row.id,
    employee: view.employee,
    leaveTypeId: row.leaveTypeId,
    leaveTypeCode: row.leaveTypeCode,
    leaveTypeName: row.leaveTypeName,
    fromDate: row.fromDate,
    toDate: row.toDate,
    dayPart: row.dayPart,
    requestedDays: Number(row.requestedDays),
    reason: row.reason,
    status: row.status,
    currentApproverEmployeeId: row.currentApproverEmployeeId,
    currentApproverName: view.currentApproverName,
    leadApproverEmployeeId: row.leadApproverEmployeeId,
    leadApproverName: view.leadApproverName,
    hrApproverEmployeeId: row.hrApproverEmployeeId,
    hrApproverName: view.hrApproverName,
    leadDecisionAt: row.leadDecisionAt?.toISOString() ?? null,
    leadComment: row.leadComment,
    hrDecisionAt: row.hrDecisionAt?.toISOString() ?? null,
    hrComment: row.hrComment,
    submittedAt: row.submittedAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}

function holidayDto(row: Awaited<ReturnType<typeof hrLeavePolicyRepo.listHolidays>>[number]) {
  return {
    id: row.id,
    date: row.date,
    name: row.name,
    location: row.location,
    isHalfDay: row.isHalfDay,
    session: row.session,
    isActive: row.isActive,
    notes: row.notes,
  };
}

function typeDto(row: Awaited<ReturnType<typeof hrLeavePolicyRepo.listTypes>>[number]) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    isPaid: row.isPaid,
    defaultDays: Number(row.defaultDays),
    isActive: row.isActive,
    sortOrder: row.sortOrder,
  };
}

function routeListOptions(query: z.infer<typeof requestListQuery>) {
  return {
    ...(query.year !== undefined ? { year: query.year } : {}),
    ...(query.status !== undefined ? { status: query.status } : {}),
    ...(query.q !== undefined ? { q: query.q } : {}),
    limit: query.limit,
    offset: query.offset,
  };
}

export async function hrLeaveRoutes(app: FastifyInstance): Promise<void> {
  const auth: RouteShorthandOptions = { onRequest: [app.authenticate] };

  app.get('/hr/time-off/me', auth, async (request) => {
    const ctx = requireTimeOffInternal(request);
    const query = z.object({ year: year.default(new Date().getUTCFullYear()) }).parse(request.query);
    const result = await getTimeOffOverview(ctx, query.year);
    return {
      ...result,
      holidays: result.holidays.map(holidayDto),
    };
  });

  app.get('/hr/time-off/types', auth, async (request) => {
    const ctx = requireTimeOffInternal(request);
    const items = await hrLeavePolicyRepo.listTypes(ctx, true);
    return { items: items.map(typeDto) };
  });

  app.get('/hr/time-off/holidays', auth, async (request) => {
    const ctx = requireTimeOffInternal(request);
    const query = z
      .object({
        year: year.default(new Date().getUTCFullYear()),
        includeInactive: z.coerce.boolean().default(false),
      })
      .parse(request.query);
    const items = await hrLeavePolicyRepo.listHolidays(ctx, query.year, !query.includeInactive);
    return { items: items.map(holidayDto) };
  });

  app.get('/hr/time-off/requests', auth, async (request) => {
    const query = requestListQuery.parse(request.query);
    if (query.scope === 'all') {
      const ctx = requireDepartment(request, 'hr', 'HR Time Off requests');
      const items = await hrLeaveRequestRepo.listAll(ctx, routeListOptions(query));
      return { items: items.map(requestDto) };
    }
    const ctx = requireTimeOffInternal(request);
    const items =
      query.scope === 'inbox'
        ? await listApprovalInbox(ctx, routeListOptions(query))
        : await listMyLeaveRequests(ctx, routeListOptions(query));
    return { items: items.map(requestDto) };
  });

  app.get<{ Params: { id: string } }>('/hr/time-off/requests/:id', auth, async (request) => {
    const ctx = requireTimeOffInternal(request);
    const result = await getLeaveRequestDetail(ctx, request.params.id);
    return {
      item: requestDto(result.item),
      actions: result.actions.map((action) => ({
        id: action.id,
        action: action.action,
        actorEmployeeId: action.actorEmployeeId,
        actorUserId: action.actorUserId,
        fromStatus: action.fromStatus,
        toStatus: action.toStatus,
        comment: action.comment,
        createdAt: action.createdAt.toISOString(),
      })),
    };
  });

  app.post('/hr/time-off/requests', auth, async (request, reply) => {
    const ctx = requireTimeOffInternal(request);
    const body = submitBody.parse(request.body);
    const row = await submitLeaveRequest(ctx, {
      leaveTypeId: body.leaveTypeId,
      fromDate: body.fromDate,
      toDate: body.toDate,
      dayPart: body.dayPart,
      ...(body.reason !== undefined ? { reason: body.reason } : {}),
    });
    await auditFromContext(ctx, {
      action: 'hr.time_off.request.submit',
      status: 'ok',
      resourceType: 'hr_leave_request',
      resourceId: row.id,
      detail: {
        leaveType: row.leaveTypeCode,
        fromDate: row.fromDate,
        toDate: row.toDate,
        requestedDays: Number(row.requestedDays),
        workflowStatus: row.status,
      },
    });
    return reply.code(201).send({ id: row.id, status: row.status });
  });

  app.post<{ Params: { id: string } }>(
    '/hr/time-off/requests/:id/decision',
    auth,
    async (request) => {
      const ctx = requireTimeOffInternal(request);
      const body = decisionBody.parse(request.body);
      const row = await decideLeaveRequest(ctx, {
        requestId: request.params.id,
        decision: body.decision,
        ...(body.comment !== undefined ? { comment: body.comment } : {}),
      });
      await auditFromContext(ctx, {
        action: `hr.time_off.request.${body.decision}`,
        status: 'ok',
        resourceType: 'hr_leave_request',
        resourceId: row.id,
        detail: { workflowStatus: row.status },
      });
      return { id: row.id, status: row.status };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/hr/time-off/requests/:id/cancel',
    auth,
    async (request) => {
      const ctx = requireTimeOffInternal(request);
      const body = z.object({ comment: z.string().max(1000).nullable().optional() }).parse(request.body);
      const row = await cancelLeaveRequest(ctx, request.params.id, body.comment);
      await auditFromContext(ctx, {
        action: 'hr.time_off.request.cancel',
        status: 'ok',
        resourceType: 'hr_leave_request',
        resourceId: row.id,
      });
      return { id: row.id, status: row.status };
    },
  );

  app.get('/hr/time-off/settings', auth, async (request) => {
    const ctx = requireTimeOffAdmin(request);
    const query = z.object({ year: year.default(new Date().getUTCFullYear()) }).parse(request.query);
    const [settings, types, holidays] = await Promise.all([
      hrLeavePolicyRepo.getSettings(ctx),
      hrLeavePolicyRepo.listTypes(ctx),
      hrLeavePolicyRepo.listHolidays(ctx, query.year),
    ]);
    const approver = settings.finalApproverEmployeeId
      ? await hrEmployeeRepo.getById(ctx, settings.finalApproverEmployeeId)
      : null;
    return {
      settings: {
        finalApproverEmployeeId: settings.finalApproverEmployeeId,
        finalApproverName: approver
          ? `${approver.firstName} ${approver.lastName}`.trim()
          : null,
        timezone: settings.timezone,
      },
      types: types.map(typeDto),
      holidays: holidays.map(holidayDto),
      year: query.year,
    };
  });

  app.patch('/hr/time-off/settings', auth, async (request) => {
    const ctx = requireTimeOffAdmin(request);
    const body = z
      .object({
        finalApproverEmployeeId: z.string().max(100).nullable().optional(),
        timezone: z.string().min(1).max(80).optional(),
      })
      .refine((value) => Object.keys(value).length > 0, 'At least one setting is required')
      .parse(request.body);
    if (body.finalApproverEmployeeId) {
      const approver = await hrEmployeeRepo.getById(ctx, body.finalApproverEmployeeId);
      if (
        !approver ||
        approver.status.toLowerCase() !== 'active' ||
        !approver.zohoUserId?.trim()
      ) {
        throw new ConflictError('Final approver must be an active employee with a linked login');
      }
    }
    const row = await hrLeavePolicyRepo.updateSettings(ctx, {
      ...(body.finalApproverEmployeeId !== undefined
        ? { finalApproverEmployeeId: body.finalApproverEmployeeId }
        : {}),
      ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
    });
    await auditFromContext(ctx, {
      action: 'hr.time_off.settings.update',
      status: 'ok',
      resourceType: 'hr_leave_settings',
      resourceId: row.id,
      detail: { keys: Object.keys(body) },
    });
    return { updated: true };
  });

  app.patch<{ Params: { id: string } }>('/hr/time-off/types/:id', auth, async (request) => {
    const ctx = requireTimeOffAdmin(request);
    const body = typePatch.parse(request.body);
    const row = await hrLeavePolicyRepo.updateType(ctx, request.params.id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.defaultDays !== undefined ? { defaultDays: body.defaultDays } : {}),
      ...(body.isPaid !== undefined ? { isPaid: body.isPaid } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
    });
    if (!row) throw new NotFoundError('Leave type not found');
    await auditFromContext(ctx, {
      action: 'hr.time_off.type.update',
      status: 'ok',
      resourceType: 'hr_leave_type',
      resourceId: row.id,
      detail: { keys: Object.keys(body) },
    });
    return typeDto(row);
  });

  app.post('/hr/time-off/balances/reset', auth, async (request) => {
    const ctx = requireTimeOffAdmin(request);
    const body = z.object({ year }).parse(request.body);
    const count = await hrLeavePolicyRepo.resetEntitlementsToDefaults(ctx, body.year);
    await auditFromContext(ctx, {
      action: 'hr.time_off.balances.reset',
      status: 'ok',
      resourceType: 'hr_leave_entitlement',
      detail: { year: body.year, count },
    });
    return { updated: count };
  });

  app.post('/hr/time-off/holidays', auth, async (request, reply) => {
    const ctx = requireTimeOffAdmin(request);
    const body = holidayBody.parse(request.body);
    const row = await hrLeavePolicyRepo.createHoliday(ctx, {
      date: body.date,
      name: body.name,
      isHalfDay: body.isHalfDay,
      isActive: body.isActive,
      ...(body.location !== undefined ? { location: body.location } : {}),
      ...(body.session !== undefined ? { session: body.session } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
    });
    await auditFromContext(ctx, {
      action: 'hr.time_off.holiday.create',
      status: 'ok',
      resourceType: 'hr_holiday',
      resourceId: row.id,
      detail: { date: row.date, name: row.name },
    });
    return reply.code(201).send(holidayDto(row));
  });

  app.patch<{ Params: { id: string } }>('/hr/time-off/holidays/:id', auth, async (request) => {
    const ctx = requireTimeOffAdmin(request);
    const body = holidayPatch.parse(request.body);
    const row = await hrLeavePolicyRepo.updateHoliday(ctx, request.params.id, {
      ...(body.date !== undefined ? { date: body.date } : {}),
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.location !== undefined ? { location: body.location } : {}),
      ...(body.isHalfDay !== undefined ? { isHalfDay: body.isHalfDay } : {}),
      ...(body.session !== undefined ? { session: body.session } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
    });
    if (!row) throw new NotFoundError('Holiday not found');
    await auditFromContext(ctx, {
      action: 'hr.time_off.holiday.update',
      status: 'ok',
      resourceType: 'hr_holiday',
      resourceId: row.id,
      detail: { keys: Object.keys(body) },
    });
    return holidayDto(row);
  });

  app.delete<{ Params: { id: string } }>('/hr/time-off/holidays/:id', auth, async (request) => {
    const ctx = requireTimeOffAdmin(request);
    const deleted = await hrLeavePolicyRepo.deleteHoliday(ctx, request.params.id);
    if (!deleted) throw new NotFoundError('Holiday not found');
    await auditFromContext(ctx, {
      action: 'hr.time_off.holiday.delete',
      status: 'ok',
      resourceType: 'hr_holiday',
      resourceId: request.params.id,
    });
    return { deleted: true };
  });
}
