import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/hrPerson', () => ({
  getHrEmployeeByZohoUser: vi.fn(),
  getHrPersonOverview: vi.fn(),
  getHrEmployeePhotoLink: vi.fn(async () => {
    throw new Error('no photo');
  }),
}));

import {
  getHrEmployeeByZohoUser,
  getHrPersonOverview,
  type HrPersonOverviewDto,
} from '../../api/hrPerson';
import { HrPersonView } from './HrPersonView';

const lookupMock = vi.mocked(getHrEmployeeByZohoUser);
const overviewMock = vi.mocked(getHrPersonOverview);

const employee = {
  id: 'hre_1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  designation: 'Engineer',
  status: 'Active',
  photoFileId: null,
} as never;

function overview(over: Partial<HrPersonOverviewDto> = {}): HrPersonOverviewDto {
  return {
    employee,
    department: {
      id: 'hrd_1',
      name: 'Engineering',
      code: 'ENG',
      leadName: 'Grace Hopper',
      parentName: null,
      icon: null,
      iconColor: null,
      headcount: 12,
    },
    manager: { id: 'hre_9', name: 'Grace Hopper', designation: 'CTO' },
    team: {
      members: [
        {
          id: 'hre_2',
          firstName: 'Alan',
          lastName: 'Turing',
          designation: 'Engineer',
          department: 'Engineering',
          status: 'Active',
          photoFileId: null,
          relation: 'direct_report',
        },
      ],
      directReportCount: 1,
      ledDepartments: [],
    },
    attendance: { from: '2026-08-03', to: '2026-08-09', summary: null, canView: true },
    timeOff: {
      year: 2026,
      balances: [
        {
          leaveTypeId: 'lt_1',
          code: 'annual',
          name: 'Annual leave',
          isPaid: true,
          allocatedDays: 24,
          adjustmentDays: 0,
          approvedDays: 4,
          pendingDays: 1,
          availableDays: 19,
        },
      ],
      requests: [
        {
          id: 'lr_1',
          leaveTypeName: 'Annual leave',
          fromDate: '2026-09-01',
          toDate: '2026-09-04',
          requestedDays: 4,
          status: 'approved',
          reason: null,
          submittedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
    },
    ...over,
  } as HrPersonOverviewDto;
}

beforeEach(() => {
  lookupMock.mockReset();
  overviewMock.mockReset();
});

describe('HrPersonView', () => {
  it('shows the department, team, and time off for the picked person', async () => {
    lookupMock.mockResolvedValue(employee);
    overviewMock.mockResolvedValue(overview());

    render(
      <HrPersonView zohoUserId="42" name="Ada Lovelace" onExit={() => {}} />,
    );

    // The department name appears twice by design — the header badge and the Department card.
    await waitFor(() => expect(screen.getAllByText('Engineering').length).toBeGreaterThan(0));
    expect(screen.getByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(screen.getByText('ENG')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Reports to Grace Hopper')).toBeInTheDocument();
    expect(screen.getByText('Alan Turing')).toBeInTheDocument();
    expect(screen.getByText('Direct report')).toBeInTheDocument();
    // Twice again: once as a balance tile, once as the request's leave type.
    expect(screen.getAllByText('Annual leave')).toHaveLength(2);
    expect(screen.getByText('19')).toBeInTheDocument();
    expect(screen.getByText('2026-09-01 → 2026-09-04')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(lookupMock).toHaveBeenCalledWith('42', expect.anything());
    expect(overviewMock).toHaveBeenCalledWith('hre_1', expect.objectContaining({}));
  });

  /**
   * A sign-in with no employee row is an ordinary HR data gap (nobody linked it yet), not a failure —
   * it gets an empty state that says how to fix it, never a red error banner.
   */
  it('explains an unlinked Zoho sign-in instead of erroring', async () => {
    lookupMock.mockRejectedValue(new Error('No employee record is linked to that Zoho user'));

    render(<HrPersonView zohoUserId="42" name="Abbos Abduroziqov" onExit={() => {}} />);

    await waitFor(() => expect(screen.getByText('No employee record')).toBeInTheDocument());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(overviewMock).not.toHaveBeenCalled();
  });

  it('says attendance is restricted rather than showing an empty week', async () => {
    lookupMock.mockResolvedValue(employee);
    overviewMock.mockResolvedValue(
      overview({
        attendance: { from: '2026-08-03', to: '2026-08-09', summary: null, canView: false },
      }),
    );

    render(<HrPersonView zohoUserId="42" name="Ada Lovelace" onExit={() => {}} />);

    await waitFor(() =>
      expect(
        screen.getByText(/Attendance is limited to this person’s own managers and HR/),
      ).toBeInTheDocument(),
    );
  });

  it('surfaces a real failure as an alert', async () => {
    lookupMock.mockRejectedValue(new Error('backend exploded'));
    render(<HrPersonView zohoUserId="42" name="Ada Lovelace" onExit={() => {}} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('backend exploded'));
  });
});

/**
 * A lead's way from their own record to their team's attendance: open the member.
 *
 * Their attendance lives on their record, so the team card is the route to it — but only for members HR
 * has linked to a Zoho sign-in. An unlinked row must stay plain text, because a control that leads
 * nowhere is worse than no control.
 */
describe('opening a team member', () => {
  // `overview` is a FACTORY taking overrides, not an object — spreading it produced a payload with no
  // team at all, which is why the rows were missing rather than wrong.
  const withTeam = overview({
    team: {
      members: [
        {
          id: 'hre_linked',
          firstName: 'Shohruh',
          lastName: 'Bekmurodov',
          designation: 'Analytics Specialist',
          department: 'Analytics',
          status: 'Active',
          photoFileId: null,
          zohoUserId: '4200',
          relation: 'department_member',
        },
        {
          id: 'hre_unlinked',
          firstName: 'Nodira',
          lastName: 'Yusupova',
          designation: 'Payroll Specialist',
          department: 'Finance',
          status: 'Active',
          photoFileId: null,
          zohoUserId: null,
          relation: 'direct_report',
        },
      ],
      directReportCount: 1,
      ledDepartments: [{ id: 'hrd_1', name: 'Analytics' }],
    },
  } as unknown as Partial<HrPersonOverviewDto>);

  it('opens a linked member’s record', async () => {
    lookupMock.mockResolvedValue(employee as never);
    overviewMock.mockResolvedValue(withTeam);
    const onOpenPerson = vi.fn();
    render(
      <HrPersonView
        zohoUserId="42"
        name="Xusan Turdiyev"
        subtitle="Analytics Manager"
        onExit={vi.fn()}
        onOpenPerson={onOpenPerson}
      />,
    );
    const row = await screen.findByRole('button', { name: /Shohruh Bekmurodov/ });
    row.click();
    expect(onOpenPerson).toHaveBeenCalledWith({
      zohoUserId: '4200',
      name: 'Shohruh Bekmurodov',
      subtitle: 'Analytics Specialist',
    });
  });

  it('leaves an unlinked member as plain text', async () => {
    lookupMock.mockResolvedValue(employee as never);
    overviewMock.mockResolvedValue(withTeam);
    render(
      <HrPersonView
        zohoUserId="42"
        name="Xusan Turdiyev"
        subtitle="Analytics Manager"
        onExit={vi.fn()}
        onOpenPerson={vi.fn()}
      />,
    );
    await screen.findByText('Nodira Yusupova');
    expect(screen.queryByRole('button', { name: /Nodira Yusupova/ })).toBeNull();
  });

  it('leaves every row plain when no handler is supplied', async () => {
    lookupMock.mockResolvedValue(employee as never);
    overviewMock.mockResolvedValue(withTeam);
    render(
      <HrPersonView
        zohoUserId="42"
        name="Xusan Turdiyev"
        subtitle="Analytics Manager"
        onExit={vi.fn()}
      />,
    );
    await screen.findByText('Shohruh Bekmurodov');
    expect(screen.queryByRole('button', { name: /Shohruh Bekmurodov/ })).toBeNull();
  });
});
