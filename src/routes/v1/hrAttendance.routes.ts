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
  managesAnyone,
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
import { buildCallerContext } from './callerIdentity.js';

const SECRET_HEADER = 'x-attendance-webhook-secret';

function requireHrInternal(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'hr', 'HR directory');
}

/** HR department access (or the elevations that stand in for it). */
function hasHrAccess(ctx: TenantContext): boolean {
  return (
    ctx.role === 'admin' ||
    ctx.bypassRbac === true ||
    ctx.allDepartmentAccess === true ||
    ctx.departments.includes('hr')
  );
}

/**
 * The caller's context with "View as" applied — internal-only.
 *
 * `buildCallerContext` rewrites the identity to the act-as target when an admin (or a granted viewer)
 * is impersonating, so "self" in `/me` and the team scoping resolve to the PREVIEWED user, not the real
 * admin. Every other attendance route reads `self`/`team` off this ctx, so routing them through here is
 * what makes the global View-as show the target's own attendance instead of the admin's. With no act-as
 * header it returns the caller's own context, identical to the `requireInternal` it replaced.
 */
async function attendanceCtx(request: FastifyRequest): Promise<TenantContext> {
  const ctx = await buildCallerContext(request, {});
  if (ctx.audience !== 'internal') throw new RBACError('Attendance is internal-only');
  return ctx;
}

/**
 * Who may read attendance: HR, **and any team lead, for their own team only.**
 *
 * A team lead has no `hr` department access, so every route here used to 403 them — while
 * `resolveAttendanceTeam` had always computed a manager's team correctly (reportees ∪ departments they
 * lead). The gate was the only thing missing.
 *
 * Two properties make widening this safe:
 *
 *  1. **Membership is proven against the database, not asserted.** `managesAnyone` reads reporting lines
 *     and department leads. A caller cannot claim to be a manager with a header, and no unverified Zoho
 *     profile string decides it.
 *  2. **The gate does not decide what they see; the scoping does.** `resolveAttendanceTeam` returns only
 *     their team for a non-`canViewAll` caller, and `assertCanViewEmployeeAttendance` re-checks every
 *     single-employee read. This route file deliberately does NOT relax the employee directory,
 *     departments or org-structure routes — those keep `requireHrInternal`, so a team lead who reaches
 *     the HR workspace can open Attendance and nothing else.
 *
 * Returns `selfId` because every scoped call needs it and it has already been resolved here.
 */
async function requireAttendanceAccess(
  request: FastifyRequest,
): Promise<{ ctx: TenantContext; selfId: string }> {
  const ctx = await attendanceCtx(request);
  if (hasHrAccess(ctx)) return { ctx, selfId: await resolveSelfEmployeeId(ctx, true) };
  // Not HR: they must be linked to an employee row AND actually manage someone. `false` here on
  // purpose — an unlinked non-HR caller has no team to scope to, so there is nothing to show them.
  const selfId = await resolveSelfEmployeeId(ctx, false);
  if (!(await managesAnyone(ctx, selfId))) {
    throw new RBACError('Attendance is available to HR, and to managers for their own team');
  }
  return { ctx, selfId };
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
    // Own attendance is open to every internal employee — no HR grant or team needed. `attendanceCtx`
    // applies View-as, so under an admin's preview this resolves the PREVIEWED user's own days. There
    // is no employeeId param, so it can only ever read the (effective) caller's own record.
    const ctx = await attendanceCtx(request);
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
    // Pull THIS person's own punches from the warehouse before reading them, so opening My Data shows
    // current attendance without a manual Refresh. Scoped to one employee (tens of rows, its own 60s
    // cooldown) — never the ~4.4k whole-window sweep the page load deliberately avoids. Swallowed on
    // failure: the stored week still renders, and the frontend paints it from cache meanwhile.
    try {
      await syncAttendanceFromDwh(ctx, from, to, { employeeId });
    } catch (err) {
      request.log.warn({ err, employeeId }, 'hr.attendance.me self-sync failed; serving stored');
    }
    return buildAttendanceSummary(ctx, employeeId, from, to);
  });

  app.get('/hr/attendance/summary', auth, async (request) => {
    const { ctx, selfId } = await requireAttendanceAccess(request);
    const q = z
      .object({
        from: dateStr,
        to: dateStr,
        employeeId: z.string().max(80).optional(),
      })
      .parse(request.query);
    if (q.from > q.to) throw new ValidationError('from must be on or before to');
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
    const { ctx, selfId } = await requireAttendanceAccess(request);
    const body = z
      .object({
        from: dateStr.optional(),
        to: dateStr.optional(),
        weekOf: dateStr.optional(),
        // The server holds a completed sync for a minute so page views are cheap. An explicit Refresh
        // is the user saying they do not believe what is on screen, so it must bypass that.
        force: z.boolean().optional(),
        /**
         * Pull ONE person's punches instead of the whole window. This is what opening someone in the
         * roster does: a week for one employee is tens of rows, against ~4.4k for everybody, so the
         * page itself never has to wait on the warehouse.
         */
        employeeId: z.string().max(80).optional(),
      })
      .parse(request.body ?? {});
    const range = weekRangeContaining(body.weekOf ?? uzbDateString(new Date()));
    const from = body.from ?? range.from;
    const to = body.to ?? range.to;
    if (from > to) throw new ValidationError('from must be on or before to');
    if (daysInclusive(from, to) > MAX_SYNC_DAYS) {
      throw new ValidationError(`Sync window may not exceed ${MAX_SYNC_DAYS} days`);
    }
    const target = body.employeeId?.trim();
    if (target) {
      // Reading someone else's attendance is gated exactly as the direct summary route gates it —
      // a cheaper door to the same data must not be a wider one.
      if (target !== selfId) {
        const emp = await hrEmployeeRepo.getById(ctx, target);
        if (!emp) throw new NotFoundError('Employee not found');
        await assertCanViewEmployeeAttendance(ctx, selfId, target);
      }
    }
    return syncAttendanceFromDwh(ctx, from, to, {
      force: body.force ?? false,
      ...(target ? { employeeId: target } : {}),
    });
  });

  /**
   * Team attendance directory.
   * Managers: Direct = reportees; All = reportees ∪ department members they lead.
   * HR Manager / Admin: Direct = their reportees; All = every Active employee.
   */
  app.get('/hr/attendance/team', auth, async (request) => {
    const { ctx, selfId } = await requireAttendanceAccess(request);
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
    // Transient database failures become a retryable 503 in the error handler, for every route rather
    // than only this one — see plugins/errorHandler.ts.
    return buildAttendanceTeamList(ctx, selfId, from, to, q.scope, q.q ?? '', {
      withTotals: q.totals !== '0',
    });
  });

  app.get('/hr/attendance/export', auth, async (request) => {
    const { ctx, selfId } = await requireAttendanceAccess(request);
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
    /**
     * The same per-employee check the on-screen summary uses. Was Mytrion-Admin only, which is why it
     * needs stating: a CSV is the SAME data as the panel, so it must answer to the same rule rather than
     * to a coarser one — otherwise the export becomes the wider door.
     */
    if (emp.id !== selfId) await assertCanViewEmployeeAttendance(ctx, selfId, emp.id);
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
    // Read-only list of shift definitions — a manager needs it to assign one to their own team.
    const { ctx } = await requireAttendanceAccess(request);
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
      /**
       * The one WRITE a team lead gets, and it was already scoped before the gate allowed them in:
       * `assertCanAssignEmployeeShift` admits only their reportees and led-department members, and
       * explicitly refuses a manager assigning their OWN shift. Every target is checked before the
       * first write, so a mixed batch cannot half-apply.
       */
      const { ctx, selfId: selfEmployeeId } = await requireAttendanceAccess(request);
      const shift = await hrAttendanceShiftRepo.getById(ctx, request.params.id);
      if (!shift) throw new NotFoundError('Shift not found');
      const body = assignBody.parse(request.body);
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
