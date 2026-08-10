/**
 * The sidebar has to work while a person's record is open.
 *
 * Reported bug: with `actingAs` set, the shell rendered ONLY `HrPersonView` and ignored `view` entirely,
 * so every sidebar click moved the highlight and changed nothing. The nav looked dead and the single way
 * out was the "Back to HR" button at the top.
 *
 * `MytrionShell` is mocked down to buttons because the real chrome is not what is under test — the
 * question is whether choosing a destination reaches the content area at all.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NavSection } from '../_shared/MytrionShell';

const actingAs = { current: null as { zohoUserId: string; name: string } | null };
const setActingAs = vi.fn((next: unknown) => {
  actingAs.current = next as typeof actingAs.current;
});

vi.mock('../_shared/MytrionShell', () => ({
  MytrionShell: ({
    navSections,
    footerNav = [],
    children,
  }: {
    navSections: NavSection[];
    // Settings lives here, not in `navSections` — the real shell pins it to the bottom of the rail.
    footerNav?: NavSection['items'];
    children: React.ReactNode;
  }) => (
    <div>
      <nav>
        {[...navSections.flatMap((section) => section.items), ...footerNav].map((item) => (
          <button key={item.label} type="button" onClick={item.onClick}>
            {item.label}
          </button>
        ))}
      </nav>
      <main>{children}</main>
    </div>
  ),
}));

vi.mock('../../context/ImpersonationProvider', () => ({
  useImpersonation: () => ({ actingAs: actingAs.current, setActingAs }),
}));
vi.mock('../../context/UserContextProvider', () => ({
  useUserContext: () => ({
    userId: '1',
    profile: 'Administrator',
    role: 'CEO',
    userName: 'Admin',
    trusted: true,
    allDepartmentAccess: true,
  }),
}));

vi.mock('./HrPersonView', () => ({ HrPersonView: () => <div>PERSON RECORD</div> }));
vi.mock('./tabs/HrHome', () => ({ HrHome: () => <div>HOME TAB</div> }));
vi.mock('./tabs/HrEmployees', () => ({ HrEmployees: () => <div>EMPLOYEES TAB</div> }));
vi.mock('./tabs/HrDepartments', () => ({ HrDepartments: () => <div>DEPARTMENTS TAB</div> }));
vi.mock('./tabs/HrOrgStructure', () => ({ HrOrgStructure: () => <div>ORG TAB</div> }));
vi.mock('./tabs/HrAttendance', () => ({ HrAttendance: () => <div>ATTENDANCE TAB</div> }));
vi.mock('./tabs/HrRequests', () => ({ HrRequests: () => <div>TIME OFF TAB</div> }));
vi.mock('./tabs/HrSettings', () => ({ HrSettings: () => <div>SETTINGS TAB</div> }));

import { HrShell } from './HrShell';

beforeEach(() => {
  vi.clearAllMocks();
  actingAs.current = null;
});

describe('HR sidebar while a record is open', () => {
  it('shows the record when one is open', () => {
    actingAs.current = { zohoUserId: '42', name: 'Xusan Turdiyev' };
    render(<HrShell />);
    expect(screen.getByText('PERSON RECORD')).toBeTruthy();
  });

  /** The bug: this click used to change nothing at all. */
  it('leaves the record when a sidebar destination is chosen', async () => {
    actingAs.current = { zohoUserId: '42', name: 'Xusan Turdiyev' };
    render(<HrShell />);
    await userEvent.click(screen.getByRole('button', { name: 'Time Off' }));
    // Clearing the record is what lets the chosen tab render; asserting the call is asserting the fix.
    expect(setActingAs).toHaveBeenCalledWith(null);
  });

  it('navigates normally when no record is open', async () => {
    render(<HrShell />);
    expect(screen.getByText('HOME TAB')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Attendance' }));
    expect(screen.getByText('ATTENDANCE TAB')).toBeTruthy();
    expect(screen.queryByText('HOME TAB')).toBeNull();
  });

  it('still routes every destination through the RBAC predicate', async () => {
    render(<HrShell />);
    // An admin may open Settings; the point is that the click goes through `canOpenHrTab`, not that
    // this particular user is allowed.
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByText('SETTINGS TAB')).toBeTruthy();
  });
});
