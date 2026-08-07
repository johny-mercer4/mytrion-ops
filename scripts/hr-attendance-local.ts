/**
 * Local attendance harness: seed a night-shift employee, then read back what the webhook produced.
 *
 * WHY THIS EXISTS. Testing attendance by hand has three sharp edges, and every one of them costs an
 * afternoon:
 *
 *  1. The dev API reads `MYTRION_OPS_DATABASE_URL`, which in this repo points at the REMOTE Render
 *     database. Posting a test punch without changing that writes a fabricated attendance row against a
 *     real employee, and it will show up in their totals.
 *  2. The webhook payload is a BARE ARRAY of `{empCode, event_date_time, door_name}`. Any other shape is
 *     silently `skipped`, not rejected.
 *  3. Only doors matching `%Ganga%` are stored at all — `isAllowedAttendanceDoor` drops the rest.
 *
 * So this refuses to run against anything but localhost, seeds exactly what the pipeline needs, and
 * prints the curl commands with the shape that actually works.
 *
 *   pnpm hr:attendance-local seed      # employee + 19:00–03:00 shift + assignment
 *   pnpm hr:attendance-local verify    # stored punches and the summary they produce
 *   pnpm hr:attendance-local reset     # drop the seeded rows
 *
 * Run the API against the same database, or the webhook will write somewhere else entirely:
 *
 *   MYTRION_OPS_DATABASE_URL='postgresql://octane:octane@localhost:5433/octane_assistant' pnpm dev
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { buildAttendanceSummary } from '../src/modules/hr/attendance/summary.js';
import { systemContext } from '../src/modules/auth/authService.js';

const ctx = systemContext('hr-attendance-local');
const EMPLOYEE_ID = 'hre_local_night';
const FACE_ID = '00000390';
const SHIFT_ID = 'hrs_local_night';

/**
 * The whole point of the harness. A seeded fake employee or a test punch in the production directory is
 * not something you can quietly undo, so this is a hard stop rather than a warning.
 */
function assertLocalDatabase(): void {
  const url = process.env.MYTRION_OPS_DATABASE_URL ?? '';
  if (/@(localhost|127\.0\.0\.1)[:/]/.test(url)) return;
  console.error(
    'Refusing to run: MYTRION_OPS_DATABASE_URL is not localhost.\n' +
      `  currently: ${url.replace(/\/\/.*@/, '//***@') || '(unset)'}\n\n` +
      "Re-run with the local database, e.g.\n" +
      "  MYTRION_OPS_DATABASE_URL='postgresql://octane:octane@localhost:5433/octane_assistant' \\\n" +
      '    pnpm hr:attendance-local seed',
  );
  process.exit(1);
}

async function seed(): Promise<void> {
  await db.execute(sql`
    insert into hr_employees (id, tenant_id, first_name, last_name, status, face_id, source)
    values (${EMPLOYEE_ID}, ${ctx.tenantId}, 'Local', 'Nightshift', 'Active', ${FACE_ID}, 'manual')
    on conflict (id) do update set face_id = excluded.face_id, status = 'Active'`);
  await db.execute(sql`
    insert into hr_attendance_shifts (id, tenant_id, name, timezone, start_local, end_local, is_active)
    values (${SHIFT_ID}, ${ctx.tenantId}, 'Local Night', 'Asia/Tashkent', '19:00', '03:00', true)
    on conflict (id) do nothing`);
  await db.execute(sql`
    insert into hr_attendance_shift_assignments
      (id, tenant_id, shift_id, employee_id, effective_from)
    values (${`${SHIFT_ID}_a`}, ${ctx.tenantId}, ${SHIFT_ID}, ${EMPLOYEE_ID}, '2026-01-01')
    on conflict (id) do nothing`);

  const today = new Date();
  const day = today.toISOString().slice(0, 10);
  const next = new Date(today.getTime() + 86_400_000).toISOString().slice(0, 10);

  /**
   * The port is NOT 3001 by default, and that is the whole point.
   *
   * `pnpm dev` runs on 3001 reading `.env`, where `MYTRION_OPS_DATABASE_URL` is the REMOTE database. A
   * curl aimed there with a valid secret writes a fabricated punch against a real employee — the exact
   * outcome this harness exists to prevent. So the printed command targets a port you have to have
   * started against the local database on purpose.
   */
  const port = process.env.LOCAL_API_PORT ?? '3011';

  console.log(`Seeded ${EMPLOYEE_ID} · Face ID ${FACE_ID} · 19:00–03:00 Asia/Tashkent\n`);
  console.log('1. Start an API on the SAME database as this harness:\n');
  console.log(
    `   MYTRION_OPS_DATABASE_URL='${process.env.MYTRION_OPS_DATABASE_URL ?? ''}' \\\n     PORT=${port} pnpm dev\n`,
  );
  console.log(
    `   Do NOT post to an API started from .env — that one writes to the remote database.\n`,
  );
  console.log('2. Post a night (a BARE ARRAY, and the door must contain "Ganga"):\n');
  // The secret is read from .env by the shell at run time rather than printed here — a dev secret in
  // terminal scrollback and shell history is still a secret somewhere it does not need to be.
  console.log(`   curl -s localhost:${port}/v1/hr/attendance/webhook \\
     -H 'content-type: application/json' \\
     -H "x-attendance-webhook-secret: $(grep '^HR_ATTENDANCE_WEBHOOK_SECRET=' .env | cut -d= -f2-)" \\
     -d '[
       {"empCode":"${FACE_ID}","event_date_time":"${day} 19:04:11","door_name":"Ganga 5F Entry"},
       {"empCode":"${FACE_ID}","event_date_time":"${next} 02:12:40","door_name":"Ganga 5F Exit"}
     ]'\n`);
  console.log('3. Read it back (same database URL, or the guard stops you):\n');
  console.log(
    `   MYTRION_OPS_DATABASE_URL='${process.env.MYTRION_OPS_DATABASE_URL ?? ''}' \\\n     pnpm hr:attendance-local verify\n`,
  );
  console.log('{"skipped":N} means the shape was wrong; {"success":N} means it landed.');
}

async function verify(): Promise<void> {
  const punches = await db.execute(sql`
    select kind, punched_at, work_date, door_name, employee_id
    from hr_attendance_punches
    where tenant_id = ${ctx.tenantId} and face_id = ${FACE_ID}
    order by punched_at`);
  const rows = (Array.isArray(punches) ? punches : (punches as { rows: unknown[] }).rows) as Record<
    string,
    unknown
  >[];

  if (rows.length === 0) {
    console.log('No punches for this Face ID yet — post some (see `seed`).');
    return;
  }

  console.log('Stored punches:');
  for (const r of rows) {
    const mapped = r.employee_id ? 'mapped' : 'UNMAPPED (no employee matched this Face ID)';
    console.log(
      `  ${String(r.kind).padEnd(9)} ${new Date(r.punched_at as string).toISOString()}  work_date=${r.work_date}  ${mapped}`,
    );
  }

  // The work date drives the grouping, so read the week around it rather than around "today".
  const dates = rows.map((r) => String(r.work_date)).sort();
  const from = dates[0]!;
  const to = dates[dates.length - 1]!;
  const summary = await buildAttendanceSummary(ctx, EMPLOYEE_ID, from, to);
  console.log(`\nSummary ${from} → ${to}:`);
  for (const d of summary.days) {
    console.log(
      `  ${d.date}  ${d.status.padEnd(11)} hours=${d.hoursWorked}  sessions=${
        d.sessions.map((s) => s.status).join(',') || '-'
      }  unmatched=${d.unmatchedPunches}`,
    );
  }
  console.log('  totals:', JSON.stringify(summary.totals));
  console.log(
    '\nA night that reads 00:00 with `needs_review` means its exit is bucketed on the NEXT day —' +
      '\nthe overnight work_date bug. See scripts/hr-recompute-work-dates.ts.',
  );
}

async function reset(): Promise<void> {
  await db.execute(sql`delete from hr_attendance_punches where face_id = ${FACE_ID}`);
  await db.execute(
    sql`delete from hr_attendance_shift_assignments where employee_id = ${EMPLOYEE_ID}`,
  );
  await db.execute(sql`delete from hr_attendance_shifts where id = ${SHIFT_ID}`);
  await db.execute(sql`delete from hr_employees where id = ${EMPLOYEE_ID}`);
  console.log('Removed the local attendance fixture.');
}

async function main(): Promise<void> {
  assertLocalDatabase();
  const command = process.argv[2] ?? 'verify';
  if (command === 'seed') return seed();
  if (command === 'verify') return verify();
  if (command === 'reset') return reset();
  console.error(`Unknown command "${command}". Use: seed | verify | reset`);
  process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
