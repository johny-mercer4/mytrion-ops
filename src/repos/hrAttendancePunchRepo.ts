import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  hrAttendancePunches,
  type AttendancePunchKind,
  type AttendancePunchSource,
  type HrAttendancePunch,
  type NewHrAttendancePunch,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrUndefined, isUniqueViolation } from './util.js';

export interface InsertPunchInput {
  employeeId: string | null;
  faceId: string;
  kind: AttendancePunchKind;
  punchedAt: Date;
  workDate: string;
  source?: AttendancePunchSource;
  doorName?: string | null;
  note?: string | null;
  rawEvent?: Record<string, unknown> | null;
}

export const hrAttendancePunchRepo = {
  /**
   * Insert a punch. Returns `'inserted' | 'duplicate'`.
   * Dedup is the unique index on (tenant, face_id, kind, punched_at).
   */
  async insert(
    ctx: TenantContext,
    input: InsertPunchInput,
  ): Promise<'inserted' | 'duplicate'> {
    const row: NewHrAttendancePunch = {
      tenantId: ctx.tenantId,
      employeeId: input.employeeId,
      faceId: input.faceId.trim(),
      kind: input.kind,
      punchedAt: input.punchedAt,
      workDate: input.workDate,
      source: input.source ?? 'hikvision',
      doorName: input.doorName?.trim() || null,
      note: input.note?.trim() || null,
      rawEvent: input.rawEvent ?? null,
    };
    try {
      await db.insert(hrAttendancePunches).values(row);
      return 'inserted';
    } catch (err) {
      if (isUniqueViolation(err)) return 'duplicate';
      throw err;
    }
  },

  async listForEmployeeRange(
    ctx: TenantContext,
    employeeId: string,
    from: string,
    to: string,
  ): Promise<HrAttendancePunch[]> {
    return db
      .select()
      .from(hrAttendancePunches)
      .where(
        and(
          eq(hrAttendancePunches.tenantId, ctx.tenantId),
          eq(hrAttendancePunches.employeeId, employeeId),
          gte(hrAttendancePunches.workDate, from),
          lte(hrAttendancePunches.workDate, to),
        ),
      )
      .orderBy(asc(hrAttendancePunches.punchedAt));
  },

  async listRange(
    ctx: TenantContext,
    from: string,
    to: string,
    employeeId?: string,
  ): Promise<HrAttendancePunch[]> {
    const clauses = [
      eq(hrAttendancePunches.tenantId, ctx.tenantId),
      gte(hrAttendancePunches.workDate, from),
      lte(hrAttendancePunches.workDate, to),
    ];
    if (employeeId) clauses.push(eq(hrAttendancePunches.employeeId, employeeId));
    return db
      .select()
      .from(hrAttendancePunches)
      .where(and(...clauses))
      .orderBy(asc(hrAttendancePunches.workDate), asc(hrAttendancePunches.punchedAt));
  },

  async lastForEmployee(
    ctx: TenantContext,
    employeeId: string,
  ): Promise<HrAttendancePunch | undefined> {
    const rows = await db
      .select()
      .from(hrAttendancePunches)
      .where(
        and(
          eq(hrAttendancePunches.tenantId, ctx.tenantId),
          eq(hrAttendancePunches.employeeId, employeeId),
        ),
      )
      .orderBy(sql`${hrAttendancePunches.punchedAt} desc`)
      .limit(1);
    return firstOrUndefined(rows);
  },
};
