/**
 * The roster must survive a failed or in-flight refresh.
 *
 * This is not a nicety. Attendance now pulls from the DWH when the page opens, so a refetch races
 * every visit — and before these reads went through the cache, that refetch blanked the roster to a
 * loader and, when the warehouse was slow or unreachable, to "Could not reach the backend" with an
 * empty table underneath. The rows were still perfectly good.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/hr', () => ({
  getAttendanceTeam: vi.fn(),
  getAttendanceSummary: vi.fn(),
  listAttendanceShifts: vi.fn(async () => []),
  assignAttendanceShift: vi.fn(),
}));

import { getAttendanceTeam, type AttendanceTeamListDto } from '../../api/hr';
import { invalidateSwrCache } from '../_shared/swrCache';
import { HrAttendanceTeam } from './HrAttendanceTeam';

const teamMock = vi.mocked(getAttendanceTeam);

function roster(firstName: string, lastName: string): AttendanceTeamListDto {
  return {
    from: '2026-08-03',
    to: '2026-08-09',
    scope: 'all',
    canViewAll: true,
    counts: { direct: 0, all: 1 },
    unmappedPunches: 0,
    items: [
      {
        employeeId: 'hre_1',
        employeeCode: 'E1',
        firstName,
        lastName,
        designation: 'Dispatcher',
        department: 'Operations',
        departmentId: 'hrd_1',
        relation: 'direct_report',
        shift: null,
        totals: { payableDays: 5, present: 5, weekend: 2, absent: 0, unscheduled: 0 },
        lastPunch: null,
        currentState: null,
      },
    ],
  } as unknown as AttendanceTeamListDto;
}

function view(refreshToken = 0) {
  return (
    <HrAttendanceTeam
      scope="all"
      today="2026-08-07"
      weekOf="2026-08-07"
      refreshToken={refreshToken}
    />
  );
}

function mount(refreshToken = 0) {
  return render(view(refreshToken));
}

beforeEach(() => {
  vi.clearAllMocks();
  invalidateSwrCache('hr:attendance:');
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('the roster is served from cache', () => {
  it('paints a previously loaded week with no loader and no refetch wait', async () => {
    teamMock.mockResolvedValue(roster('Dilnoza', 'Karimova'));
    const first = mount();
    await screen.findByText(/Dilnoza/);
    first.unmount();

    // Coming back: the row is on screen in the FIRST paint, before any promise settles.
    mount();
    expect(screen.getByText(/Dilnoza/)).toBeTruthy();
    expect(screen.queryByText('Loading attendance…')).toBeNull();
  });

  /** The reported failure, exactly: warehouse unreachable, roster wiped, "backend" blamed. */
  it('keeps the rows when a refresh fails, and says so without shouting', async () => {
    teamMock.mockResolvedValue(roster('Dilnoza', 'Karimova'));
    const first = mount();
    await screen.findByText(/Dilnoza/);
    first.unmount();

    // Bumping the token on a MOUNTED component is what the Refresh button does; mounting fresh with a
    // different number is not — the effect deliberately ignores its own initial value.
    teamMock.mockRejectedValue(new Error('Could not reach the backend. Load failed'));
    const mounted = mount(0);
    await screen.findByText(/Dilnoza/);
    mounted.rerender(view(1));

    await waitFor(() => {
      expect(screen.getByText(/Could not refresh it/)).toBeTruthy();
    });
    // The whole point: the data is still there, and the message is a warning, not the page.
    expect(screen.getByText(/Dilnoza/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a hard error only when there is nothing cached to fall back on', async () => {
    teamMock.mockRejectedValue(new Error('Could not reach the backend. Load failed'));
    mount();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not reach the backend');
  });

  it('labels how old the shown roster is, so cached never passes for live', async () => {
    teamMock.mockResolvedValue(roster('Dilnoza', 'Karimova'));
    mount();
    await screen.findByText(/Dilnoza/);
    await waitFor(() => {
      expect(screen.getByText(/just now|\ds ago/)).toBeTruthy();
    });
  });

  it('keys the cache by week, so a different week is not served the wrong rows', async () => {
    teamMock.mockResolvedValue(roster('Dilnoza', 'Karimova'));
    const first = mount();
    await screen.findByText(/Dilnoza/);
    first.unmount();

    teamMock.mockResolvedValue(roster('Bekzod', 'Rustamov'));
    render(<HrAttendanceTeam scope="all" today="2026-08-07" weekOf="2026-07-27" />);
    expect(screen.queryByText(/Dilnoza/)).toBeNull();
    await screen.findByText(/Bekzod/);
  });
});
