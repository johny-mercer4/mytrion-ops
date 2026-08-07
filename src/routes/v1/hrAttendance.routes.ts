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
import { systemContext } from '../../modules/auth/authService.js';
import { ingestAttendanceWebhook } from '../../modules/hr/attendance/ingestWebhook.js';
import { buildAttendanceSummary, summaryToCsv } from '../../modules/hr/attendance/summary.js';
import {
  assertCanAssignEmployeeShift,
  assertCanViewEmployeeAttendance,
  canViewAllAttendance,
} from '../../modules/hr/attendance/teamScope.js';
import { buildAttendanceTeamList } from '../../modules/hr/attendance/teamSummary.js';
import {
  isValidHhMm,
  uzbDateString,
  weekRangeContaining,
} from '../../modules/hr/attendance/uzbTime.js';
import {
  MAX_SYNC_DAYS,
  syncAttendanceFromDwh,
} from '../../modules/hr/attendance/syncFromDwh.js';
import { hrAttendancePunchRepo } from '../../repos/hrAttendancePunchRepo.js';
import { hrAttendanceShiftRepo } from '../../repos/hrAttendanceShiftRepo.js';
import { hrEmployeeRepo, type HrEmployeeRow } from '../../repos/hrEmployeeRepo.js';
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

async function resolveSelfEmployeeId(
  ctx: TenantContext,
  allowElevatedUnlinked = false,
): Promise<string> {
  const zohoUserId = zohoUserIdFromCtx(ctx);
  if (!zohoUserId) {
    if (allowElevatedUnlinked && canViewAllAttendance(ctx)) return '';
    throw new NotFoundError('No employee record linked to this sign-in');
  }
  const row = await hrEmployeeRepo.findByZohoUserId(ctx, zohoUserId);
  if (!row) {
    // Org-wide attendance access belongs to the verified Administrator / HR Manager identity,
    // not to whether HR has already linked that identity to an employee row. An empty self id
    // gives elevated users zero "direct" reports while still allowing the scoped All directory.
    if (allowElevatedUnlinked && canViewAllAttendance(ctx)) return '';
    throw new NotFoundError('No employee record linked to this sign-in');
  }
  return row.id;
}

/** Inclusive day count between two `YYYY-MM-DD` strings — both ends counted. */
function daysInclusive(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000) + 1;
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
    await auditFromContext(systemContext(request.id), {
      action: 'hr.attendance.webhook.ingest',
      status: stats.failed > 0 ? 'error' : 'ok',
      resourceType: 'hr_attendance_punch',
      resourceId: request.id,
      detail: {
        accepted: stats.success,
        skipped: stats.skipped,
        failed: stats.failed,
      },
    });
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
      const anchor = q.weekOf ?? uzbDateString(new Date());
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
    const selfId = await resolveSelfEmployeeId(ctx, true);
    const employeeId = q.employeeId?.trim() || selfId;
    if (!employeeId) {
      throw new NotFoundError('Choose an employee to view attendance');
    }
    if (employeeId !== selfId) {
      const emp = await hrEmployeeRepo.getById(ctx, employeeId);
      if (!emp) throw new NotFoundError('Employee not found');
      await assertCanViewEmployeeAttendance(ctx, selfId, employeeId);
    }
    return buildAttendanceSummary(ctx, employeeId, q.from, q.to);
  });

  /**
   * Refresh punches for a window from the DWH. The Attendance page calls this before it reads.
   *
   * A POST because it writes, but it is not a command the user composes — it takes only the window
   * already being viewed, and re-running it changes nothing (the dedup index decides what is new). Any
   * HR reader may trigger it for that reason: it grants no data the same person cannot already read
   * through `/hr/attendance/*`, it just makes that data current.
   *
   * Failures here are deliberately NOT fatal to the page — see the frontend. Stale attendance is worth
   * showing; a blank screen because an analytics database was busy is not.
   */
  app.post('/hr/attendance/sync', auth, async (request) => {
    const ctx = requireHrInternal(request);
    const body = z
      .object({
        from: dateStr.optional(),
        to: dateStr.optional(),
        weekOf: dateStr.optional(),
        // The server holds a completed sync for a minute so page views are cheap. An explicit Refresh
        // is the user saying they do not believe what is on screen, so it must bypass that.
        force: z.boolean().optional(),
      })
      .parse(request.body ?? {});
    const range = weekRangeContaining(body.weekOf ?? uzbDateString(new Date()));
    const from = body.from ?? range.from;
    const to = body.to ?? range.to;
    if (from > to) throw new ValidationError('from must be on or before to');
    if (daysInclusive(from, to) > MAX_SYNC_DAYS) {
      throw new ValidationError(`Sync window may not exceed ${MAX_SYNC_DAYS} days`);
    }
    return syncAttendanceFromDwh(ctx, from, to, { force: body.force ?? false });
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
        /**
         * Opt OUT of the per-person week tally. Default stays on so an existing caller keeps the
         * shape it was written against; the roster passes `0` because it renders a directory and
         * fetches the week for the one person the user opens.
         */
        totals: z.enum(['0', '1']).optional(),
      })
      .parse(request.query);
    let from = q.from;
    let to = q.to;
    if (!from || !to) {
      const anchor = q.weekOf ?? uzbDateString(new Date());
      const range = weekRangeContaining(anchor);
      from = from ?? range.from;
      to = to ?? range.to;
    }
    if (from > to) throw new ValidationError('from must be on or before to');
    const selfId = await resolveSelfEmployeeId(ctx, true);
    // Transient database failures become a retryable 503 in the error handler, for every route rather
    // than only this one — see plugins/errorHandler.ts.
    return buildAttendanceTeamList(ctx, selfId, from, to, q.scope, q.q ?? '', {
      withTotals: q.totals !== '0',
    });
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
      const ctx = requireHrInternal(request);
      const shift = await hrAttendanceShiftRepo.getById(ctx, request.params.id);
      if (!shift) throw new NotFoundError('Shift not found');
      const body = assignBody.parse(request.body);
      const selfEmployeeId = await resolveSelfEmployeeId(ctx, true);
      const targets: HrEmployeeRow[] = [];
      for (const employeeId of body.employeeIds) {
        const emp = await hrEmployeeRepo.getById(ctx, employeeId);
        if (!emp) throw new NotFoundError('Employee not found');
        await assertCanAssignEmployeeShift(ctx, selfEmployeeId, emp.id);
        targets.push(emp);
      }

      // Scope every target before the first write so a mixed authorised/unauthorised batch cannot
      // partially apply and then fail halfway through.
      const assigned: string[] = [];
      for (const emp of targets) {
        await hrAttendanceShiftRepo.assign(ctx, {
          shiftId: shift.id,
          employeeId: emp.id,
          effectiveFrom: body.effectiveFrom,
          ...(body.effectiveTo !== undefined ? { effectiveTo: body.effectiveTo } : {}),
        });
        /**
         * The shift decides which DAY an overnight punch belongs to, so assigning one retroactively
         * changes the answer for punches already stored. Without this, a night worker's existing week
         * keeps its calendar-date bucketing: every worked night shows a missing checkout and 0 hours,
         * and every following morning counts as an absence.
         *
         * The SAME rebucket the link paths run — deliberately not a second implementation of the
         * overnight rule, which is the one thing that must not have two versions.
         */
        await hrAttendancePunchRepo.rebucketWorkDates(ctx, emp.id);
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
