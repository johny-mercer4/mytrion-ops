/**
 * The roster is a directory, not a report.
 *
 * Measured against production: building it WITH the per-person week tally took 7502ms for 146 people,
 * and 3455ms of that was one query — reading every punch for everyone so each card could show
 * "4 present · 0 absent". Without it the same call takes 2713ms. The week now loads for the one person
 * the user opens.
 *
 * What these pin is the part that makes that safe: skipping the range read must cost `totals` and
 * NOTHING else. Every other field the roster renders — the shift line, the presence badge, and so all
 * four summary tiles above it — has to come out identical either way.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resolveTeamMock, listRangeMock, lastForMock, assignmentsMock, countUnmappedMock } = vi.hoisted(
  () => ({
    resolveTeamMock: vi.fn(),
    listRangeMock: vi.fn(async () => [] as unknown[]),
    lastForMock: vi.fn(async () => new Map<string, unknown>()),
    assignmentsMock: vi.fn(async () => new Map<string, unknown>()),
    countUnmappedMock: vi.fn(async () => 0),
  }),
);

vi.mock('../../src/modules/hr/attendance/teamScope.js', () => ({
  resolveAttendanceTeam: resolveTeamMock,
}));
vi.mock('../../src/repos/hrAttendancePunchRepo.js', () => ({
  hrAttendancePunchRepo: {
    listForEmployeesRange: listRangeMock,
    lastForEmployees: lastForMock,
    countUnmappedRange: countUnmappedMock,
  },
}));
vi.mock('../../src/repos/hrAttendanceShiftRepo.js', () => ({
  hrAttendanceShiftRepo: { assignmentsForEmployeesDate: assignmentsMock },
}));

import { buildAttendanceTeamList } from '../../src/modules/hr/attendance/teamSummary.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

const ctx = { tenantId: 'octane' } as TenantContext;
const FROM = '2026-08-03';
const TO = '2026-08-09';

const NIGHT_SHIFT = {
  shift: {
    id: 'hrs_1',
    name: 'Night',
    startLocal: '19:00',
    endLocal: '03:00',
    timezone: 'Asia/Tashkent',
    isActive: true,
  },
};

/** A check-in with no matching check-out — the state the "Needs review" tile counts. */
const OPEN_CHECK_IN = {
  kind: 'check_in',
  punchedAt: new Date('2026-08-07T14:04:11.000Z'),
  doorName: 'Ganga 5F Entry',
};

function member(id: string, firstName: string) {
  return {
    employee: {
      id,
      employeeId: `E-${id}`,
      firstName,
      lastName: 'Karimova',
      designation: 'Dispatcher',
      department: 'Operations',
      departmentId: 'hrd_1',
    },
    relation: 'direct_report',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listRangeMock.mockResolvedValue([]);
  lastForMock.mockResolvedValue(new Map());
  assignmentsMock.mockResolvedValue(new Map());
  countUnmappedMock.mockResolvedValue(0);
  resolveTeamMock.mockResolvedValue({
    canViewAll: true,
    directCount: 0,
    allCount: 2,
    items: [member('hre_1', 'Dilnoza'), member('hre_2', 'Bekzod')],
  });
});

describe('roster without the week tally', () => {
  it('does not read a week of punches for everyone', async () => {
    await buildAttendanceTeamList(ctx, '', FROM, TO, 'all', '', { withTotals: false });
    expect(listRangeMock).not.toHaveBeenCalled();
    // The two cheap reads still run — they are what the shift line and presence badge need.
    expect(assignmentsMock).toHaveBeenCalledTimes(1);
    expect(lastForMock).toHaveBeenCalledTimes(1);
  });

  it('returns null totals rather than zeroes', async () => {
    const list = await buildAttendanceTeamList(ctx, '', FROM, TO, 'all', '', { withTotals: false });
    // Zeroes would be a lie the UI cannot detect: "0 present" is a measurement, `null` is "not asked".
    expect(list.items.map((i) => i.totals)).toEqual([null, null]);
    expect(list.items.map((i) => i.firstName)).toEqual(['Dilnoza', 'Bekzod']);
  });

  it('still reads the punches when totals ARE asked for', async () => {
    await buildAttendanceTeamList(ctx, '', FROM, TO, 'all', '', { withTotals: true });
    expect(listRangeMock).toHaveBeenCalledWith(ctx, ['hre_1', 'hre_2'], FROM, TO);
  });

  it('defaults to including them, so an existing caller keeps its shape', async () => {
    const list = await buildAttendanceTeamList(ctx, '', FROM, TO, 'all', '');
    expect(listRangeMock).toHaveBeenCalledTimes(1);
    expect(list.items[0]?.totals).not.toBeNull();
  });

  /**
   * The load-bearing one. The four tiles are computed from `currentState` and `shift`, so if either
   * changed when the range read is skipped, the summary row would silently disagree with itself
   * depending on how the page happened to fetch.
   */
  it('produces the same shift and presence with or without the tally', async () => {
    assignmentsMock.mockResolvedValue(new Map([['hre_1', NIGHT_SHIFT]]));
    lastForMock.mockResolvedValue(new Map([['hre_1', OPEN_CHECK_IN]]));
    listRangeMock.mockResolvedValue([{ ...OPEN_CHECK_IN, employeeId: 'hre_1', workDate: '2026-08-07' }]);

    const heavy = await buildAttendanceTeamList(ctx, '', FROM, TO, 'all', '', { withTotals: true });
    const light = await buildAttendanceTeamList(ctx, '', FROM, TO, 'all', '', { withTotals: false });

    const tiles = (l: typeof heavy) => ({
      people: l.items.length,
      inOffice: l.items.filter((i) => i.currentState === 'in_office').length,
      needsReview: l.items.filter((i) => i.currentState === 'needs_review').length,
      noShift: l.items.filter((i) => !i.shift).length,
    });
    expect(tiles(light)).toEqual(tiles(heavy));

    // And field by field, so a future change to one path cannot drift from the other unnoticed.
    expect(light.items.map((i) => [i.employeeId, i.currentState, i.shift?.name ?? null])).toEqual(
      heavy.items.map((i) => [i.employeeId, i.currentState, i.shift?.name ?? null]),
    );
    expect(light.items.map((i) => i.lastPunch?.punchedAt ?? null)).toEqual(
      heavy.items.map((i) => i.lastPunch?.punchedAt ?? null),
    );
  });
});
