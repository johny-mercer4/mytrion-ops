import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, sql } from 'drizzle-orm';
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

const isAllowedPunchSource = sql`
  (${hrAttendancePunches.source} = 'manual' or ${hrAttendancePunches.doorName} ilike '%Ganga%')
`;

/**
 * Optional bounds for the set-based maintenance below.
 *
 * Both statements are correct unbounded, and stayed that way while the only callers were one-employee
 * events. The DWH sync runs them on a page load against a table that grows by ~940 punches a day, so
 * it passes the window the user is actually looking at — a sweep of every punch ever recorded is not
 * something an interactive request should pay for.
 */
export interface PunchRangeScope {
  employeeId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

async function rebucketMappedGangaPunches(
  ctx: TenantContext,
  scope: PunchRangeScope = {},
): Promise<void> {
  const employeeClause = scope.employeeId
    ? sql`and punch.employee_id = ${scope.employeeId}`
    : sql``;
  /**
   * Filtered on `punched_at`, not `work_date` — this statement exists to CORRECT `work_date`, so
   * trusting the column it is about to rewrite would skip exactly the rows that are wrong. A day of
   * slack on each side covers an overnight punch whose corrected day falls outside the window.
   */
  const fromClause = scope.from
    ? sql`and punch.punched_at >= (${scope.from}::date - 1) at time zone 'Asia/Tashkent'`
    : sql``;
  const toClause = scope.to
    ? sql`and punch.punched_at < (${scope.to}::date + 2) at time zone 'Asia/Tashkent'`
    : sql``;
  await db.execute(sql`
    with corrected as (
      select
        punch.id,
        case
          when active_shift.end_local::time <= active_shift.start_local::time
           and (punch.punched_at at time zone 'Asia/Tashkent')::time
               < least(
                   active_shift.start_local::time,
                   (active_shift.end_local::time + interval '4 hours')::time
                 )
            then (punch.punched_at at time zone 'Asia/Tashkent')::date - 1
          else (punch.punched_at at time zone 'Asia/Tashkent')::date
        end as work_date
      from hr_attendance_punches punch
      join lateral (
        select shift.start_local, shift.end_local
        from hr_attendance_shift_assignments assignment
        join hr_attendance_shifts shift
          on shift.id = assignment.shift_id
         and shift.tenant_id = assignment.tenant_id
         and shift.is_active = true
        where assignment.tenant_id = punch.tenant_id
          and assignment.employee_id = punch.employee_id
          and assignment.effective_from
              <= (punch.punched_at at time zone 'Asia/Tashkent')::date
          and (
            assignment.effective_to is null
            or assignment.effective_to
               >= (punch.punched_at at time zone 'Asia/Tashkent')::date
                  - case
                      when shift.end_local::time <= shift.start_local::time then 1
                      else 0
                    end
          )
        order by assignment.effective_from desc
        limit 1
      ) active_shift on true
      where punch.tenant_id = ${ctx.tenantId}
        and punch.employee_id is not null
        and punch.door_name ilike '%Ganga%'
        ${employeeClause}
        ${fromClause}
        ${toClause}
    )
    update hr_attendance_punches punch
    set work_date = corrected.work_date
    from corrected
    where punch.id = corrected.id
      and punch.tenant_id = ${ctx.tenantId}
      and punch.work_date is distinct from corrected.work_date
  `);
}

export const hrAttendancePunchRepo = {
  /**
   * Insert a punch. Returns `'inserted' | 'duplicate' | 'ignored'`.
   * Dedup is the unique index on (tenant, face_id, kind, punched_at).
   */
  async insert(
    ctx: TenantContext,
    input: InsertPunchInput,
  ): Promise<'inserted' | 'duplicate' | 'ignored'> {
    const source = input.source ?? 'hikvision';
    const doorName = input.doorName?.trim() || null;
    if (source === 'hikvision' && !doorName?.toLocaleLowerCase('en-US').includes('ganga')) {
      return 'ignored';
    }
    const row: NewHrAttendancePunch = {
      tenantId: ctx.tenantId,
      employeeId: input.employeeId,
      faceId: input.faceId.trim(),
      kind: input.kind,
      punchedAt: input.punchedAt,
      workDate: input.workDate,
      source,
      doorName,
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
          isAllowedPunchSource,
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
      isAllowedPunchSource,
    ];
    if (employeeId) clauses.push(eq(hrAttendancePunches.employeeId, employeeId));
    return db
      .select()
      .from(hrAttendancePunches)
      .where(and(...clauses))
      .orderBy(asc(hrAttendancePunches.workDate), asc(hrAttendancePunches.punchedAt));
  },

  /** Week punches for a known employee set — avoids scanning the whole tenant punch table. */
  async listForEmployeesRange(
    ctx: TenantContext,
    employeeIds: string[],
    from: string,
    to: string,
  ): Promise<HrAttendancePunch[]> {
    if (employeeIds.length === 0) return [];
    return db
      .select()
      .from(hrAttendancePunches)
      .where(
        and(
          eq(hrAttendancePunches.tenantId, ctx.tenantId),
          inArray(hrAttendancePunches.employeeId, employeeIds),
          gte(hrAttendancePunches.workDate, from),
          lte(hrAttendancePunches.workDate, to),
          isAllowedPunchSource,
        ),
      )
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
          isAllowedPunchSource,
        ),
      )
      .orderBy(sql`${hrAttendancePunches.punchedAt} desc`)
      .limit(1);
    return firstOrUndefined(rows);
  },

  /** One latest authoritative punch per employee, for the HR Team directory. */
  async lastForEmployees(
    ctx: TenantContext,
    employeeIds: string[],
  ): Promise<Map<string, HrAttendancePunch>> {
    if (employeeIds.length === 0) return new Map();
    const rows = await db
      .selectDistinctOn([hrAttendancePunches.employeeId])
      .from(hrAttendancePunches)
      .where(
        and(
          eq(hrAttendancePunches.tenantId, ctx.tenantId),
          inArray(hrAttendancePunches.employeeId, employeeIds),
          isAllowedPunchSource,
        ),
      )
      .orderBy(hrAttendancePunches.employeeId, desc(hrAttendancePunches.punchedAt));
    const byEmployee = new Map<string, HrAttendancePunch>();
    for (const row of rows) {
      if (row.employeeId) byEmployee.set(row.employeeId, row);
    }
    return byEmployee;
  },

  /** Link historical unmapped Ganga punches as soon as HR gives an employee a Face ID. */
  /**
   * Move one punch onto a different work date.
   *
   * `work_date` is denormalised — it is the column every read filters and groups on — and it depends on
   * the employee's SHIFT, which can be assigned or changed long after the punch arrived. Bulk repair
   * lives in `rebucketWorkDates`; this is the single-row escape hatch.
   */
  /**
   * Re-derive `work_date` for an employee's Ganga punches from the shift now in force.
   *
   * Already run whenever punches are LINKED to an employee. Exposed because assigning a shift changes
   * the answer too: the overnight rule decides which day a post-midnight punch belongs to, so a
   * retroactive assignment leaves every night already stored on the wrong day.
   */
  async rebucketWorkDates(
    ctx: TenantContext,
    scope: PunchRangeScope | string = {},
  ): Promise<void> {
    await rebucketMappedGangaPunches(ctx, typeof scope === 'string' ? { employeeId: scope } : scope);
  },

  /**
   * Bulk-insert punches, skipping ones already stored. Returns how many were new.
   *
   * The per-row `insert` above catches a unique violation to report `'duplicate'`, which is right for a
   * webhook delivering a handful of events. The DWH sync re-reads a whole window every time — a week is
   * ~6.5k rows of which nearly all are already present — so it needs the conflict handled IN the
   * statement rather than as thousands of round trips and thousands of caught exceptions.
   *
   * Chunked because Postgres caps a statement at 65535 bind parameters; at ~10 columns a single week
   * would sail past that and fail as one unhelpful error.
   */
  async insertMany(ctx: TenantContext, inputs: readonly InsertPunchInput[]): Promise<number> {
    const CHUNK = 500;
    let inserted = 0;
    for (let i = 0; i < inputs.length; i += CHUNK) {
      const rows: NewHrAttendancePunch[] = inputs.slice(i, i + CHUNK).map((input) => ({
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
      }));
      if (rows.length === 0) continue;
      const returned = await db
        .insert(hrAttendancePunches)
        .values(rows)
        .onConflictDoNothing()
        .returning({ id: hrAttendancePunches.id });
      inserted += returned.length;
    }
    return inserted;
  },

  async setWorkDate(ctx: TenantContext, punchId: string, workDate: string): Promise<void> {
    await db
      .update(hrAttendancePunches)
      .set({ workDate })
      .where(
        and(eq(hrAttendancePunches.tenantId, ctx.tenantId), eq(hrAttendancePunches.id, punchId)),
      );
  },

  async linkUnmappedForEmployee(
    ctx: TenantContext,
    employeeId: string,
    faceId: string,
  ): Promise<number> {
    const id = faceId.trim();
    if (!id) return 0;
    const inputNormalized = /^[0-9]+$/.test(id)
      ? id.replace(/^0+/, '') || '0'
      : id.toLocaleLowerCase('en-US');
    const normalizedPunch = sql<string>`
      case
        when btrim(${hrAttendancePunches.faceId}) ~ '^[0-9]+$'
          then coalesce(nullif(ltrim(btrim(${hrAttendancePunches.faceId}), '0'), ''), '0')
        else lower(btrim(${hrAttendancePunches.faceId}))
      end
    `;
    const rows = await db
      .update(hrAttendancePunches)
      .set({ employeeId })
      .where(
        and(
          eq(hrAttendancePunches.tenantId, ctx.tenantId),
          isNull(hrAttendancePunches.employeeId),
          ilike(hrAttendancePunches.doorName, '%Ganga%'),
          sql`${normalizedPunch} = ${inputNormalized}`,
        ),
      )
      .returning({ id: hrAttendancePunches.id });
    if (rows.length > 0) {
      await rebucketMappedGangaPunches(ctx, { employeeId });
    }
    return rows.length;
  },

  /**
   * Set-based Face ID reconciliation after an employee-directory sync.
   * Ambiguous normalized Face IDs are deliberately left unmapped.
   */
  async reconcileUnmapped(ctx: TenantContext, scope: PunchRangeScope = {}): Promise<number> {
    const fromClause = scope.from
      ? sql`and punch.punched_at >= (${scope.from}::date - 1) at time zone 'Asia/Tashkent'`
      : sql``;
    const toClause = scope.to
      ? sql`and punch.punched_at < (${scope.to}::date + 2) at time zone 'Asia/Tashkent'`
      : sql``;
    const rows = await db.execute(sql`
      with employee_faces as (
        select
          case
            when btrim(face_id) ~ '^[0-9]+$'
              then coalesce(nullif(ltrim(btrim(face_id), '0'), ''), '0')
            else lower(btrim(face_id))
          end as normalized_face_id,
          min(id) as employee_id,
          count(*) as matches
        from hr_employees
        where tenant_id = ${ctx.tenantId}
          and face_id is not null
          and btrim(face_id) <> ''
        group by 1
      )
      update hr_attendance_punches punch
      set employee_id = employee_faces.employee_id
      from employee_faces
      where punch.tenant_id = ${ctx.tenantId}
        and punch.employee_id is null
        and punch.door_name ilike '%Ganga%'
        and employee_faces.matches = 1
        and (
          case
            when btrim(punch.face_id) ~ '^[0-9]+$'
              then coalesce(nullif(ltrim(btrim(punch.face_id), '0'), ''), '0')
            else lower(btrim(punch.face_id))
          end
        ) = employee_faces.normalized_face_id
        ${fromClause}
        ${toClause}
      returning punch.id
    `);
    const count = Array.isArray(rows) ? rows.length : 0;
    if (count > 0) {
      await rebucketMappedGangaPunches(ctx, scope);
    }
    return count;
  },

  async countUnmappedRange(ctx: TenantContext, from: string, to: string): Promise<number> {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(hrAttendancePunches)
      .where(
        and(
          eq(hrAttendancePunches.tenantId, ctx.tenantId),
          isNull(hrAttendancePunches.employeeId),
          gte(hrAttendancePunches.workDate, from),
          lte(hrAttendancePunches.workDate, to),
          ilike(hrAttendancePunches.doorName, '%Ganga%'),
        ),
      );
    return rows[0]?.count ?? 0;
  },
};
