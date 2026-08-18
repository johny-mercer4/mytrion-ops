/**
 * Pull attendance punches from the DWH (`public.acs_event`) instead of waiting to be pushed.
 *
 * The webhook only ever tells us about events that happen while we are listening: anything sent during
 * a deploy, a restart, or an outage is gone, because there is no replay. The DWH already holds the same
 * door events as a queryable history, so reading a window from it is both self-healing and backfillable
 * — open last month and last month appears, no matter what the listener was doing at the time.
 *
 * This is a READ of a third-party analytics Postgres (CLAUDE.md: never a migration target), and the
 * punches it produces land through `hrAttendancePunchRepo`, which owns tenant isolation.
 */
import { dwhQuery } from '../../../integrations/dwh.js';
import { logger } from '../../../lib/logger.js';
import { hrAttendancePunchRepo, type InsertPunchInput } from '../../../repos/hrAttendancePunchRepo.js';
import { hrEmployeeRepo } from '../../../repos/hrEmployeeRepo.js';
import type { TenantContext } from '../../../types/tenantContext.js';
import {
  doorKind,
  parseUzbWallClock,
  workDateForPunch,
} from './uzbTime.js';

/**
 * The six readers that count as Mytrion attendance.
 *
 * Spelled out rather than matched with `like 'Ganga%'` because the DWH also carries the Oybek office
 * and a stray `Device 01`, and an office we do not track must not silently start producing punches for
 * people who never agreed to be tracked by it. `isAllowedAttendanceDoor` stays the guard on the write
 * side; this is the filter on the read side.
 */
export const DWH_ATTENDANCE_DOORS = [
  'Ganga 2F Entry',
  'Ganga 2F Exit',
  'Ganga 4F Entry',
  'Ganga 4F Exit',
  'Ganga 5F Entry',
  'Ganga 5F Exit',
] as const;

/**
 * No time-of-day band on the pull — every badge on the tracked doors counts, whenever it happened.
 *
 * There used to be a `17:00–07:00` "night band" that dropped ~a fifth of the rows on the theory that
 * everyone on a 19:00–03:00 shift badges in the evening. It also silently dropped EARLY arrivals: a
 * worker who came in at 16:43 for a 19:00 shift had their check-in thrown away, and the day rendered as
 * "no entry scan yet". For an attendance page, never losing a real scan is worth the extra rows — the
 * door filter already scopes this to the six Ganga readers, and even a full month stays well under
 * ROW_LIMIT. The overnight check-out is still caught by the `+ 2` day reach in `fetchWindow`.
 */

/** Longest window one sync may pull. A week is the page's unit; a year is 387k rows and not a page load. */
export const MAX_SYNC_DAYS = 31;

/** Belt-and-braces cap in case a window somehow slips past `MAX_SYNC_DAYS`. */
const ROW_LIMIT = 50_000;

/**
 * How long a completed sync stands for. The page fires this on mount and on every week change, so
 * without it, clicking back and forth across three weeks would be three full DWH round trips per click.
 */
export const SYNC_COOLDOWN_MS = 60_000;

export interface DwhSyncResult {
  from: string;
  to: string;
  /** Rows the DWH returned for the window. */
  fetched: number;
  /** Rows that were new to us — the rest were already stored. */
  inserted: number;
  /** Punches newly attached to an employee by Face ID. */
  linked: number;
  /** Rows we could not use (unreadable timestamp, or a door whose name implies neither in nor out). */
  skipped: number;
  /** True when a recent identical sync stood in for this one. */
  cached: boolean;
  /**
   * Set when the sync was for one person who has no Face ID on their employee record.
   *
   * Not an error and not silence: 94 of 222 employees have a Face ID, so most of the directory simply
   * cannot produce attendance. The caller needs to be able to say "this person is not enrolled on the
   * door readers" instead of showing an empty week that looks like an absence.
   */
  noFaceId?: boolean;
}

interface AcsEventRow {
  emp_code: string | null;
  /** Formatted in SQL, deliberately — see `toPunch`. */
  wall_clock: string | null;
  door_name: string | null;
  emp_name: string | null;
}

const lastSyncedAt = new Map<string, number>();
const inFlight = new Map<string, Promise<DwhSyncResult>>();

function windowKey(ctx: TenantContext, from: string, to: string): string {
  return `${ctx.tenantId}|${from}|${to}`;
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000) + 1;
}

/** Drop everything the sync remembers. Tests need a clean slate; nothing in the app should call it. */
export function resetDwhSyncState(): void {
  lastSyncedAt.clear();
  inFlight.clear();
}

/**
 * One `acs_event` row → one punch, or null if it is not usable.
 *
 * `wall_clock` arrives as a STRING that SQL formatted, and that is the whole trick. `event_date_time` is
 * `timestamp without time zone` holding Tashkent local time, so node-postgres builds a Date from it
 * using the Node process's own timezone. On this laptop (Asia/Tashkent) that happens to be right; on the
 * server (UTC) the identical row would land five hours off, and every night shift would cross a day
 * boundary in the wrong direction. Formatting in SQL and parsing with `parseUzbWallClock` — the same
 * function the webhook path uses — makes the result independent of where the code runs.
 */
function toPunch(row: AcsEventRow): InsertPunchInput | null {
  const faceId = (row.emp_code ?? '').trim();
  const doorName = (row.door_name ?? '').trim();
  const wall = (row.wall_clock ?? '').trim();
  if (!faceId || !doorName || !wall) return null;

  const kind = doorKind(doorName);
  if (!kind) return null;

  const punchedAt = parseUzbWallClock(wall);
  if (Number.isNaN(punchedAt.getTime())) return null;

  return {
    // Left null on purpose: `reconcileUnmapped` attaches employees in one set-based statement, and it
    // already knows how to normalise a Face ID and how to refuse an ambiguous one.
    employeeId: null,
    faceId,
    kind,
    punchedAt,
    // Provisional — the calendar day. The overnight rule needs the employee's shift, which is not known
    // until the punch is linked, so `rebucketWorkDates` fixes this immediately after.
    workDate: workDateForPunch(punchedAt, null),
    source: 'hikvision',
    doorName,
    rawEvent: { ...row, source: 'dwh.acs_event' },
  };
}

async function fetchWindow(from: string, to: string, faceId?: string): Promise<AcsEventRow[]> {
  /**
   * One person, or the whole window.
   *
   * Verified against both sides: `hr_employees.face_id` and `acs_event.emp_code` are the same
   * zero-padded string (`00000055`), so this is an equality match and not a normalisation problem.
   */
  const personClause = faceId ? 'and emp_code = $4' : '';
  const params: unknown[] = [DWH_ATTENDANCE_DOORS, from, to];
  if (faceId) params.push(faceId);
  return dwhQuery<AcsEventRow>(
    `select emp_code,
            to_char(event_date_time, 'YYYY-MM-DD HH24:MI:SS') as wall_clock,
            door_name,
            emp_name
       from public.acs_event
      where door_name = any($1)
        and event_date_time >= $2::date
        and event_date_time < ($3::date + 2)
        ${personClause}
      order by event_date_time
      limit ${ROW_LIMIT}`,
    // `+ 2` in the window above, not `+ 1`: a night shift that starts on `to` clocks out after
    // midnight, and that punch belongs to `to`. Stopping at the end of `to` would store every
    // closing night as unfinished.
    params,
  );
}

async function runSync(
  ctx: TenantContext,
  from: string,
  to: string,
  key: string,
  employeeId?: string,
): Promise<DwhSyncResult> {
  let faceId: string | undefined;
  if (employeeId) {
    const employee = await hrEmployeeRepo.getById(ctx, employeeId);
    faceId = employee?.faceId?.trim() || undefined;
    if (!faceId) {
      // Nothing to ask the warehouse. Recorded rather than swallowed — see `noFaceId`.
      lastSyncedAt.set(key, Date.now());
      return { from, to, fetched: 0, inserted: 0, linked: 0, skipped: 0, cached: false, noFaceId: true };
    }
  }
  const rows = await fetchWindow(from, to, faceId);

  const punches: InsertPunchInput[] = [];
  let skipped = 0;
  for (const row of rows) {
    const punch = toPunch(row);
    if (punch) punches.push(punch);
    else skipped += 1;
  }

  const inserted = await hrAttendancePunchRepo.insertMany(ctx, punches);
  /**
   * Only worth the write amplification when something actually arrived; on a warm window this is the
   * common case and both statements are skipped entirely.
   *
   * The scope carries `employeeId` for a one-person sync, so opening a colleague does not sweep the
   * whole tenant's punches — but it is deliberately NOT passed to `reconcileUnmapped`, which matches
   * punches to employees and therefore must be free to consider every unmapped row in the window.
   */
  const scope = { from, to, ...(employeeId ? { employeeId } : {}) };
  const linked = inserted > 0 ? await hrAttendancePunchRepo.reconcileUnmapped(ctx, { from, to }) : 0;
  if (inserted > 0) await hrAttendancePunchRepo.rebucketWorkDates(ctx, scope);

  lastSyncedAt.set(key, Date.now());
  logger.info(
    { from, to, employeeId, fetched: rows.length, inserted, linked, skipped },
    'hr attendance synced from DWH',
  );
  return { from, to, fetched: rows.length, inserted, linked, skipped, cached: false };
}

/**
 * Bring `hr_attendance_punches` up to date with the DWH for one window.
 *
 * Safe to call on every page view: identical windows collapse onto one in-flight run, a completed run
 * stands for `SYNC_COOLDOWN_MS`, and re-reading a window that is already stored inserts nothing (the
 * dedup index decides, not us).
 */
export async function syncAttendanceFromDwh(
  ctx: TenantContext,
  from: string,
  to: string,
  options: { force?: boolean; employeeId?: string } = {},
): Promise<DwhSyncResult> {
  if (from > to) throw new Error('from must be on or before to');
  const span = daysBetween(from, to);
  if (span > MAX_SYNC_DAYS) {
    throw new Error(`Sync window is ${span} days; the maximum is ${MAX_SYNC_DAYS}`);
  }

  // The employee is part of the key: a one-person pull must not satisfy the cooldown for the whole
  // window, and vice versa — they fetch different sets of rows.
  const key = `${windowKey(ctx, from, to)}|${options.employeeId ?? '*'}`;

  // Share a run already in progress rather than starting a second one. Two panes of the Attendance page
  // mount together and ask for the same week at the same instant; without this they both pull it.
  const running = inFlight.get(key);
  if (running) return running;

  if (!options.force) {
    const last = lastSyncedAt.get(key);
    if (last !== undefined && Date.now() - last < SYNC_COOLDOWN_MS) {
      return { from, to, fetched: 0, inserted: 0, linked: 0, skipped: 0, cached: true };
    }
  }

  const promise = runSync(ctx, from, to, key, options.employeeId).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}
