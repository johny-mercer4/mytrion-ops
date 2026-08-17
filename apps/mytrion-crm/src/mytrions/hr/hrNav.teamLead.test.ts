/**
 * A team lead's HR workspace: the company directory (read-only) PLUS their team's Attendance.
 *
 * The directory (Employees / Departments / Org) is company-wide now, so a lead sees it like everyone
 * else; Attendance is the extra they get for leading a team. Settings stays admin-only. The hiding is a
 * courtesy — the backend re-derives the team per request and gates management — but it keeps the client
 * from inviting someone into a screen their session would refuse (Attendance for a plain employee).
 */
import { describe, expect, it } from 'vitest';
import type { UserContext } from '../../context/userContext';
import { accessibleHrTabs, canOpenHrTab } from './hrNav';
import { isHrAttendanceOnly, resolveAccessibleMytrions } from '../../access/resolveAccess';

function user(over: Partial<UserContext> = {}): UserContext {
  return {
    userId: '42',
    profile: 'Sales Rep',
    role: 'Sales',
    userName: 'Team Lead',
    trusted: true,
    accessibleMytrions: ['sales'],
    ...over,
  } as UserContext;
}

const lead = () => user({ leadsTeam: true });
const plainWorker = () => user({ leadsTeam: false });
const hrStaff = () => user({ leadsTeam: false, accessibleMytrions: ['hr'] });
const hrLead = () => user({ leadsTeam: true, accessibleMytrions: ['hr'] });

describe('team lead HR access', () => {
  it('opens the HR door for someone who leads a team', () => {
    expect(resolveAccessibleMytrions(lead()).accessible).toContain('hr');
    // And leaves it shut for everyone else.
    expect(resolveAccessibleMytrions(plainWorker()).accessible).not.toContain('hr');
  });

  it('shows a team lead the directory plus their team Attendance — but not Settings', () => {
    expect(accessibleHrTabs(lead()).map((t) => t.id)).toEqual([
      'home',
      'employees',
      'departments',
      'org',
      'attendance',
      'requests',
    ]);
  });

  it('opens the directory + Attendance for them, but never Settings', () => {
    for (const tab of ['home', 'employees', 'departments', 'org', 'requests', 'attendance'] as const) {
      expect(canOpenHrTab(lead(), tab)).toBe(true);
    }
    expect(canOpenHrTab(lead(), 'settings')).toBe(false);
  });

  /** Real HR staff must not be narrowed by this — the predicate keys off the ABSENCE of hr access. */
  it('does not narrow HR staff who happen to manage someone', () => {
    expect(isHrAttendanceOnly(hrLead())).toBe(false);
    const ids = accessibleHrTabs(hrLead()).map((t) => t.id);
    expect(ids).toContain('employees');
    expect(ids).toContain('attendance');
  });

  it('leaves ordinary HR staff exactly as they were', () => {
    expect(isHrAttendanceOnly(hrStaff())).toBe(false);
    expect(accessibleHrTabs(hrStaff()).map((t) => t.id)).toContain('departments');
  });

  it('treats an admin as full HR, never attendance-only', () => {
    const admin = user({ leadsTeam: true, profile: 'Administrator', allDepartmentAccess: true });
    expect(isHrAttendanceOnly(admin)).toBe(false);
  });

  /** Settings stays admin-only; leading a team is not a route to HR administration. */
  it('never gives a team lead HR Settings', () => {
    expect(accessibleHrTabs(lead()).some((t) => t.id === 'settings')).toBe(false);
  });
});
