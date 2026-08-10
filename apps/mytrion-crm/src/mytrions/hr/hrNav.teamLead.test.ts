/**
 * A team lead's HR workspace is Attendance and nothing else.
 *
 * The hiding here is a courtesy — `hrAttendance.routes.ts` re-derives the team per request and the
 * directory/departments/org routes still demand real `hr` access. What these pin is that the client
 * does not invite someone into screens their session will refuse, which is what reads as broken.
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

  it('shows a team lead Attendance and only Attendance', () => {
    expect(accessibleHrTabs(lead()).map((t) => t.id)).toEqual(['attendance']);
  });

  it('refuses to open any other HR tab for them', () => {
    for (const tab of ['home', 'employees', 'departments', 'org', 'requests', 'settings'] as const) {
      expect(canOpenHrTab(lead(), tab)).toBe(false);
    }
    expect(canOpenHrTab(lead(), 'attendance')).toBe(true);
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
