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

  it('admins (adminBypass) get every enterable Mytrion, so the picker shows (not auto-enter)', () => {
    const { accessible, isAdmin: admin } = resolveAccessibleMytrions(ctx({ profile: 'Administrator', role: 'CEO' }));
    expect(admin).toBe(true);
    expect(accessible).toContain('sales');
    expect(accessible.length).toBeGreaterThan(1);
    // Coming-soon Mytrions stay on the picker grid but are not enterable.
    expect(accessible).not.toContain('collection');
    expect(accessible).not.toContain('verification');
    expect(accessible).not.toContain('manager');
    expect(accessible).not.toContain('analyst');
  });

  it('coming-soon Mytrions are never enterable (even when server-granted)', () => {
    const granted = ctx({
      profile: 'Administrator',
      accessibleMytrions: ['sales', 'collection', 'verification', 'manager', 'analyst'],
      allDepartmentAccess: true,
    });
    expect(resolveAccessibleMytrions(granted).accessible).toEqual(['sales']);
    expect(canAccess(granted, 'collection')).toBe(false);
    expect(canAccess(granted, 'verification')).toBe(false);
    expect(canAccess(granted, 'manager')).toBe(false);
    expect(canAccess(granted, 'analyst')).toBe(false);
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

  it('grants finance to Administrator profile', () => {
    expect(canAccess(ctx({ profile: 'Administrator' }), 'finance')).toBe(true);
  });

  it('grants finance when userName contains Azimov or Mirjalol', () => {
    expect(canAccess(ctx({ profile: 'Sales Agent', userName: 'John Azimov' }), 'finance')).toBe(true);
    expect(canAccess(ctx({ profile: 'Billing', userName: 'Mirjalol Karimov' }), 'finance')).toBe(true);
    expect(canAccess(ctx({ profile: 'Sales Agent', userName: 'azimov.ops' }), 'finance')).toBe(true);
  });

  it('denies finance to unrelated users (no adminBypass)', () => {
    expect(canAccess(ctx({ profile: 'Finance' }), 'finance')).toBe(false);
    expect(canAccess(ctx({ profile: 'Sales Agent', userName: 'Random User' }), 'finance')).toBe(false);
    expect(canAccess(ctx({ role: 'CEO', profile: 'Sales Agent' }), 'finance')).toBe(false);
  });
});

describe('server-resolved access is authoritative (verified session)', () => {
  it('uses accessibleMytrions verbatim (in display order), overriding the static table', () => {
    const { accessible, homeMytrion } = resolveAccessibleMytrions(
      ctx({ profile: 'Sales Agent', accessibleMytrions: ['billing', 'sales'], homeMytrion: 'sales', allDepartmentAccess: false }),
    );
    expect(accessible).toEqual(['sales', 'billing']); // reordered to MYTRION_ORDER
    expect(homeMytrion).toBe('sales');
  });

  it('canAccess honors the server list, not the static profile rules', () => {
    const granted = ctx({ profile: 'Sales Agent', accessibleMytrions: ['billing'] });
    expect(canAccess(granted, 'billing')).toBe(true); // granted server-side despite the profile
    expect(canAccess(granted, 'sales')).toBe(false); // NOT in the server list, though the profile would
  });

  it('isAdmin follows the server-resolved allDepartmentAccess when present', () => {
    expect(isAdmin(ctx({ profile: 'Sales Agent', allDepartmentAccess: true }))).toBe(true);
    expect(isAdmin(ctx({ profile: 'Administrator', allDepartmentAccess: false }))).toBe(false);
  });
});

describe('DEFAULT_PROFILE_SEED mirror (fallback table only — server list wins when present)', () => {
  it('sales-family profiles land on sales only', () => {
    for (const profile of ['Sales Plus', 'Sales Assistant', 'Referral Standard Plus']) {
      expect(resolveAccessibleMytrions(ctx({ profile })).accessible, profile).toEqual(['sales']);
    }
  });

  it('Standard Plus gets sales + billing; Standard gets nothing; Customer Retention gets CS', () => {
    const plus = resolveAccessibleMytrions(ctx({ profile: 'Standard Plus' })).accessible;
    expect(plus).toContain('sales');
    expect(plus).toContain('billing');
    expect(resolveAccessibleMytrions(ctx({ profile: 'Standard' })).accessible).toEqual([]);
    expect(resolveAccessibleMytrions(ctx({ profile: 'Customer Retention' })).accessible).toEqual([
      'customer-service',
    ]);
  });

  it('a server-resolved single-Mytrion list yields exactly one accessible (Landing hard-navigates)', () => {
    const { accessible, homeMytrion } = resolveAccessibleMytrions(
      ctx({ profile: 'Sales Agent', accessibleMytrions: ['sales'], homeMytrion: null, allDepartmentAccess: false }),
    );
    expect(accessible).toEqual(['sales']);
    expect(homeMytrion).toBeNull(); // Landing's length===1 rule must not depend on home
  });
});
