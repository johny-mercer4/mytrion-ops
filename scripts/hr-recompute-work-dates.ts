/**
 * Backfill: rebucket `hr_attendance_punches.work_date` for every employee.
 *
 * `work_date` depends on the SHIFT (an overnight 19:00–03:00 puts a 02:00 exit on the previous day).
 * The repo already rebuckets when punches are linked to an employee, and the assign route now does the
 * same — but only from the moment of that event. Rows stored before those fixes are still bucketed the
 * way they were ingested, which for a night worker means every worked night shows a missing checkout
 * and 0 hours and every following morning counts as an absence. This walks the existing data once.
 *
 * Calls the SAME repo routine the runtime paths use, so there is exactly one implementation of the
 * overnight rule. Safe to re-run: the update touches only rows whose value actually differs.
 *
 *   pnpm tsx scripts/hr-recompute-work-dates.ts --apply
 *
 * IT WRITES TO WHATEVER `MYTRION_OPS_DATABASE_URL` POINTS AT. Check that first — in this repo it has
 * been the remote Render database, not localhost.
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { hrAttendancePunchRepo } from '../src/repos/hrAttendancePunchRepo.js';
import { DEFAULT_TENANT_ID } from '../src/config/constants.js';
import type { TenantContext } from '../src/types/tenantContext.js';

const ctx = {
  tenantId: DEFAULT_TENANT_ID,
  userId: 'script:rebucket-work-dates',
  audience: 'internal',
  role: 'admin',
  departments: [],
  allDepartmentAccess: true,
  bypassRbac: true,
} as unknown as TenantContext;

/** How many Ganga punches currently sit on a different day from the one their shift implies. */
async function countStale(): Promise<number> {
  const rows = await db.execute(sql`
    select count(*)::int as n
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
        and assignment.effective_from <= (punch.punched_at at time zone 'Asia/Tashkent')::date
      order by assignment.effective_from desc
      limit 1
    ) active_shift on true
    where punch.tenant_id = ${ctx.tenantId}
      and punch.employee_id is not null
      and punch.door_name ilike '%Ganga%'
      and punch.work_date is distinct from (
        case
          when active_shift.end_local::time <= active_shift.start_local::time
           and (punch.punched_at at time zone 'Asia/Tashkent')::time
               < least(
                   active_shift.start_local::time,
                   (active_shift.end_local::time + interval '4 hours')::time
                 )
            then (punch.punched_at at time zone 'Asia/Tashkent')::date - 1
          else (punch.punched_at at time zone 'Asia/Tashkent')::date
        end
      )
  `);
  const row = (Array.isArray(rows) ? rows[0] : (rows as { rows?: unknown[] }).rows?.[0]) as
    | { n?: number }
    | undefined;
  return row?.n ?? 0;
}

async function main(): Promise<void> {
  const before = await countStale();
  console.log(`${before} punches are on the wrong work date.`);

  if (!process.argv.includes('--apply')) {
    console.log('Dry run. Re-run with --apply to rebucket them.');
    return;
  }
  await hrAttendancePunchRepo.rebucketWorkDates(ctx);
  console.log(`Rebucketed. ${await countStale()} remaining.`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
