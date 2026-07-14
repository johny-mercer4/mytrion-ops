import { describe, it, expect } from 'vitest';
import type { UserContext } from '../context/userContext';
import { resolveAccessibleMytrions, canAccess, isAdmin } from './resolveAccess';

function ctx(over: Partial<UserContext>): UserContext {
  return { userId: 'u', profile: '', role: '', userName: '', trusted: false, ...over };
}

describe('resolveAccessibleMytrions', () => {
  it('a "Sales Agent" profile gets ONLY sales → auto-enters /m/sales', () => {
    const { accessible } = resolveAccessibleMytrions(ctx({ profile: 'Sales Agent', role: 'Uzbekistan Sales Agent' }));
    expect(accessible).toEqual(['sales']);
  });

  it('matches a profile that CONTAINS "Sales Agent" (case-insensitive, variants)', () => {
    for (const profile of ['Senior Sales Agent', 'sales agent - US', 'SALES AGENT']) {
      const { accessible } = resolveAccessibleMytrions(ctx({ profile }));
      expect(accessible, profile).toEqual(['sales']);
    }
  });

  it('does NOT grant sales to an unrelated profile', () => {
    expect(canAccess(ctx({ profile: 'Sales Processing Manager' }), 'sales')).toBe(false);
    expect(canAccess(ctx({ profile: 'Billing' }), 'sales')).toBe(false);
  });

  it('admins (adminBypass) get every Mytrion, so the picker shows (not auto-enter)', () => {
    const { accessible, isAdmin: admin } = resolveAccessibleMytrions(ctx({ profile: 'Administrator', role: 'CEO' }));
    expect(admin).toBe(true);
    expect(accessible).toContain('sales');
    expect(accessible.length).toBeGreaterThan(1);
  });

  it('an unknown profile is forbidden (0 accessible)', () => {
    const { accessible } = resolveAccessibleMytrions(ctx({ profile: 'Nobody' }));
    expect(accessible).toEqual([]);
  });

  it('isAdmin is true only for admin profiles/roles', () => {
    expect(isAdmin(ctx({ profile: 'Administrator' }))).toBe(true);
    expect(isAdmin(ctx({ role: 'CEO' }))).toBe(true);
    expect(isAdmin(ctx({ profile: 'Sales Agent' }))).toBe(false);
  });
});
