import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  hrEmployees,
  hrHolidays,
  hrLeaveEntitlements,
  hrLeaveRequests,
  hrLeaveSettings,
  hrLeaveTypes,
  type HrHoliday,
  type HrHolidaySession,
  type HrLeaveSetting,
  type HrLeaveType,
  type HrLeaveTypeCode,
  type NewHrHoliday,
} from '../db/schema/index.js';
import { ConflictError } from '../lib/errors.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow, firstOrUndefined, isUniqueViolation } from './util.js';

export interface LeaveBalanceRow {
  leaveTypeId: string;
  code: HrLeaveTypeCode;
  name: string;
  isPaid: boolean;
  allocatedDays: number;
  adjustmentDays: number;
  approvedDays: number;
  pendingDays: number;
  availableDays: number;
}

export interface HolidayWriteInput {
  date: string;
  name: string;
  location?: string | null;
  isHalfDay?: boolean;
  session?: HrHolidaySession | null;
  isActive?: boolean;
  notes?: string | null;
}

export interface LeaveTypePatch {
  name?: string;
  defaultDays?: number;
  isPaid?: boolean;
  isActive?: boolean;
  sortOrder?: number;
}

const TYPE_COLS = {
  id: hrLeaveTypes.id,
  tenantId: hrLeaveTypes.tenantId,
  code: hrLeaveTypes.code,
  name: hrLeaveTypes.name,
  isPaid: hrLeaveTypes.isPaid,
  defaultDays: hrLeaveTypes.defaultDays,
  isActive: hrLeaveTypes.isActive,
  sortOrder: hrLeaveTypes.sortOrder,
  createdAt: hrLeaveTypes.createdAt,
  updatedAt: hrLeaveTypes.updatedAt,
} as const;

const HOLIDAY_COLS = {
  id: hrHolidays.id,
  tenantId: hrHolidays.tenantId,
  date: hrHolidays.date,
  name: hrHolidays.name,
  location: hrHolidays.location,
  isHalfDay: hrHolidays.isHalfDay,
  session: hrHolidays.session,
  isActive: hrHolidays.isActive,
  notes: hrHolidays.notes,
  createdAt: hrHolidays.createdAt,
  updatedAt: hrHolidays.updatedAt,
} as const;

const SETTING_COLS = {
  id: hrLeaveSettings.id,
  tenantId: hrLeaveSettings.tenantId,
  finalApproverEmployeeId: hrLeaveSettings.finalApproverEmployeeId,
  timezone: hrLeaveSettings.timezone,
  createdAt: hrLeaveSettings.createdAt,
  updatedAt: hrLeaveSettings.updatedAt,
} as const;

function decimal(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export const hrLeavePolicyRepo = {
  async listTypes(ctx: TenantContext, activeOnly = false): Promise<HrLeaveType[]> {
    const clauses = [eq(hrLeaveTypes.tenantId, ctx.tenantId)];
    if (activeOnly) clauses.push(eq(hrLeaveTypes.isActive, true));
    return db
      .select(TYPE_COLS)
      .from(hrLeaveTypes)
      .where(and(...clauses))
      .orderBy(asc(hrLeaveTypes.sortOrder), asc(hrLeaveTypes.name));
  },

  async getType(ctx: TenantContext, id: string): Promise<HrLeaveType | undefined> {
    const rows = await db
      .select(TYPE_COLS)
      .from(hrLeaveTypes)
      .where(and(eq(hrLeaveTypes.tenantId, ctx.tenantId), eq(hrLeaveTypes.id, id)))
      .limit(1);
    return firstOrUndefined(rows);
  },

  async updateType(
    ctx: TenantContext,
    id: string,
    patch: LeaveTypePatch,
  ): Promise<HrLeaveType | undefined> {
    const updates: Partial<typeof hrLeaveTypes.$inferInsert> = { updatedAt: new Date() };
    if (patch.name !== undefined) updates.name = patch.name.trim();
    if (patch.defaultDays !== undefined) updates.defaultDays = String(patch.defaultDays);
    if (patch.isPaid !== undefined) updates.isPaid = patch.isPaid;
    if (patch.isActive !== undefined) updates.isActive = patch.isActive;
    if (patch.sortOrder !== undefined) updates.sortOrder = patch.sortOrder;
    const rows = await db
      .update(hrLeaveTypes)
      .set(updates)
      .where(and(eq(hrLeaveTypes.tenantId, ctx.tenantId), eq(hrLeaveTypes.id, id)))
      .returning(TYPE_COLS);
    return firstOrUndefined(rows);
  },

  async getSettings(ctx: TenantContext): Promise<HrLeaveSetting> {
    const existing = await db
      .select(SETTING_COLS)
      .from(hrLeaveSettings)
      .where(eq(hrLeaveSettings.tenantId, ctx.tenantId))
      .limit(1);
    const hit = firstOrUndefined(existing);
    if (hit) return hit;
    const rows = await db
      .insert(hrLeaveSettings)
      .values({ tenantId: ctx.tenantId })
      .onConflictDoNothing({ target: hrLeaveSettings.tenantId })
      .returning(SETTING_COLS);
    const inserted = firstOrUndefined(rows);
    if (inserted) return inserted;
    const raced = await db
      .select(SETTING_COLS)
      .from(hrLeaveSettings)
      .where(eq(hrLeaveSettings.tenantId, ctx.tenantId))
      .limit(1);
    return firstOrThrow(raced, 'hr_leave_settings row was not created');
  },

  async updateSettings(
    ctx: TenantContext,
    patch: { finalApproverEmployeeId?: string | null; timezone?: string },
  ): Promise<HrLeaveSetting> {
    await this.getSettings(ctx);
    const updates: Partial<typeof hrLeaveSettings.$inferInsert> = { updatedAt: new Date() };
    if (patch.finalApproverEmployeeId !== undefined) {
      updates.finalApproverEmployeeId = patch.finalApproverEmployeeId?.trim() || null;
    }
    if (patch.timezone !== undefined) updates.timezone = patch.timezone.trim();
    const rows = await db
      .update(hrLeaveSettings)
      .set(updates)
      .where(eq(hrLeaveSettings.tenantId, ctx.tenantId))
      .returning(SETTING_COLS);
    return firstOrThrow(rows, 'hr_leave_settings update returned no row');
  },

  async listHolidays(ctx: TenantContext, year: number, activeOnly = false): Promise<HrHoliday[]> {
    const clauses = [
      eq(hrHolidays.tenantId, ctx.tenantId),
      gte(hrHolidays.date, `${year}-01-01`),
      lte(hrHolidays.date, `${year}-12-31`),
    ];
    if (activeOnly) clauses.push(eq(hrHolidays.isActive, true));
    return db
      .select(HOLIDAY_COLS)
      .from(hrHolidays)
      .where(and(...clauses))
      .orderBy(asc(hrHolidays.date), asc(hrHolidays.name));
  },

  async createHoliday(ctx: TenantContext, input: HolidayWriteInput): Promise<HrHoliday> {
    const row: NewHrHoliday = {
      tenantId: ctx.tenantId,
      date: input.date,
      name: input.name.trim(),
      location: input.location?.trim() || 'Uzbekistan',
      isHalfDay: input.isHalfDay ?? false,
      session: input.isHalfDay ? (input.session ?? 'morning') : null,
      isActive: input.isActive ?? true,
      notes: input.notes?.trim() || null,
    };
    try {
      const rows = await db.insert(hrHolidays).values(row).returning(HOLIDAY_COLS);
      return firstOrThrow(rows, 'hr_holidays insert returned no row');
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError('A holiday with that name already exists on this date');
      }
      throw err;
    }
  },

  async updateHoliday(
    ctx: TenantContext,
    id: string,
    patch: Partial<HolidayWriteInput>,
  ): Promise<HrHoliday | undefined> {
    const updates: Partial<NewHrHoliday> = { updatedAt: new Date() };
    if (patch.date !== undefined) updates.date = patch.date;
    if (patch.name !== undefined) updates.name = patch.name.trim();
    if (patch.location !== undefined) updates.location = patch.location?.trim() || 'Uzbekistan';
    if (patch.isHalfDay !== undefined) updates.isHalfDay = patch.isHalfDay;
    if (patch.session !== undefined) updates.session = patch.session;
    if (patch.isActive !== undefined) updates.isActive = patch.isActive;
    if (patch.notes !== undefined) updates.notes = patch.notes?.trim() || null;
    try {
      const rows = await db
        .update(hrHolidays)
        .set(updates)
        .where(and(eq(hrHolidays.tenantId, ctx.tenantId), eq(hrHolidays.id, id)))
        .returning(HOLIDAY_COLS);
      return firstOrUndefined(rows);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError('A holiday with that name already exists on this date');
      }
      throw err;
    }
  },

  async deleteHoliday(ctx: TenantContext, id: string): Promise<boolean> {
    const rows = await db
      .delete(hrHolidays)
      .where(and(eq(hrHolidays.tenantId, ctx.tenantId), eq(hrHolidays.id, id)))
      .returning({ id: hrHolidays.id });
    return rows.length > 0;
  },

  async ensureEntitlements(ctx: TenantContext, employeeId: string, year: number): Promise<void> {
    const types = await this.listTypes(ctx, true);
    if (types.length === 0) return;
    await db
      .insert(hrLeaveEntitlements)
      .values(
        types.map((type) => ({
          tenantId: ctx.tenantId,
          employeeId,
          leaveTypeId: type.id,
          year,
          allocatedDays: type.defaultDays,
        })),
      )
      .onConflictDoNothing({
        target: [
          hrLeaveEntitlements.tenantId,
          hrLeaveEntitlements.employeeId,
          hrLeaveEntitlements.leaveTypeId,
          hrLeaveEntitlements.year,
        ],
      });
  },

  async resetEntitlementsToDefaults(ctx: TenantContext, year: number): Promise<number> {
    const [employees, types] = await Promise.all([
      db
        .select({ id: hrEmployees.id })
        .from(hrEmployees)
        .where(
          and(
            eq(hrEmployees.tenantId, ctx.tenantId),
            sql`lower(${hrEmployees.status}) = 'active'`,
          ),
        ),
      this.listTypes(ctx, true),
    ]);
    const values = employees.flatMap((employee) =>
      types.map((type) => ({
        tenantId: ctx.tenantId,
        employeeId: employee.id,
        leaveTypeId: type.id,
        year,
        allocatedDays: type.defaultDays,
        updatedAt: new Date(),
      })),
    );
    if (values.length === 0) return 0;
    await db
      .insert(hrLeaveEntitlements)
      .values(values)
      .onConflictDoUpdate({
        target: [
          hrLeaveEntitlements.tenantId,
          hrLeaveEntitlements.employeeId,
          hrLeaveEntitlements.leaveTypeId,
          hrLeaveEntitlements.year,
        ],
        set: {
          allocatedDays: sql`excluded.allocated_days`,
          updatedAt: new Date(),
        },
      });
    return values.length;
  },

  async balanceSummary(
    ctx: TenantContext,
    employeeId: string,
    year: number,
  ): Promise<LeaveBalanceRow[]> {
    await this.ensureEntitlements(ctx, employeeId, year);
    const statuses: Array<'pending_lead' | 'pending_hr' | 'approved'> = [
      'pending_lead',
      'pending_hr',
      'approved',
    ];
    const rows = await db
      .select({
        leaveTypeId: hrLeaveTypes.id,
        code: hrLeaveTypes.code,
        name: hrLeaveTypes.name,
        isPaid: hrLeaveTypes.isPaid,
        allocatedDays: hrLeaveEntitlements.allocatedDays,
        adjustmentDays: hrLeaveEntitlements.adjustmentDays,
        approvedDays: sql<string>`coalesce(sum(case when ${hrLeaveRequests.status} = 'approved' then ${hrLeaveRequests.requestedDays} else 0 end), 0)`,
        pendingDays: sql<string>`coalesce(sum(case when ${hrLeaveRequests.status} in ('pending_lead', 'pending_hr') then ${hrLeaveRequests.requestedDays} else 0 end), 0)`,
      })
      .from(hrLeaveEntitlements)
      .innerJoin(
        hrLeaveTypes,
        and(
          eq(hrLeaveTypes.tenantId, ctx.tenantId),
          eq(hrLeaveTypes.id, hrLeaveEntitlements.leaveTypeId),
        ),
      )
      .leftJoin(
        hrLeaveRequests,
        and(
          eq(hrLeaveRequests.tenantId, ctx.tenantId),
          eq(hrLeaveRequests.employeeId, employeeId),
          eq(hrLeaveRequests.leaveTypeId, hrLeaveTypes.id),
          gte(hrLeaveRequests.fromDate, `${year}-01-01`),
          lte(hrLeaveRequests.fromDate, `${year}-12-31`),
          inArray(hrLeaveRequests.status, statuses),
        ),
      )
      .where(
        and(
          eq(hrLeaveEntitlements.tenantId, ctx.tenantId),
          eq(hrLeaveEntitlements.employeeId, employeeId),
          eq(hrLeaveEntitlements.year, year),
          eq(hrLeaveTypes.isActive, true),
        ),
      )
      .groupBy(
        hrLeaveTypes.id,
        hrLeaveTypes.code,
        hrLeaveTypes.name,
        hrLeaveTypes.isPaid,
        hrLeaveTypes.sortOrder,
        hrLeaveEntitlements.allocatedDays,
        hrLeaveEntitlements.adjustmentDays,
      )
      .orderBy(asc(hrLeaveTypes.sortOrder), asc(hrLeaveTypes.name));
    return rows.map((row) => {
      const allocatedDays = decimal(row.allocatedDays);
      const adjustmentDays = decimal(row.adjustmentDays);
      const approvedDays = decimal(row.approvedDays);
      const pendingDays = decimal(row.pendingDays);
      return {
        leaveTypeId: row.leaveTypeId,
        code: row.code,
        name: row.name,
        isPaid: row.isPaid,
        allocatedDays,
        adjustmentDays,
        approvedDays,
        pendingDays,
        availableDays: allocatedDays + adjustmentDays - approvedDays - pendingDays,
      };
    });
  },
};
