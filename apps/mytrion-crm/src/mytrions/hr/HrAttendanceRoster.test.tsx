/**
 * The roster as a table, and the presence filter over it.
 *
 * The filter is client-side over an already-fetched roster, which makes one thing load-bearing and easy
 * to break: the TILES above the table must keep counting the whole roster. If filtering also moved the
 * tiles, "In office 25" would become "In office 25 of 25" the moment you clicked it, and the number
 * would stop meaning anything.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/hr', () => ({
  getAttendanceTeam: vi.fn(),
  getAttendanceSummary: vi.fn(async () => null),
  listAttendanceShifts: vi.fn(async () => []),
  assignAttendanceShift: vi.fn(),
  syncAttendanceFromDwh: vi.fn(async () => ({ inserted: 0, fetched: 0 })),
}));
vi.mock('./HrAvatar', () => ({ HrAvatar: ({ name }: { name: string }) => <span>{name[0]}</span> }));

import { getAttendanceTeam, type AttendanceTeamListDto } from '../../api/hr';
import { invalidateSwrCache } from '../_shared/swrCache';
import { HrAttendanceTeam, type TeamSummary } from './HrAttendanceTeam';

const teamMock = vi.mocked(getAttendanceTeam);

function person(
  firstName: string,
  currentState: string,
  hasShift = true,
  designation = 'Dispatcher',
) {
  return {
    employeeId: `hre_${firstName}`,
    employeeCode: `HRM-${firstName}`,
    firstName,
    lastName: 'Test',
    designation,
    department: 'Operations',
    departmentId: 'hrd_1',
    photoFileId: null,
    relation: 'direct_report',
    shift: hasShift
      ? { id: 's1', name: 'Night', startLocal: '19:00', endLocal: '03:00', timezone: 'Asia/Tashkent' }
      : null,
    totals: null,
    lastPunch: null,
    currentState,
  };
}

const ROSTER = {
  from: '2026-08-03',
  to: '2026-08-09',
  scope: 'all',
  canViewAll: true,
  counts: { direct: 0, all: 4 },
  unmappedPunches: 0,
  items: [
    person('Dilnoza', 'in_office'),
    person('Bekzod', 'out_of_office'),
    person('Sabina', 'needs_review'),
    // Deliberately DIFFERENT facts: Nodira is idle but scheduled, Abbos is idle AND unscheduled. With
    // only Abbos, "no shift" and "no activity" return the same row and neither filter is really tested.
    person('Nodira', 'no_activity'),
    person('Abbos', 'no_activity', false),
  ],
} as unknown as AttendanceTeamListDto;

function mount(onSummary?: (s: TeamSummary) => void) {
  return render(
    <HrAttendanceTeam
      scope="all"
      today="2026-08-07"
      weekOf="2026-08-07"
      orgWide
      {...(onSummary ? { onSummary } : {})}
    />,
  );
}

/** Rows of the data table, excluding the header. */
function rowNames(): string[] {
  const table = screen.getByRole('table');
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((r) => r.textContent ?? '');
}

beforeEach(() => {
  vi.clearAllMocks();
  invalidateSwrCache('hr:attendance:');
  teamMock.mockResolvedValue(ROSTER);
});

describe('the roster is a table', () => {
  it('has the same columns as the people directory', async () => {
    mount();
    await screen.findByRole('table');
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(heads).toEqual([
      'Name',
      'Employee ID',
      'Designation',
      'Department',
      'Shift',
      'Status',
    ]);
  });

  it('shows the shift window, not just its name', async () => {
    mount();
    await screen.findByRole('table');
    // "Night" alone says nothing when everyone is on Night; the hours are what make late meaningful.
    expect(screen.getAllByText('19:00–03:00').length).toBeGreaterThan(0);
  });

  it('flags an unscheduled person in the Shift column', async () => {
    mount();
    const table = await screen.findByRole('table');
    // Scoped to the table on purpose: the filter chip carries the same words, and an unscoped query
    // would pass on the chip alone even if the cell stopped rendering.
    expect(within(table).getByText('No shift')).toBeTruthy();
  });
});

describe('the presence filter', () => {
  it('shows only the matching people', async () => {
    mount();
    await screen.findByRole('table');
    expect(rowNames()).toHaveLength(5);

    await userEvent.click(screen.getByRole('button', { name: 'In office' }));
    const shown = rowNames();
    expect(shown).toHaveLength(1);
    expect(shown[0]).toContain('Dilnoza');
  });

  it('filters No shift on the absence of a shift, not on presence', async () => {
    mount();
    await screen.findByRole('table');

    await userEvent.click(screen.getByRole('button', { name: 'No shift' }));
    expect(rowNames().map((r) => r.split('HRM')[0]?.trim())).toEqual(['AAbbos Test']);

    // The discriminator: two idle people, only one unscheduled. If `no_shift` were implemented as
    // `currentState === 'no_activity'` both would appear and the filter would be quietly wrong.
    await userEvent.click(screen.getByRole('button', { name: 'No activity' }));
    const idle = rowNames();
    expect(idle).toHaveLength(2);
    expect(idle.join(' ')).toContain('Nodira');
    expect(idle.join(' ')).toContain('Abbos');
  });

  it('reports both numbers so a slice does not read as a shrunken directory', async () => {
    mount();
    await screen.findByRole('table');
    expect(screen.getByText(/5 people/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Needs review' }));
    expect(screen.getByText(/1 of 5 people/)).toBeTruthy();
  });

  /**
   * The one that matters. The tiles are the roster's own summary; a filter is a view of it. If the
   * filter fed the tiles, every tile would read "n of n" as soon as it was clicked.
   */
  it('does NOT change the tiles above it', async () => {
    const onSummary = vi.fn();
    mount(onSummary);
    await screen.findByRole('table');
    const before = onSummary.mock.calls.at(-1)?.[0];
    expect(before).toMatchObject({ people: 5, inOffice: 1, needsReview: 1, noShift: 1 });

    await userEvent.click(screen.getByRole('button', { name: 'In office' }));
    const after = onSummary.mock.calls.at(-1)?.[0];
    expect(after).toEqual(before);
    // Stated as a RELATIONSHIP, not just "unchanged": the tiles must describe the whole roster while
    // the table shows a slice, so the two numbers are expected to disagree.
    expect(after?.people).toBe(5);
    expect(rowNames()).toHaveLength(1);
  });

  it('says nobody matches rather than claiming the directory is empty', async () => {
    teamMock.mockResolvedValue({
      ...ROSTER,
      items: [person('Dilnoza', 'in_office')],
    } as unknown as AttendanceTeamListDto);
    mount();
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Needs review' }));
    expect(screen.getByText('Nobody in this state')).toBeTruthy();
    // "No people found" would send someone hunting for a data problem that isn't there.
    expect(screen.queryByText('No people found')).toBeNull();
  });

  it('marks the active filter for assistive tech, not just with colour', async () => {
    mount();
    await screen.findByRole('table');
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'In office' }));
    expect(screen.getByRole('button', { name: 'In office' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('opening a person', () => {
  it('replaces the table with their week and offers a way back', async () => {
    mount();
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Dilnoza Test' }));

    // A drill-down: the list is gone, so the week gets the full width.
    expect(screen.queryByRole('table')).toBeNull();
    const back = screen.getByRole('button', { name: /All employees/ });
    await userEvent.click(back);
    expect(await screen.findByRole('table')).toBeTruthy();
  });
});
