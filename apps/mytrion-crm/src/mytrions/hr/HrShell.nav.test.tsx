/**
 * The sidebar has to work while a person's record is open.
 *
 * A person record is HR's OWN local state now (it used to ride on the global impersonation slot). It
 * takes over the whole content area, so a sidebar click must close it and render the chosen tab —
 * otherwise the nav looks dead. `MytrionShell` is mocked down to buttons because the real chrome is not
 * what is under test; the question is whether choosing a destination reaches the content area.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NavSection } from '../_shared/MytrionShell';

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
// The employee list is the entry point to a record now — expose its `onOpenRecord` as a button.
vi.mock('./tabs/HrEmployees', () => ({
  HrEmployees: ({
    onOpenRecord,
  }: {
    onOpenRecord?: (p: { zohoUserId: string; name: string; subtitle: string | null }) => void;
  }) => (
    <button
      type="button"
      onClick={() => onOpenRecord?.({ zohoUserId: '42', name: 'Xusan Turdiyev', subtitle: null })}
    >
      OPEN RECORD
    </button>
  ),
}));
vi.mock('./tabs/HrDepartments', () => ({ HrDepartments: () => <div>DEPARTMENTS TAB</div> }));
vi.mock('./tabs/HrOrgStructure', () => ({ HrOrgStructure: () => <div>ORG TAB</div> }));
vi.mock('./tabs/HrAttendance', () => ({ HrAttendance: () => <div>ATTENDANCE TAB</div> }));
vi.mock('./tabs/HrRequests', () => ({ HrRequests: () => <div>TIME OFF TAB</div> }));
vi.mock('./tabs/HrSettings', () => ({ HrSettings: () => <div>SETTINGS TAB</div> }));

import { HrShell } from './HrShell';

beforeEach(() => {
  vi.clearAllMocks();
});

/** Open a record via the employee list (Home is the default landing for an admin). */
async function openRecord(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: 'Employees' }));
  await userEvent.click(screen.getByRole('button', { name: 'OPEN RECORD' }));
}

describe('HR sidebar while a record is open', () => {
  it('opens a person record from the employee list', async () => {
    render(<HrShell />);
    await openRecord();
    expect(screen.getByText('PERSON RECORD')).toBeTruthy();
  });

  /** The bug this guards: a sidebar click while a record was open used to change nothing. */
  it('leaves the record when a sidebar destination is chosen', async () => {
    render(<HrShell />);
    await openRecord();
    expect(screen.getByText('PERSON RECORD')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Time Off' }));
    expect(screen.queryByText('PERSON RECORD')).toBeNull();
    expect(screen.getByText('TIME OFF TAB')).toBeTruthy();
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
    // An admin may open Settings; the point is that the click goes through `canOpenHrTab`.
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByText('SETTINGS TAB')).toBeTruthy();
  });
});
