/**
 * Attendance is read from the DWH now, not pushed to us. These pin the parts that are easy to get
 * subtly wrong and impossible to notice: which doors are read, which hours, how a naive timestamp is
 * interpreted, and how often a page view is allowed to hit a shared analytics database.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Parameters are spelled out so `mock.calls[n][1]` is a typed tuple element rather than `never` —
// these assertions are about WHAT was handed to the repo, so the arguments have to be reachable.
const { dwhQueryMock, insertManyMock, reconcileMock, rebucketMock, getByIdMock } = vi.hoisted(() => ({
  dwhQueryMock: vi.fn(async (_sql: string, _params?: readonly unknown[]) => [] as unknown[]),
  insertManyMock: vi.fn(async (_ctx: unknown, _rows: readonly unknown[]) => 0),
  reconcileMock: vi.fn(async (_ctx: unknown, _scope?: unknown) => 0),
  rebucketMock: vi.fn(async (_ctx: unknown, _scope?: unknown) => undefined),
  getByIdMock: vi.fn(async (_ctx: unknown, _id: string) => undefined as unknown),
}));

vi.mock('../../src/integrations/dwh.js', () => ({ dwhQuery: dwhQueryMock }));
vi.mock('../../src/repos/hrEmployeeRepo.js', () => ({
  hrEmployeeRepo: { getById: getByIdMock },
}));
vi.mock('../../src/repos/hrAttendancePunchRepo.js', () => ({
  hrAttendancePunchRepo: {
    insertMany: insertManyMock,
    reconcileUnmapped: reconcileMock,
    rebucketWorkDates: rebucketMock,
  },
}));

import {
  DWH_ATTENDANCE_DOORS,
  MAX_SYNC_DAYS,
  resetDwhSyncState,
  syncAttendanceFromDwh,
} from '../../src/modules/hr/attendance/syncFromDwh.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

const ctx = { tenantId: 'octane' } as TenantContext;

/** One `acs_event` row as the driver hands it over. */
function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    emp_code: '00000390',
    wall_clock: '2026-08-04 19:04:11',
    door_name: 'Ganga 5F Entry',
    emp_name: 'LOCAL NIGHTSHIFT',
    ...over,
  };
}

function sqlOf(call: number): string {
  return String(dwhQueryMock.mock.calls[call]?.[0] ?? '');
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDwhSyncState();
  insertManyMock.mockResolvedValue(0);
  dwhQueryMock.mockResolvedValue([]);
  getByIdMock.mockResolvedValue({ id: 'hre_1', faceId: '00000390' });
});

describe('the DWH query', () => {
  it('reads exactly the six Ganga doors', async () => {
    await syncAttendanceFromDwh(ctx, '2026-08-03', '2026-08-07');
    expect(dwhQueryMock.mock.calls[0]?.[1]).toEqual([
      DWH_ATTENDANCE_DOORS,
      '2026-08-03',
      '2026-08-07',
    ]);
    expect(DWH_ATTENDANCE_DOORS).toEqual([
      'Ganga 2F Entry',
      'Ganga 2F Exit',
      'Ganga 4F Entry',
      'Ganga 4F Exit',
      'Ganga 5F Entry',
      'Ganga 5F Exit',
    ]);
    // Not a prefix match. The DWH also holds the Oybek office and a stray `Device 01`; an office we
    // do not track must not start producing attendance for people because a name happened to match.
    expect(sqlOf(0)).not.toMatch(/like\s+'Ganga%'/i);
  });

  /**
   * The timestamp column is `timestamp without time zone` holding Tashkent local time, so letting the
   * driver build a Date from it yields a different instant depending on the server's own timezone.
   * Formatting in SQL is what makes the result the same on a laptop in Tashkent and a container in UTC.
   */
  it('asks SQL to format the timestamp rather than trusting the driver', () => {
    return syncAttendanceFromDwh(ctx, '2026-08-03', '2026-08-07').then(() => {
      expect(sqlOf(0)).toContain("to_char(event_date_time, 'YYYY-MM-DD HH24:MI:SS')");
    });
  });

  it('restricts to the night band and keeps the post-03:00 grace', async () => {
    await syncAttendanceFromDwh(ctx, '2026-08-03', '2026-08-07');
    const sql = sqlOf(0);
    expect(sql).toContain("event_time >= time '17:00'");
    // 03:00 + the 4h OVERNIGHT_CHECKOUT_GRACE_MINUTES. A hard 03:00 stop fetched the check-in and
    // left its check-out behind — 280 of them in one measured week, each rendering as 0 hours.
    expect(sql).toContain("event_time < time '07:00'");
  });

  it('reaches into the day after `to`, so a closing night keeps its check-out', async () => {
    await syncAttendanceFromDwh(ctx, '2026-08-03', '2026-08-07');
    expect(sqlOf(0)).toContain('($3::date + 2)');
  });
});

describe('row mapping', () => {
  it('stores the wall clock as a Tashkent instant, not a UTC one', async () => {
    dwhQueryMock.mockResolvedValue([row({ wall_clock: '2026-08-04 19:04:11' })]);
    insertManyMock.mockResolvedValue(1);
    await syncAttendanceFromDwh(ctx, '2026-08-04', '2026-08-04');

    const [punch] = insertManyMock.mock.calls[0]?.[1] as any[];
    // 19:04:11 in +05 is 14:04:11Z. Reading the column as UTC would give 19:04:11Z.
    expect(punch.punchedAt.toISOString()).toBe('2026-08-04T14:04:11.000Z');
    expect(punch.kind).toBe('check_in');
    expect(punch.faceId).toBe('00000390');
    expect(punch.doorName).toBe('Ganga 5F Entry');
    // Employees are attached by the set-based reconcile, which knows how to normalise a Face ID.
    expect(punch.employeeId).toBeNull();
  });

  it('classifies exits as check_out', async () => {
    dwhQueryMock.mockResolvedValue([row({ door_name: 'Ganga 5F Exit' })]);
    insertManyMock.mockResolvedValue(1);
    await syncAttendanceFromDwh(ctx, '2026-08-04', '2026-08-04');
    expect((insertManyMock.mock.calls[0]?.[1] as any[])[0].kind).toBe('check_out');
  });

  it('counts unusable rows instead of failing the whole window', async () => {
    dwhQueryMock.mockResolvedValue([
      row(),
      row({ emp_code: '   ' }),
      row({ wall_clock: null }),
      row({ door_name: 'Ganga 5F Lobby' }), // neither entry nor exit
    ]);
    insertManyMock.mockResolvedValue(1);
    const result = await syncAttendanceFromDwh(ctx, '2026-08-04', '2026-08-04');
    expect(result.fetched).toBe(4);
    expect(result.skipped).toBe(3);
    expect((insertManyMock.mock.calls[0]?.[1] as any[]).length).toBe(1);
  });
});

describe('cost control', () => {
  it('does not link or rebucket when nothing new arrived', async () => {
    dwhQueryMock.mockResolvedValue([row()]);
    insertManyMock.mockResolvedValue(0);
    await syncAttendanceFromDwh(ctx, '2026-08-04', '2026-08-04');
    expect(reconcileMock).not.toHaveBeenCalled();
    expect(rebucketMock).not.toHaveBeenCalled();
  });

  it('bounds the link and rebucket to the window, not the whole tenant', async () => {
    dwhQueryMock.mockResolvedValue([row()]);
    insertManyMock.mockResolvedValue(1);
    await syncAttendanceFromDwh(ctx, '2026-08-03', '2026-08-07');
    const scope = { from: '2026-08-03', to: '2026-08-07' };
    expect(reconcileMock).toHaveBeenCalledWith(ctx, scope);
    expect(rebucketMock).toHaveBeenCalledWith(ctx, scope);
  });

  it('serves a repeat view from the cooldown without touching the DWH', async () => {
    await syncAttendanceFromDwh(ctx, '2026-08-03', '2026-08-07');
    const second = await syncAttendanceFromDwh(ctx, '2026-08-03', '2026-08-07');
    expect(second.cached).toBe(true);
    expect(dwhQueryMock).toHaveBeenCalledTimes(1);
  });

  it('lets an explicit refresh through the cooldown', async () => {
    await syncAttendanceFromDwh(ctx, '2026-08-03', '2026-08-07');
    const forced = await syncAttendanceFromDwh(ctx, '2026-08-03', '2026-08-07', { force: true });
    expect(forced.cached).toBe(false);
    expect(dwhQueryMock).toHaveBeenCalledTimes(2);
  });

  it('keeps a different week separate from a cooled-down one', async () => {
    await syncAttendanceFromDwh(ctx, '2026-08-03', '2026-08-07');
    await syncAttendanceFromDwh(ctx, '2026-07-27', '2026-08-02');
    expect(dwhQueryMock).toHaveBeenCalledTimes(2);
  });

  /** Both panes of the Attendance page mount at once and ask for the same week in the same tick. */
  it('collapses concurrent identical windows onto one run', async () => {
    let release: (v: unknown[]) => void = () => {};
    dwhQueryMock.mockReturnValue(
      new Promise<unknown[]>((r) => {
        release = r;
      }),
    );
    const a = syncAttendanceFromDwh(ctx, '2026-08-03', '2026-08-07');
    const b = syncAttendanceFromDwh(ctx, '2026-08-03', '2026-08-07');
    release([]);
    expect(await a).toBe(await b);
    expect(dwhQueryMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a window too large to be a page load', async () => {
    await expect(syncAttendanceFromDwh(ctx, '2026-01-01', '2026-12-31')).rejects.toThrow(
      /maximum is 31/,
    );
    expect(dwhQueryMock).not.toHaveBeenCalled();
    expect(MAX_SYNC_DAYS).toBe(31);
  });

  it('accepts a window exactly at the limit', async () => {
    await expect(syncAttendanceFromDwh(ctx, '2026-08-01', '2026-08-31')).resolves.toBeTruthy();
  });

  it('rejects a backwards window', async () => {
    await expect(syncAttendanceFromDwh(ctx, '2026-08-07', '2026-08-01')).rejects.toThrow(
      /on or before/,
    );
  });

  /** A failed sync must not poison the cooldown, or one DWH blip silences the page for a minute. */
  it('does not start a cooldown after a failure', async () => {
    dwhQueryMock.mockRejectedValueOnce(new Error('DWH unavailable'));
    await expect(syncAttendanceFromDwh(ctx, '2026-08-03', '2026-08-07')).rejects.toThrow();
    dwhQueryMock.mockResolvedValue([]);
    const retry = await syncAttendanceFromDwh(ctx, '2026-08-03', '2026-08-07');
    expect(retry.cached).toBe(false);
    expect(dwhQueryMock).toHaveBeenCalledTimes(2);
  });
});

/**
 * Opening one person in the roster pulls only that person.
 *
 * This is what replaced syncing the whole window on page load. Measured against the real warehouse: a
 * week for one employee is 165 rows in 268ms, against 6442 rows for everybody — and the page itself no
 * longer waits on the DWH at all.
 */
describe('one employee at a time', () => {
  it('filters the warehouse query by that person\'s Face ID', async () => {
    await syncAttendanceFromDwh(ctx, '2026-08-03', '2026-08-07', { employeeId: 'hre_1' });
    const [sql, params] = dwhQueryMock.mock.calls[0] ?? [];
    expect(String(sql)).toContain('and emp_code = $4');
    // Verified on both sides: `hr_employees.face_id` and `acs_event.emp_code` are the same
    // zero-padded string, so this is equality and not a normalisation problem.
    expect(params).toEqual([DWH_ATTENDANCE_DOORS, '2026-08-03', '2026-08-07', '00000390']);
  });

  it('does not add the person filter for a whole-window sync', async () => {
    await syncAttendanceFromDwh(ctx, '2026-08-03', '2026-08-07');
    expect(String(dwhQueryMock.mock.calls[0]?.[0])).not.toContain('emp_code = $4');
    expect(dwhQueryMock.mock.calls[0]?.[1]).toHaveLength(3);
  });

  /**
   * 94 of 222 employees have a Face ID, so this is the COMMON case, not an edge one. It must not look
   * like a week of absences, and it must not cost a warehouse round trip to discover.
   */
  it('reports an unenrolled employee without querying the warehouse', async () => {
    getByIdMock.mockResolvedValue({ id: 'hre_2', faceId: null });
    const result = await syncAttendanceFromDwh(ctx, '2026-08-03', '2026-08-07', {
      employeeId: 'hre_2',
    });
    expect(result.noFaceId).toBe(true);
    expect(result.fetched).toBe(0);
    expect(dwhQueryMock).not.toHaveBeenCalled();
  });

  it('treats a blank Face ID the same as a missing one', async () => {
    getByIdMock.mockResolvedValue({ id: 'hre_3', faceId: '   ' });
    const result = await syncAttendanceFromDwh(ctx, '2026-08-03', '2026-08-07', {
      employeeId: 'hre_3',
    });
    expect(result.noFaceId).toBe(true);
    expect(dwhQueryMock).not.toHaveBeenCalled();
  });

  /** A one-person pull and a whole-window pull fetch different sets, so neither may satisfy the other. */
  it('keeps the cooldown separate from the whole-window one', async () => {
    await syncAttendanceFromDwh(ctx, '2026-08-03', '2026-08-07', { employeeId: 'hre_1' });
    const windowRun = await syncAttendanceFromDwh(ctx, '2026-08-03', '2026-08-07');
    expect(windowRun.cached).toBe(false);
    expect(dwhQueryMock).toHaveBeenCalledTimes(2);

    const sameAgain = await syncAttendanceFromDwh(ctx, '2026-08-03', '2026-08-07', {
      employeeId: 'hre_1',
    });
    expect(sameAgain.cached).toBe(true);
  });

  it('scopes the rebucket to that employee, but never the employee matching', async () => {
    dwhQueryMock.mockResolvedValue([row()]);
    insertManyMock.mockResolvedValue(1);
    await syncAttendanceFromDwh(ctx, '2026-08-03', '2026-08-07', { employeeId: 'hre_1' });
    expect(rebucketMock).toHaveBeenCalledWith(ctx, {
      from: '2026-08-03',
      to: '2026-08-07',
      employeeId: 'hre_1',
    });
    // `reconcileUnmapped` attaches punches TO employees, so restricting it to one employee would stop
    // it considering the rows it is supposed to claim.
    expect(reconcileMock).toHaveBeenCalledWith(ctx, { from: '2026-08-03', to: '2026-08-07' });
  });
});
