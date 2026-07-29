/**
 * Mytrion HR attendance — webhook ingest, My Data summary, shifts, CSV export.
 * No Zoho People attendance dependency.
 */
import type { FastifyInstance, FastifyRequest, RouteShorthandOptions } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { AppError, AuthError, NotFoundError, RBACError, ValidationError } from '../../lib/errors.js';
import { safeEqual } from '../../lib/crypto.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { ingestAttendanceWebhook } from '../../modules/hr/attendance/ingestWebhook.js';
import { buildAttendanceSummary, summaryToCsv } from '../../modules/hr/attendance/summary.js';
import { assertCanViewEmployeeAttendance } from '../../modules/hr/attendance/teamScope.js';
import { buildAttendanceTeamList } from '../../modules/hr/attendance/teamSummary.js';
import { isValidHhMm, weekRangeContaining } from '../../modules/hr/attendance/uzbTime.js';
import { hrAttendanceShiftRepo } from '../../repos/hrAttendanceShiftRepo.js';
import { hrEmployeeRepo } from '../../repos/hrEmployeeRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment } from './helpers.js';

const SECRET_HEADER = 'x-attendance-webhook-secret';

function requireHrInternal(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'hr', 'HR directory');
}

function requireHrAdmin(request: FastifyRequest): TenantContext {
  const ctx = requireHrInternal(request);
  if (!ctx.allDepartmentAccess && !ctx.bypassRbac && ctx.role !== 'admin') {
    throw new RBACError('Mytrion Admin access required for attendance admin actions');
  }
  return ctx;
}

function zohoUserIdFromCtx(ctx: TenantContext): string {
  return ctx.userId.startsWith('zoho:') ? ctx.userId.replace(/^zoho:/, '') : '';
}

async function resolveSelfEmployeeId(ctx: TenantContext): Promise<string> {
  const zohoUserId = zohoUserIdFromCtx(ctx);
  if (!zohoUserId) throw new NotFoundError('No employee record linked to this sign-in');
  const row = await hrEmployeeRepo.findByZohoUserId(ctx, zohoUserId);
  if (!row) throw new NotFoundError('No employee record linked to this sign-in');
  return row.id;
}

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hhMm = z.string().refine(isValidHhMm, 'Expected HH:mm');

const shiftBody = z.object({
  name: z.string().min(1).max(120),
  timezone: z.string().max(80).nullable().optional(),
  startLocal: hhMm,
  endLocal: hhMm,
  isActive: z.boolean().optional(),
});

const shiftPatch = shiftBody.partial().extend({
  name: z.string().min(1).max(120).optional(),
});

const assignBody = z.object({
  employeeIds: z.array(z.string().min(1).max(80)).min(1).max(200),
  effectiveFrom: dateStr,
  effectiveTo: dateStr.nullable().optional(),
});

function shiftDto(row: Awaited<ReturnType<typeof hrAttendanceShiftRepo.getById>>) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    timezone: row.timezone,
    startLocal: row.startLocal,
    endLocal: row.endLocal,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function hrAttendanceRoutes(app: FastifyInstance): Promise<void> {
  const auth: RouteShorthandOptions = { onRequest: [app.authenticate] };

  /** Hikvision / servercrm → punches. Shared secret, not session. */
  app.post('/hr/attendance/webhook', async (request) => {
    const secret = env.HR_ATTENDANCE_WEBHOOK_SECRET;
    if (!secret) {
      throw new AppError('Attendance webhook secret is not configured', {
        statusCode: 503,
        code: 'SERVER_MISCONFIGURED',
      });
    }
    const provided = request.headers[SECRET_HEADER];
    if (typeof provided !== 'string' || !safeEqual(provided, secret)) {
      throw new AuthError('Invalid or missing attendance webhook secret');
    }
    const stats = await ingestAttendanceWebhook(request.body, request.id);
    return { success: true, stats };
  });

  app.get('/hr/attendance/me', auth, async (request) => {
    const ctx = requireHrInternal(request);
    const q = z
      .object({
        from: dateStr.optional(),
        to: dateStr.optional(),
        weekOf: dateStr.optional(),
      })
      .parse(request.query);
    let from = q.from;
    let to = q.to;
    if (!from || !to) {
      const anchor = q.weekOf ?? new Date().toISOString().slice(0, 10);
      const range = weekRangeContaining(anchor);
      from = from ?? range.from;
      to = to ?? range.to;
    }
    if (from > to) throw new ValidationError('from must be on or before to');
    const employeeId = await resolveSelfEmployeeId(ctx);
    return buildAttendanceSummary(ctx, employeeId, from, to);
  });

  app.get('/hr/attendance/summary', auth, async (request) => {
    const ctx = requireHrInternal(request);
    const q = z
      .object({
        from: dateStr,
        to: dateStr,
        employeeId: z.string().max(80).optional(),
      })
      .parse(request.query);
    if (q.from > q.to) throw new ValidationError('from must be on or before to');
    const selfId = await resolveSelfEmployeeId(ctx);
    const employeeId = q.employeeId?.trim() || selfId;
    if (employeeId !== selfId) {
      const emp = await hrEmployeeRepo.getById(ctx, employeeId);
      if (!emp) throw new NotFoundError('Employee not found');
      await assertCanViewEmployeeAttendance(ctx, selfId, employeeId);
    }
    return buildAttendanceSummary(ctx, employeeId, q.from, q.to);
  });

  /**
   * Team attendance directory.
   * Managers: Direct = reportees; All = reportees ∪ department members they lead.
   * HR Manager / Admin: Direct = their reportees; All = every Active employee.
   */
  app.get('/hr/attendance/team', auth, async (request) => {
    const ctx = requireHrInternal(request);
    const q = z
      .object({
        from: dateStr.optional(),
        to: dateStr.optional(),
        weekOf: dateStr.optional(),
        scope: z.enum(['direct', 'all']).default('direct'),
        q: z.string().max(120).optional(),
      })
      .parse(request.query);
    let from = q.from;
    let to = q.to;
    if (!from || !to) {
      const anchor = q.weekOf ?? new Date().toISOString().slice(0, 10);
      const range = weekRangeContaining(anchor);
      from = from ?? range.from;
      to = to ?? range.to;
    }
    if (from > to) throw new ValidationError('from must be on or before to');
    const selfId = await resolveSelfEmployeeId(ctx);
    return buildAttendanceTeamList(ctx, selfId, from, to, q.scope, q.q ?? '');
  });

  app.get('/hr/attendance/export', auth, async (request) => {
    const ctx = requireHrAdmin(request);
    const q = z
      .object({
        from: dateStr,
        to: dateStr,
        employeeId: z.string().min(1).max(80),
      })
      .parse(request.query);
    if (q.from > q.to) throw new ValidationError('from must be on or before to');
    const emp = await hrEmployeeRepo.getById(ctx, q.employeeId);
    if (!emp) throw new NotFoundError('Employee not found');
    const summary = await buildAttendanceSummary(ctx, emp.id, q.from, q.to);
    const label = `${emp.firstName} ${emp.lastName}`.trim();
    const csv = summaryToCsv(summary, label);
    const filename = `attendance-${emp.employeeId ?? emp.id}-${q.from}-${q.to}.csv`;
    await auditFromContext(ctx, {
      action: 'hr.attendance.export',
      status: 'ok',
      resourceType: 'hr_employee',
      resourceId: emp.id,
      detail: { from: q.from, to: q.to },
    });
    // JSON envelope — CRM transport always parses JSON; the UI triggers a Blob download.
    return { csv, filename };
  });

  app.get('/hr/attendance/shifts', auth, async (request) => {
    const ctx = requireHrInternal(request);
    const items = await hrAttendanceShiftRepo.list(ctx);
    return { items: items.map((r) => shiftDto(r)) };
  });

  app.post('/hr/attendance/shifts', auth, async (request) => {
    const ctx = requireHrAdmin(request);
    const body = shiftBody.parse(request.body);
    const row = await hrAttendanceShiftRepo.create(ctx, {
      name: body.name,
      startLocal: body.startLocal,
      endLocal: body.endLocal,
      ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
    });
    await auditFromContext(ctx, {
      action: 'hr.attendance.shift.create',
      status: 'ok',
      resourceType: 'hr_attendance_shift',
      resourceId: row.id,
      detail: { name: row.name },
    });
    return shiftDto(row);
  });

  app.patch<{ Params: { id: string } }>('/hr/attendance/shifts/:id', auth, async (request) => {
    const ctx = requireHrAdmin(request);
    const body = shiftPatch.parse(request.body);
    const row = await hrAttendanceShiftRepo.update(ctx, request.params.id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
      ...(body.startLocal !== undefined ? { startLocal: body.startLocal } : {}),
      ...(body.endLocal !== undefined ? { endLocal: body.endLocal } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
    });
    if (!row) throw new NotFoundError('Shift not found');
    await auditFromContext(ctx, {
      action: 'hr.attendance.shift.update',
      status: 'ok',
      resourceType: 'hr_attendance_shift',
      resourceId: row.id,
      detail: { keys: Object.keys(body) },
    });
    return shiftDto(row);
  });

  app.delete<{ Params: { id: string } }>('/hr/attendance/shifts/:id', auth, async (request) => {
    const ctx = requireHrAdmin(request);
    const ok = await hrAttendanceShiftRepo.delete(ctx, request.params.id);
    if (!ok) throw new NotFoundError('Shift not found');
    await auditFromContext(ctx, {
      action: 'hr.attendance.shift.delete',
      status: 'ok',
      resourceType: 'hr_attendance_shift',
      resourceId: request.params.id,
    });
    return { deleted: true };
  });

  app.post<{ Params: { id: string } }>(
    '/hr/attendance/shifts/:id/assign',
    auth,
    async (request) => {
      const ctx = requireHrAdmin(request);
      const shift = await hrAttendanceShiftRepo.getById(ctx, request.params.id);
      if (!shift) throw new NotFoundError('Shift not found');
      const body = assignBody.parse(request.body);
      const assigned: string[] = [];
      for (const employeeId of body.employeeIds) {
        const emp = await hrEmployeeRepo.getById(ctx, employeeId);
        if (!emp) continue;
        await hrAttendanceShiftRepo.assign(ctx, {
          shiftId: shift.id,
          employeeId: emp.id,
          effectiveFrom: body.effectiveFrom,
          ...(body.effectiveTo !== undefined ? { effectiveTo: body.effectiveTo } : {}),
        });
        assigned.push(emp.id);
      }
      await auditFromContext(ctx, {
        action: 'hr.attendance.shift.assign',
        status: 'ok',
        resourceType: 'hr_attendance_shift',
        resourceId: shift.id,
        detail: { count: assigned.length, effectiveFrom: body.effectiveFrom },
      });
      return { assigned };
    },
  );
}
