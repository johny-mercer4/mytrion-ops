import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  hrAttendanceShiftAssignments,
  hrAttendanceShifts,
  type HrAttendanceShift,
  type HrAttendanceShiftAssignment,
  type NewHrAttendanceShift,
  type NewHrAttendanceShiftAssignment,
} from '../db/schema/index.js';
import { ConflictError } from '../lib/errors.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow, firstOrUndefined, isUniqueViolation } from './util.js';

export interface ShiftWriteInput {
  name: string;
  timezone?: string | null;
  startLocal: string;
  endLocal: string;
  isActive?: boolean;
}

export type AttendanceAssignmentWithShift = HrAttendanceShiftAssignment & {
  shift: HrAttendanceShift;
};

const SHIFT_COLS = {
  id: hrAttendanceShifts.id,
  tenantId: hrAttendanceShifts.tenantId,
  name: hrAttendanceShifts.name,
  timezone: hrAttendanceShifts.timezone,
  startLocal: hrAttendanceShifts.startLocal,
  endLocal: hrAttendanceShifts.endLocal,
  isActive: hrAttendanceShifts.isActive,
  createdAt: hrAttendanceShifts.createdAt,
  updatedAt: hrAttendanceShifts.updatedAt,
} as const;

export const hrAttendanceShiftRepo = {
  async list(ctx: TenantContext): Promise<HrAttendanceShift[]> {
    return db
      .select(SHIFT_COLS)
      .from(hrAttendanceShifts)
      .where(eq(hrAttendanceShifts.tenantId, ctx.tenantId))
      .orderBy(asc(hrAttendanceShifts.name));
  },

  async getById(ctx: TenantContext, id: string): Promise<HrAttendanceShift | undefined> {
    const rows = await db
      .select(SHIFT_COLS)
      .from(hrAttendanceShifts)
      .where(and(eq(hrAttendanceShifts.tenantId, ctx.tenantId), eq(hrAttendanceShifts.id, id)))
      .limit(1);
    return firstOrUndefined(rows);
  },

  async create(ctx: TenantContext, input: ShiftWriteInput): Promise<HrAttendanceShift> {
    const row: NewHrAttendanceShift = {
      tenantId: ctx.tenantId,
      name: input.name.trim(),
      timezone: (input.timezone?.trim() || 'Asia/Tashkent'),
      startLocal: input.startLocal.trim(),
      endLocal: input.endLocal.trim(),
      isActive: input.isActive ?? true,
    };
    try {
      const rows = await db.insert(hrAttendanceShifts).values(row).returning(SHIFT_COLS);
      return firstOrThrow(rows, 'hr_attendance_shifts insert returned no row');
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError(`A shift named “${row.name}” already exists`);
      }
      throw err;
    }
  },

  async update(
    ctx: TenantContext,
    id: string,
    patch: Partial<ShiftWriteInput>,
  ): Promise<HrAttendanceShift | undefined> {
    const updates: Partial<NewHrAttendanceShift> = { updatedAt: new Date() };
    if (patch.name !== undefined) updates.name = patch.name.trim();
    if (patch.timezone !== undefined) {
      updates.timezone = patch.timezone?.trim() || 'Asia/Tashkent';
    }
    if (patch.startLocal !== undefined) updates.startLocal = patch.startLocal.trim();
    if (patch.endLocal !== undefined) updates.endLocal = patch.endLocal.trim();
    if (patch.isActive !== undefined) updates.isActive = patch.isActive;
    try {
      const rows = await db
        .update(hrAttendanceShifts)
        .set(updates)
        .where(and(eq(hrAttendanceShifts.tenantId, ctx.tenantId), eq(hrAttendanceShifts.id, id)))
        .returning(SHIFT_COLS);
      return firstOrUndefined(rows);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError('A shift with that name already exists');
      }
      throw err;
    }
  },

  async delete(ctx: TenantContext, id: string): Promise<boolean> {
    await db
      .delete(hrAttendanceShiftAssignments)
      .where(
        and(
          eq(hrAttendanceShiftAssignments.tenantId, ctx.tenantId),
          eq(hrAttendanceShiftAssignments.shiftId, id),
        ),
      );
    const rows = await db
      .delete(hrAttendanceShifts)
      .where(and(eq(hrAttendanceShifts.tenantId, ctx.tenantId), eq(hrAttendanceShifts.id, id)))
      .returning({ id: hrAttendanceShifts.id });
    return rows.length > 0;
  },

  async assign(
    ctx: TenantContext,
    input: {
      shiftId: string;
      employeeId: string;
      effectiveFrom: string;
      effectiveTo?: string | null;
    },
  ): Promise<HrAttendanceShiftAssignment> {
    const row: NewHrAttendanceShiftAssignment = {
      tenantId: ctx.tenantId,
      shiftId: input.shiftId,
      employeeId: input.employeeId,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo?.trim() || null,
    };
    const rows = await db
      .insert(hrAttendanceShiftAssignments)
      .values(row)
      .onConflictDoUpdate({
        target: [
          hrAttendanceShiftAssignments.tenantId,
          hrAttendanceShiftAssignments.employeeId,
          hrAttendanceShiftAssignments.effectiveFrom,
        ],
        set: {
          shiftId: input.shiftId,
          effectiveTo: input.effectiveTo?.trim() || null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return firstOrThrow(rows, 'hr_attendance_shift_assignments insert returned no row');
  },

  /** Active assignment for an employee on a UZB calendar date. */
  async assignmentForDate(
    ctx: TenantContext,
    employeeId: string,
    workDate: string,
  ): Promise<(HrAttendanceShiftAssignment & { shift: HrAttendanceShift }) | undefined> {
    const rows = await db
      .select({
        id: hrAttendanceShiftAssignments.id,
        tenantId: hrAttendanceShiftAssignments.tenantId,
        employeeId: hrAttendanceShiftAssignments.employeeId,
        shiftId: hrAttendanceShiftAssignments.shiftId,
        effectiveFrom: hrAttendanceShiftAssignments.effectiveFrom,
        effectiveTo: hrAttendanceShiftAssignments.effectiveTo,
        createdAt: hrAttendanceShiftAssignments.createdAt,
        updatedAt: hrAttendanceShiftAssignments.updatedAt,
        shift: SHIFT_COLS,
      })
      .from(hrAttendanceShiftAssignments)
      .innerJoin(
        hrAttendanceShifts,
        and(
          eq(hrAttendanceShifts.id, hrAttendanceShiftAssignments.shiftId),
          eq(hrAttendanceShifts.tenantId, ctx.tenantId),
        ),
      )
      .where(
        and(
          eq(hrAttendanceShiftAssignments.tenantId, ctx.tenantId),
          eq(hrAttendanceShiftAssignments.employeeId, employeeId),
          lte(hrAttendanceShiftAssignments.effectiveFrom, workDate),
          sql`(
            ${hrAttendanceShiftAssignments.effectiveTo} is null
            or ${hrAttendanceShiftAssignments.effectiveTo} >= ${workDate}
          )`,
          eq(hrAttendanceShifts.isActive, true),
        ),
      )
      .orderBy(sql`${hrAttendanceShiftAssignments.effectiveFrom} desc`)
      .limit(1);
    const hit = firstOrUndefined(rows);
    if (!hit) return undefined;
    return {
      id: hit.id,
      tenantId: hit.tenantId,
      employeeId: hit.employeeId,
      shiftId: hit.shiftId,
      effectiveFrom: hit.effectiveFrom,
      effectiveTo: hit.effectiveTo,
      createdAt: hit.createdAt,
      updatedAt: hit.updatedAt,
      shift: hit.shift,
    };
  },

  /** One active assignment per employee on a UZB calendar date, fetched in a single query. */
  async assignmentsForEmployeesDate(
    ctx: TenantContext,
    employeeIds: string[],
    workDate: string,
  ): Promise<Map<string, AttendanceAssignmentWithShift>> {
    if (employeeIds.length === 0) return new Map();
    const rows = await db
      .selectDistinctOn([hrAttendanceShiftAssignments.employeeId], {
        id: hrAttendanceShiftAssignments.id,
        tenantId: hrAttendanceShiftAssignments.tenantId,
        employeeId: hrAttendanceShiftAssignments.employeeId,
        shiftId: hrAttendanceShiftAssignments.shiftId,
        effectiveFrom: hrAttendanceShiftAssignments.effectiveFrom,
        effectiveTo: hrAttendanceShiftAssignments.effectiveTo,
        createdAt: hrAttendanceShiftAssignments.createdAt,
        updatedAt: hrAttendanceShiftAssignments.updatedAt,
        shift: SHIFT_COLS,
      })
      .from(hrAttendanceShiftAssignments)
      .innerJoin(
        hrAttendanceShifts,
        and(
          eq(hrAttendanceShifts.id, hrAttendanceShiftAssignments.shiftId),
          eq(hrAttendanceShifts.tenantId, ctx.tenantId),
        ),
      )
      .where(
        and(
          eq(hrAttendanceShiftAssignments.tenantId, ctx.tenantId),
          inArray(hrAttendanceShiftAssignments.employeeId, employeeIds),
          lte(hrAttendanceShiftAssignments.effectiveFrom, workDate),
          sql`(
            ${hrAttendanceShiftAssignments.effectiveTo} is null
            or ${hrAttendanceShiftAssignments.effectiveTo} >= ${workDate}
          )`,
          eq(hrAttendanceShifts.isActive, true),
        ),
      )
      .orderBy(
        hrAttendanceShiftAssignments.employeeId,
        desc(hrAttendanceShiftAssignments.effectiveFrom),
      );
    const byEmployee = new Map<string, AttendanceAssignmentWithShift>();
    for (const row of rows) {
      byEmployee.set(row.employeeId, {
        id: row.id,
        tenantId: row.tenantId,
        employeeId: row.employeeId,
        shiftId: row.shiftId,
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        shift: row.shift,
      });
    }
    return byEmployee;
  },

  async listAssignmentsForShift(
    ctx: TenantContext,
    shiftId: string,
  ): Promise<HrAttendanceShiftAssignment[]> {
    return db
      .select()
      .from(hrAttendanceShiftAssignments)
      .where(
        and(
          eq(hrAttendanceShiftAssignments.tenantId, ctx.tenantId),
          eq(hrAttendanceShiftAssignments.shiftId, shiftId),
        ),
      )
      .orderBy(asc(hrAttendanceShiftAssignments.effectiveFrom));
  },
};
